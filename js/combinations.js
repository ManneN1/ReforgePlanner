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
    return rules
      .filter((rule) => rule.slots?.length)
      .every((rule) => {
        const selected = combo.filter((item) =>
            rule.slots.includes(item.slot),
          ).length,
          maximum = Math.max(0, Math.floor(number(rule.max)));
        return selected <= maximum;
      });
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
      slotGroups = new Map();
    for (const item of valid)
      slotGroups.set(item.slot, [...(slotGroups.get(item.slot) || []), item]);
    const activeRules = rules
        .filter((rule) => rule.slots?.length)
        .map((rule) => ({
          slots: rule.slots,
          max: Math.max(0, Math.floor(number(rule.max))),
        })),
      baseMain = baseItems.find((item) => item.slot === "Main hand"),
      baseMainTwoHanded = isTwoHanded(baseMain, itemDb);
    let states = new Map([
      [`0|${activeRules.map(() => 0).join(",")}|0|0`, 1n],
    ]);

    for (const [slotName, group] of slotGroups) {
      const transitions = [{ selected: 0, multiplicity: 1n }];
      if (slotName === "Finger") {
        transitions.push({
          selected: 1,
          multiplicity: BigInt(group.length) * 2n,
        });
        if (group.length >= 2)
          transitions.push({
            selected: 2,
            multiplicity:
              (BigInt(group.length) * BigInt(group.length - 1)) / 2n,
          });
      } else if (slotName === "Main hand") {
        const twoHanded = group.filter((item) =>
            isTwoHanded(item, itemDb),
          ).length,
          oneHanded = group.length - twoHanded;
        if (oneHanded)
          transitions.push({
            selected: 1,
            multiplicity: BigInt(oneHanded),
            mainType: 1,
          });
        if (twoHanded)
          transitions.push({
            selected: 1,
            multiplicity: BigInt(twoHanded),
            mainType: 2,
          });
      } else if (group.length) {
        transitions.push({
          selected: 1,
          multiplicity: BigInt(group.length),
          offhand: slotName === "Off hand" ? 1 : undefined,
        });
      }

      const next = new Map();
      for (const [key, ways] of states) {
        const [sizeText, countsText, mainText, offhandText] = key.split("|"),
          size = Number(sizeText),
          counts = countsText ? countsText.split(",").map(Number) : [],
          previousMain = Number(mainText),
          previousOffhand = Number(offhandText);
        for (const transition of transitions) {
          const updated = counts.map((value, ruleIndex) =>
            activeRules[ruleIndex].slots.includes(slotName)
              ? value + transition.selected
              : value,
          );
          if (
            updated.some(
              (value, ruleIndex) => value > activeRules[ruleIndex].max,
            )
          )
            continue;
          const mainType = transition.mainType || previousMain,
            offhand = transition.offhand || previousOffhand;
          if (mainType === 2 && offhand) continue;
          const nextKey = `${size + transition.selected}|${updated.join(",")}|${mainType}|${offhand}`;
          next.set(
            nextKey,
            (next.get(nextKey) || 0n) + ways * transition.multiplicity,
          );
        }
      }
      states = next;
    }

    const { first, last } = candidateSizeRange(valid, count, method);
    let total = 0n;
    for (const [key, ways] of states) {
      const [sizeText, , mainText, offhandText] = key.split("|"),
        size = Number(sizeText),
        mainType = Number(mainText),
        offhand = Number(offhandText);
      if (offhand && mainType === 0 && baseMainTwoHanded) continue;
      if (size >= first && size <= last) total += ways;
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
            yield ringPlacement;
          }
        } else {
          placed.fingerSlots =
            rings.length === 2 ? ["Finger 1", "Finger 2"] : [];
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
    comboMatchesRules,
    candidateSizeRange,
    countCandidateRange,
    comboWeaponCompatible,
    iterateCandidateRange,
    comboGearVariants,
  });
})(globalThis);
