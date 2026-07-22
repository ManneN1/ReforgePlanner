(function (root) {
  "use strict";

  const { STATS, SLOTS, number, normalizeFixedItems } =
    root.ReforgePlanner.model;
  const { clearItem } = root.ReforgePlanner.items;

  function candidateIsUsable(item) {
    return Boolean(
      item.id ||
        number(item.mainStat) !== 0 ||
        (item.gemIds || []).some(Boolean) ||
        (item.enchantIds || []).some(Boolean) ||
        STATS.some((stat) => number(item.stats?.[stat]) !== 0) ||
        (item.name?.trim() && item.name.trim() !== "Candidate item"),
    );
  }

  function comboMatchesRules(combo, rules = []) {
    return rules.every((rule) => {
      const type = rule.type || "slotLimit";
      if (type === "itemCount") return true;
      if (type === "candidateSet") {
        const keys = [...new Set(rule.candidateKeys || [])];
        if (keys.length < 2) return true;
        const selected = combo.filter((item) => keys.includes(item.candidateKey)).length;
        return selected === 0 || selected === keys.length;
      }
      if (!rule.slots?.length) return true;
      const selected = combo.filter((item) => rule.slots.includes(item.slot)).length;
      return selected <= Math.max(0, Math.floor(number(rule.max)));
    });
  }

  function baseItemIsUsable(item) {
    if (!item) return false;
    return Boolean(
      item.id ||
        number(item.mainStat) !== 0 ||
        (item.gemIds || []).some(Boolean) ||
        (item.enchantIds || []).some(Boolean) ||
        STATS.some((stat) => number(item.stats?.[stat]) !== 0) ||
        (item.name?.trim() && item.name.trim() !== item.slot),
    );
  }

  function itemCountAllows(count, method, target) {
    const value = Math.max(0, Math.floor(number(target)));
    if (method === "atleast") return count >= value;
    if (method === "atmost") return count <= value;
    return count === value;
  }

  function comboItemReferenceCount(
    combo,
    rule,
    baseItems = [],
    itemDb = {},
    fingerSlots = combo.fingerSlots || [],
  ) {
    const refs = new Set(rule.itemRefs || []),
      baseBySlot = new Map(baseItems.map((item) => [item.slot, item])),
      replacedSlots = new Set();

    combo.forEach((item) => {
      if (item.slot !== "Finger") replacedSlots.add(item.slot);
    });
    fingerSlots.forEach((slot) => replacedSlots.add(slot));

    const candidateMain = combo.find((item) => item.slot === "Main hand");
    if (candidateMain && isTwoHanded(candidateMain, itemDb))
      replacedSlots.add("Off hand");

    let count = 0;
    for (const ref of refs) {
      if (ref.startsWith("candidate:")) {
        const key = ref.slice("candidate:".length);
        if (combo.some((item) => item.candidateKey === key)) count++;
        continue;
      }
      if (!ref.startsWith("base:")) continue;
      const slot = ref.slice("base:".length),
        item = baseBySlot.get(slot);
      if (baseItemIsUsable(item) && !replacedSlots.has(slot)) count++;
    }
    return count;
  }

  function comboMatchesItemCountRules(
    combo,
    rules = [],
    baseItems = [],
    itemDb = {},
    fingerSlots = combo.fingerSlots || [],
  ) {
    return rules
      .filter((rule) => rule.type === "itemCount")
      .every((rule) =>
        itemCountAllows(
          comboItemReferenceCount(combo, rule, baseItems, itemDb, fingerSlots),
          rule.method,
          rule.value,
        ),
      );
  }

  function candidateSizeRange(items, count, method) {
    const maximum = Math.min(
      items.filter(candidateIsUsable).length,
      SLOTS.length,
    );
    let first = count,
      last = count;
    if (method === "atleast") last = maximum;
    if (method === "atmost") {
      first = 0;
      last = Math.min(count, maximum);
    }
    return { first, last };
  }

  function isTwoHanded(item, itemDb) {
    return Boolean(
      item?.twoHanded || (item?.id && itemDb[String(item.id)]?.h === 4),
    );
  }

  function countCandidateRange(
    items,
    count,
    method,
    { rules = [], baseItems = [], itemDb = {} } = {},
  ) {
    const valid = items.filter(candidateIsUsable),
      slotRules = rules
        .filter((rule) => (rule.type || "slotLimit") === "slotLimit" && rule.slots?.length)
        .map((rule) => ({
          slots: rule.slots,
          max: Math.max(0, Math.floor(number(rule.max))),
        })),
      setRules = rules
        .filter((rule) => rule.type === "candidateSet")
        .map((rule) => [...new Set(rule.candidateKeys || [])])
        .filter((keys) => keys.length >= 2),
      itemRules = rules
        .filter((rule) => rule.type === "itemCount")
        .map((rule) => ({
          method: ["atleast", "atmost", "exactly"].includes(rule.method)
            ? rule.method
            : "atleast",
          value: Math.max(0, Math.floor(number(rule.value))),
          refs: new Set(rule.itemRefs || []),
        })),
      baseBySlot = new Map(baseItems.map((item) => [item.slot, item])),
      initialItemCounts = itemRules.map((rule) =>
        [...rule.refs].filter((ref) => {
          if (!ref.startsWith("base:")) return false;
          const slot = ref.slice("base:".length);
          return baseItemIsUsable(baseBySlot.get(slot));
        }).length,
      ),
      baseMain = baseItems.find((item) => item.slot === "Main hand"),
      baseMainTwoHanded = isTwoHanded(baseMain, itemDb);
    let states = new Map([
      [`0|${slotRules.map(() => 0).join(",")}|${setRules.map(() => 0).join(",")}|${initialItemCounts.join(",")}|0|0|0|`, 1n],
    ]);

    for (const item of valid) {
      const next = new Map(states);
      for (const [key, ways] of states) {
        const [sizeText, ruleText, setText, itemRuleText, mainText, offhandText, fingerText, slotsText] = key.split("|"),
          size = Number(sizeText),
          ruleCounts = ruleText ? ruleText.split(",").map(Number) : [],
          setCounts = setText ? setText.split(",").map(Number) : [],
          itemCounts = itemRuleText ? itemRuleText.split(",").map(Number) : [],
          mainType = Number(mainText),
          offhand = Number(offhandText),
          fingerCount = Number(fingerText),
          usedSlots = new Set(slotsText ? slotsText.split(",").filter(Boolean) : []),
          isFinger = item.slot === "Finger";
        if ((isFinger && fingerCount >= 2) || (!isFinger && usedSlots.has(item.slot))) continue;
        const itemMainType = item.slot === "Main hand" ? (isTwoHanded(item, itemDb) ? 2 : 1) : mainType,
          itemOffhand = item.slot === "Off hand" ? 1 : offhand;
        if (itemMainType === 2 && itemOffhand) continue;
        const updatedRules = ruleCounts.map((value, index) =>
          slotRules[index].slots.includes(item.slot) ? value + 1 : value,
        );
        if (updatedRules.some((value, index) => value > slotRules[index].max)) continue;
        const updatedSets = setCounts.map((value, index) =>
          setRules[index].includes(item.candidateKey) ? value + 1 : value,
        );
        const updatedItems = itemCounts.map((value, index) => {
          const refs = itemRules[index].refs;
          let nextValue = value + (refs.has(`candidate:${item.candidateKey}`) ? 1 : 0);
          if (!isFinger && refs.has(`base:${item.slot}`) && baseItemIsUsable(baseBySlot.get(item.slot)))
            nextValue--;
          if (
            item.slot === "Main hand" &&
            isTwoHanded(item, itemDb) &&
            refs.has("base:Off hand") &&
            baseItemIsUsable(baseBySlot.get("Off hand"))
          ) nextValue--;
          return nextValue;
        });
        const updatedSlots = new Set(usedSlots);
        if (!isFinger) updatedSlots.add(item.slot);
        const nextKey = `${size + 1}|${updatedRules.join(",")}|${updatedSets.join(",")}|${updatedItems.join(",")}|${itemMainType}|${itemOffhand}|${fingerCount + (isFinger ? 1 : 0)}|${[...updatedSlots].sort().join(",")}`;
        next.set(nextKey, (next.get(nextKey) || 0n) + ways);
      }
      states = next;
    }

    const { first, last } = candidateSizeRange(valid, count, method);
    let total = 0n;
    for (const [key, ways] of states) {
      const [sizeText, , setText, itemRuleText, mainText, offhandText, fingerText] = key.split("|"),
        size = Number(sizeText),
        setCounts = setText ? setText.split(",").map(Number) : [],
        itemCounts = itemRuleText ? itemRuleText.split(",").map(Number) : [],
        mainType = Number(mainText),
        offhand = Number(offhandText),
        fingerCount = Number(fingerText);
      if (size < first || size > last) continue;
      if (offhand && mainType === 0 && baseMainTwoHanded) continue;
      if (setCounts.some((value, index) => value !== 0 && value !== setRules[index].length)) continue;

      const placements = fingerCount === 1 ? ["Finger 1", "Finger 2"] : [null];
      for (const replacedFinger of placements) {
        const adjusted = itemCounts.map((value, index) => {
          const refs = itemRules[index].refs;
          if (
            replacedFinger &&
            refs.has(`base:${replacedFinger}`) &&
            baseItemIsUsable(baseBySlot.get(replacedFinger))
          ) return value - 1;
          if (fingerCount === 2) {
            let nextValue = value;
            for (const slot of ["Finger 1", "Finger 2"])
              if (refs.has(`base:${slot}`) && baseItemIsUsable(baseBySlot.get(slot)))
                nextValue--;
            return nextValue;
          }
          return value;
        });
        if (adjusted.some((value, index) => !itemCountAllows(value, itemRules[index].method, itemRules[index].value)))
          continue;
        total += ways;
      }
    }
    return total;
  }

  function comboWeaponCompatible(combo, baseItems = [], itemDb = {}) {
    const candidateMain = combo.find((item) => item.slot === "Main hand"),
      hasOffhand = combo.some((item) => item.slot === "Off hand"),
      baseMain = baseItems.find((item) => item.slot === "Main hand"),
      main = candidateMain || baseMain;
    return !(hasOffhand && isTwoHanded(main, itemDb));
  }

  function* iterateCandidateRange(
    items,
    count,
    method,
    { rules = [], baseItems = [], itemDb = {} } = {},
  ) {
    const valid = items.filter(candidateIsUsable),
      { first, last } = candidateSizeRange(valid, count, method);
    function* choose(start, remaining, picked, slots) {
      if (remaining === 0) {
        if (
          !comboMatchesRules(picked, rules) ||
          !comboWeaponCompatible(picked, baseItems, itemDb)
        )
          return;
        const rings = picked.filter((item) => item.slot === "Finger"),
          placed = picked.slice();
        if (rings.length === 1) {
          for (const fingerSlot of ["Finger 1", "Finger 2"]) {
            const ringPlacement = placed.slice();
            ringPlacement.fingerSlots = [fingerSlot];
            if (comboMatchesItemCountRules(ringPlacement, rules, baseItems, itemDb, ringPlacement.fingerSlots))
              yield ringPlacement;
          }
        } else {
          placed.fingerSlots =
            rings.length === 2 ? ["Finger 1", "Finger 2"] : [];
          if (comboMatchesItemCountRules(placed, rules, baseItems, itemDb, placed.fingerSlots))
            yield placed;
        }
        return;
      }
      for (let index = start; index < valid.length; index++) {
        const item = valid[index],
          used = slots.get(item.slot) || 0,
          capacity = item.slot === "Finger" ? 2 : 1;
        if (used >= capacity) continue;
        slots.set(item.slot, used + 1);
        picked.push(item);
        yield* choose(index + 1, remaining - 1, picked, slots);
        picked.pop();
        if (used) slots.set(item.slot, used);
        else slots.delete(item.slot);
      }
    }
    for (let size = first; size <= last; size++)
      yield* choose(0, size, [], new Map());
  }

  function comboGearVariants(combo, baseItems = [], itemDb = {}) {
    const baseGear = normalizeFixedItems(baseItems).map((item) =>
        structuredClone(item),
      ),
      rings = combo.filter((item) => item.slot === "Finger");
    for (const candidate of combo.filter((item) => item.slot !== "Finger")) {
      const index = baseGear.findIndex((item) => item.slot === candidate.slot);
      if (index >= 0) baseGear[index] = structuredClone(candidate);
    }
    const placements = [
      combo.fingerSlots ||
        (rings.length === 2 ? ["Finger 1", "Finger 2"] : []),
    ];
    return placements
      .map((slots) => {
        const gear = structuredClone(baseGear);
        rings.forEach((ring, index) => {
          const slotName = slots[index],
            gearIndex = gear.findIndex((item) => item.slot === slotName),
            equipped = structuredClone(ring);
          equipped.slot = slotName;
          gear[gearIndex] = equipped;
        });
        const main = gear.find((item) => item.slot === "Main hand"),
          offhand = gear.find((item) => item.slot === "Off hand");
        if (
          isTwoHanded(main, itemDb) &&
          combo.some((item) => item.slot === "Off hand")
        )
          return null;
        if (isTwoHanded(main, itemDb) && offhand) clearItem(offhand);
        return gear;
      })
      .filter(Boolean);
  }

  root.ReforgePlanner.combinations = Object.freeze({
    candidateIsUsable,
    baseItemIsUsable,
    itemCountAllows,
    comboItemReferenceCount,
    comboMatchesRules,
    comboMatchesItemCountRules,
    candidateSizeRange,
    countCandidateRange,
    comboWeaponCompatible,
    iterateCandidateRange,
    comboGearVariants,
  });
})(globalThis);
