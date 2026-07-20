(function (root) {
  "use strict";

  const { STATS, MAIN_STAT, number, blankItem } = root.ReforgePlanner.model;

  function applyItemRecord(item, id, record, randomEnchantId = "") {
    item.id = String(id);
    item.randomEnchantId =
      randomEnchantId === "" ? "" : String(randomEnchantId);
    item.name = record.n;
    item.mainStat = number(record.m);
    if (record.h) item.twoHanded = record.h === 4;
    STATS.forEach((stat, index) => {
      item.stats[stat] = record.s[index] || 0;
    });
  }

  function clearItem(item) {
    Object.assign(item, blankItem(item.slot || item.name));
  }

  function enforceWeaponRules(items, itemDb) {
    const main = items.find((item) => item.slot === "Main hand"),
      offhand = items.find((item) => item.slot === "Off hand"),
      record = main?.id && itemDb[String(main.id)];
    if ((main?.twoHanded || record?.h === 4) && offhand) clearItem(offhand);
  }

  function statsFromWowheadTooltip(html) {
    const stats = Object.fromEntries(STATS.map((stat) => [stat, 0]));
    const markers = {
      13: "Dodge",
      14: "Parry",
      31: "Hit",
      32: "Crit",
      36: "Haste",
      37: "Expertise",
      49: "Mastery",
    };
    for (const match of html.matchAll(
      /<!--rtg(13|14|31|32|36|37|49)-->(?:\+)?([\d,]+)/g,
    ))
      stats[markers[match[1]]] += Number(match[2].replaceAll(",", ""));
    for (const match of html.matchAll(/<!--stat6-->(?:\+)?([\d,]+)/g))
      stats.Spirit += Number(match[1].replaceAll(",", ""));
    stats[MAIN_STAT] = 0;
    for (const match of html.matchAll(
      /<!--stat(?:3|4|5)-->(?:\+)?([\d,]+)/g,
    ))
      stats[MAIN_STAT] = Math.max(
        stats[MAIN_STAT],
        Number(match[1].replaceAll(",", "")),
      );
    return stats;
  }

  function createItemRepository({ itemDb, fetchImpl = root.fetch }) {
    const variantCache = new Map();

    function fillLocal(item, id) {
      const record = itemDb[String(id)];
      if (!record) return false;
      applyItemRecord(item, id, record);
      return true;
    }

    async function fillWithFallback(item, id, randomEnchantId = "") {
      const variant =
        randomEnchantId === "" || randomEnchantId == null
          ? ""
          : String(randomEnchantId);
      if (!variant && fillLocal(item, id)) return "local";

      const key = `${id}:${variant}`;
      if (variantCache.has(key)) {
        applyItemRecord(item, id, variantCache.get(key), variant);
        return "cache";
      }
      if (typeof fetchImpl !== "function")
        throw new Error("Online item lookup is unavailable.");

      const query = variant ? `?rand=${encodeURIComponent(variant)}` : "";
      const response = await fetchImpl(
        `https://nether.wowhead.com/cata/tooltip/item/${encodeURIComponent(id)}${query}`,
      );
      if (!response.ok) throw new Error(`Wowhead returned ${response.status}`);
      const data = await response.json();
      if (!data?.name || !data?.tooltip)
        throw new Error("Wowhead did not return an item");

      const stats = statsFromWowheadTooltip(data.tooltip);
      const record = {
        n: data.name,
        s: STATS.map((stat) => stats[stat] || 0),
        m: stats[MAIN_STAT] || 0,
      };
      if (variant) variantCache.set(key, record);
      else itemDb[String(id)] = record;
      applyItemRecord(item, id, record, variant);
      return "wowhead";
    }

    return Object.freeze({ fillLocal, fillWithFallback });
  }

  root.ReforgePlanner.items = Object.freeze({
    applyItemRecord,
    clearItem,
    enforceWeaponRules,
    statsFromWowheadTooltip,
    createItemRepository,
  });
})(globalThis);
