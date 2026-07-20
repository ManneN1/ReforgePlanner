(function (root) {
  "use strict";

  const STATS = [
    "Spirit",
    "Dodge",
    "Parry",
    "Hit",
    "Crit",
    "Haste",
    "Expertise",
    "Mastery",
  ];
  const MAIN_STAT = "Main stat";
  const TOTAL_STATS = [MAIN_STAT, ...STATS];
  const MAX_GEMS = 3;
  const SLOTS = [
    "Head",
    "Neck",
    "Shoulder",
    "Back",
    "Chest",
    "Wrist",
    "Hands",
    "Waist",
    "Legs",
    "Feet",
    "Finger 1",
    "Finger 2",
    "Trinket 1",
    "Trinket 2",
    "Main hand",
    "Off hand",
    "Ranged",
  ];
  const LAB_SLOTS = [
    ...SLOTS.filter((slot) => !slot.startsWith("Finger ")),
    "Finger",
  ];

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatCount(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  function blankItem(slot = "Item") {
    return {
      slot,
      id: "",
      randomEnchantId: "",
      name: slot,
      mainStat: 0,
      gemIds: [],
      socketColors: [],
      enchantIds: [],
      twoHanded: false,
      stats: Object.fromEntries(STATS.map((stat) => [stat, 0])),
    };
  }

  function createDefaultState() {
    return {
      weights: Object.fromEntries(TOTAL_STATS.map((stat) => [stat, 0])),
      baseline: Object.fromEntries(TOTAL_STATS.map((stat) => [stat, 0])),
      caps: [
        { stat: "None", rules: [{ method: "atleast", value: 0, after: 0 }] },
        { stat: "None", rules: [{ method: "atleast", value: 0, after: 0 }] },
      ],
      items: SLOTS.map((slot) => blankItem(slot)),
      candidates: [],
      comboRules: [],
      comboCount: 1,
      comboMethod: "exactly",
    };
  }

  function normalizeFixedItems(items = []) {
    const bySlot = new Map(
      items.map((item, index) => [
        SLOTS.includes(item.slot) ? item.slot : SLOTS[index],
        item,
      ]),
    );
    return SLOTS.map((slot) => {
      const item = bySlot.get(slot);
      if (!item) return blankItem(slot);
      return {
        ...blankItem(slot),
        slot,
        id: item.id || "",
        randomEnchantId: item.randomEnchantId || "",
        name: item.name || slot,
        mainStat: Math.max(0, number(item.mainStat)),
        gemIds: [...(item.gemIds || [])].slice(0, MAX_GEMS),
        socketColors: [...(item.socketColors || [])].slice(0, MAX_GEMS),
        enchantIds: [...(item.enchantIds || [])].slice(0, 1),
        twoHanded: Boolean(item.twoHanded),
        stats: { ...blankItem(slot).stats, ...(item.stats || {}) },
      };
    });
  }

  function normalizeCandidate(item = {}) {
    const normalized = {
      ...blankItem("Candidate item"),
      ...item,
      gemIds: [...(item.gemIds || [])].slice(0, MAX_GEMS),
      socketColors: [...(item.socketColors || [])].slice(0, MAX_GEMS),
      enchantIds: [...(item.enchantIds || [])].slice(0, 1),
      stats: { ...blankItem().stats, ...(item.stats || {}) },
    };
    if (normalized.slot === "Finger 1" || normalized.slot === "Finger 2")
      normalized.slot = "Finger";
    return normalized;
  }

  const namespace = (root.ReforgePlanner ||= {});
  namespace.model = Object.freeze({
    STATS,
    MAIN_STAT,
    TOTAL_STATS,
    MAX_GEMS,
    SLOTS,
    LAB_SLOTS,
    number,
    formatCount,
    blankItem,
    createDefaultState,
    normalizeFixedItems,
    normalizeCandidate,
  });
})(globalThis);
