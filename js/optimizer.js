(function (root) {
  "use strict";

  const { STATS, MAIN_STAT, TOTAL_STATS, number } = root.ReforgePlanner.model;

  function equipmentBonuses(item, databases) {
    const { itemDb, gemDb, enchantDb } = databases;
    const result = {
      [MAIN_STAT]: 0,
      ...Object.fromEntries(STATS.map((stat) => [stat, 0])),
    };
    const records = [
      ...(item.gemIds || []).map((id) => gemDb[String(id)]),
      item.slot !== "Neck" && item.enchantIds?.[0]
        ? enchantDb[String(item.enchantIds[0])]
        : null,
    ].filter(Boolean);
    for (const record of records) {
      result[MAIN_STAT] += number(record.m);
      STATS.forEach((stat, index) => {
        result[stat] += number(record.s?.[index]);
      });
    }

    return result;
  }

  function capScore(cap, value, weights) {
    let remaining = value,
      score = 0;
    const points = cap.rules
      .filter((rule) => rule.method === "new")
      .sort((left, right) => left.value - right.value);
    for (let index = points.length - 1; index >= 0; index--)
      if (remaining > points[index].value) {
        score +=
          points[index].after * (remaining - points[index].value);
        remaining = points[index].value;
      }
    return score + number(weights[cap.stat]) * remaining;
  }

  function capAllows(cap, value) {
    return cap.rules.every(
      (rule) =>
        rule.method === "new" ||
        (rule.method === "atleast"
          ? value >= rule.value
          : rule.method === "atmost"
            ? value <= rule.value
            : value === rule.value),
    );
  }

  function optionsFor(item, caps, weights) {
    const noReforge = {
      d: [0, 0],
      score: 0,
      src: null,
      dst: null,
      amount: 0,
    };
    const bestByBreakpointDelta = new Map();
    for (const source of STATS) {
      if (!item.stats[source]) continue;
      const amount = Math.floor(item.stats[source] * 0.4);
      if (!amount) continue;
      for (const destination of STATS) {
        if (source === destination || item.stats[destination] > 0) continue;
        const delta = [0, 0];
        let score = 0;
        for (let capIndex = 0; capIndex < 2; capIndex++) {
          if (caps[capIndex].stat === source) delta[capIndex] -= amount;
          if (caps[capIndex].stat === destination) delta[capIndex] += amount;
        }
        if (!caps.some((cap) => cap.stat === source))
          score -= amount * number(weights[source]);
        if (!caps.some((cap) => cap.stat === destination))
          score += amount * number(weights[destination]);
        const option = {
          d: delta,
          score,
          src: source,
          dst: destination,
          amount,
        };
        const key = delta.join(":");
        if (
          !bestByBreakpointDelta.has(key) ||
          bestByBreakpointDelta.get(key).score < score
        )
          bestByBreakpointDelta.set(key, option);
      }
    }
    return [noReforge, ...bestByBreakpointDelta.values()];
  }

  async function optimize(
    inputItems,
    configuration,
    databases,
    onProgress = null,
  ) {
    const { weights, baseline, caps: configuredCaps } = configuration;
    const equippedCount = inputItems.filter(
      (item) =>
        item.id ||
        number(item.mainStat) > 0 ||
        (item.gemIds || []).some(Boolean) ||
        (item.enchantIds || []).some(Boolean) ||
        STATS.some((stat) => item.stats[stat] > 0) ||
        (item.name && item.name !== item.slot),
    ).length;
    const activeItems = inputItems.filter((item) =>
      STATS.some((stat) => item.stats[stat] > 0),
    );
    const hasContribution = inputItems.some((item) => {
      const bonuses = equipmentBonuses(item, databases);
      return (
        number(item.mainStat) > 0 ||
        bonuses[MAIN_STAT] > 0 ||
        STATS.some(
          (stat) => number(item.stats[stat]) > 0 || bonuses[stat] > 0,
        )
      );
    });
    if (!hasContribution)
      throw new Error("Enter at least one item with stats, gems, or an enchant.");

    const caps = configuredCaps.map((cap) => ({
      stat: cap.stat,
      rules: cap.rules.map((rule) => ({ ...rule })),
    }));
    caps.forEach((cap, index) => {
      if (
        cap.stat === "None" &&
        cap.rules.some(
          (rule) =>
            rule.value !== 0 || (rule.method === "new" && rule.after !== 0),
        )
      )
        throw new Error(
          `Breakpoint stat ${index + 1} has a limit but no stat selected. Choose Hit, Expertise, or another stat from its dropdown.`,
        );
    });
    if (caps[0].stat !== "None" && caps[0].stat === caps[1].stat)
      throw new Error("The two capped stats must be different.");

    const base = { ...baseline };
    base[MAIN_STAT] =
      number(baseline[MAIN_STAT]) +
      inputItems.reduce((sum, item) => {
        const bonuses = equipmentBonuses(item, databases);
        return sum + number(item.mainStat) + bonuses[MAIN_STAT];
      }, 0);
    for (const item of activeItems)
      for (const stat of STATS) base[stat] += number(item.stats[stat]);
    for (const item of inputItems) {
      const bonuses = equipmentBonuses(item, databases);
      for (const stat of STATS) base[stat] += bonuses[stat];
    }

    const initialCaps = caps.map((cap) =>
      cap.stat === "None" ? 0 : base[cap.stat],
    );
    const itemOptions = activeItems.map((item) =>
      optionsFor(item, caps, weights),
    );
    let states = new Map([[initialCaps.join(":"), { score: 0, path: [] }]]);
    for (let itemIndex = 0; itemIndex < activeItems.length; itemIndex++) {
      const next = new Map();
      for (const [key, node] of states) {
        const current = key.split(":").map(Number);
        for (
          let optionIndex = 0;
          optionIndex < itemOptions[itemIndex].length;
          optionIndex++
        ) {
          const option = itemOptions[itemIndex][optionIndex];
          const values = [
            current[0] + option.d[0],
            current[1] + option.d[1],
          ];
          const nextKey = values.join(":"),
            score = node.score + option.score,
            previous = next.get(nextKey);
          if (!previous || score > previous.score)
            next.set(nextKey, {
              score,
              path: node.path.concat(optionIndex),
            });
        }
      }
      states = next;
      onProgress?.({
        item: itemIndex + 1,
        totalItems: activeItems.length,
        states: states.size,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    let best = null,
      bestClass = 99;
    for (const [key, node] of states) {
      const values = key.split(":").map(Number);
      const allowed = caps.map(
        (cap, index) => cap.stat === "None" || capAllows(cap, values[index]),
      );
      const resultClass = allowed[0] && allowed[1]
        ? 0
        : allowed[0]
          ? 1
          : allowed[1]
            ? 2
            : 3;
      let score = node.score;
      caps.forEach((cap, index) => {
        if (cap.stat !== "None")
          score += capScore(cap, values[index], weights);
      });
      if (
        !best ||
        resultClass < bestClass ||
        (resultClass === bestClass && score > best.score)
      ) {
        best = { ...node, values, score };
        bestClass = resultClass;
      }
    }
    if (!best) throw new Error("No solution found.");

    const picked = best.path.map(
      (optionIndex, itemIndex) => itemOptions[itemIndex][optionIndex],
    );
    const totals = { ...base };
    picked.forEach((option) => {
      if (option.src) {
        totals[option.src] -= option.amount;
        totals[option.dst] += option.amount;
      }
    });
    const finalScore =
      number(weights[MAIN_STAT]) * totals[MAIN_STAT] +
      STATS.reduce((sum, stat) => {
        const cap = caps.find((candidate) => candidate.stat === stat);
        return (
          sum +
          (cap
            ? capScore(cap, totals[stat], weights)
            : number(weights[stat]) * totals[stat])
        );
      }, 0);

    return {
      items: activeItems,
      equippedCount,
      picked,
      base,
      totals,
      score: finalScore,
      allCapsMet: bestClass === 0,
      capResults: caps.map((cap, index) => ({
        stat: cap.stat,
        value: best.values[index],
        met: cap.stat === "None" || capAllows(cap, best.values[index]),
        rules: cap.rules,
      })),
      states: states.size,
    };
  }

  function compareOptimizedResults(left, right, weights) {
    let comparison =
      Number(right.allCapsMet) - Number(left.allCapsMet) ||
      right.capResults.filter((cap) => cap.stat !== "None" && cap.met).length -
        left.capResults.filter((cap) => cap.stat !== "None" && cap.met).length;
    if (comparison) return comparison;
    const priority = TOTAL_STATS.filter(
      (stat) => number(weights[stat]) !== 0,
    ).sort(
      (leftStat, rightStat) =>
        number(weights[rightStat]) - number(weights[leftStat]) ||
        TOTAL_STATS.indexOf(leftStat) - TOTAL_STATS.indexOf(rightStat),
    );
    for (const stat of priority) {
      const difference = number(right.totals[stat]) - number(left.totals[stat]);
      if (difference)
        return number(weights[stat]) > 0 ? difference : -difference;
    }
    return 0;
  }

  root.ReforgePlanner.optimizer = Object.freeze({
    equipmentBonuses,
    capScore,
    capAllows,
    optionsFor,
    optimize,
    compareOptimizedResults,
  });
})(globalThis);
