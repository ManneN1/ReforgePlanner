import fs from "node:fs";

const input = JSON.parse(
  fs.readFileSync(new URL("../db.json", import.meta.url), "utf8"),
);
const statIndexes = [4, 9, 10, 5, 6, 7, 8, 11];
const suffixes = new Map(
  (input.randomSuffixes || []).map((suffix) => [suffix.id, suffix.name]),
);
const slots = {
  1: "Head",
  2: "Neck",
  3: "Shoulder",
  4: "Back",
  5: "Chest",
  6: "Wrist",
  7: "Hands",
  8: "Waist",
  9: "Legs",
  10: "Feet",
  11: "Finger 1",
  12: "Trinket 1",
  13: "Main hand",
  14: "Ranged",
};
const output = {};
const gemOutput = {};
const enchantOutput = {};

function statRecord(values = []) {
  return {
    m: Math.max(...[0, 1, 3].map((index) => Number(values[index] || 0))),
    s: statIndexes.map((index) => Number(values[index] || 0)),
  };
}

function bonusRecord(entry) {
  return {
    n: entry.name,
    ...statRecord(entry.stats || []),
  };
}

for (const item of input.items || []) {
  const scaling = item.scalingOptions?.["0"];
  if (!scaling?.stats && !item.randomSuffixOptions?.length) continue;
  const stats = statIndexes.map((index) =>
    Number(scaling?.stats?.[index] || 0),
  );
  const record = { n: item.name, s: stats };
  record.m = Math.max(
    ...[0, 1, 3].map((index) => Number(scaling?.stats?.[index] || 0)),
  );
  if (slots[item.type]) record.t = slots[item.type];
  record.g = (item.gemSockets || []).length;
  if (item.gemSockets?.length) record.k = item.gemSockets.map(Number);
  if (item.socketBonus?.some(Number)) record.b = statRecord(item.socketBonus);
  if (item.handType) record.h = item.handType;
  if (item.randomSuffixOptions?.length) {
    record.v = item.randomSuffixOptions.map((id) => ({
      id,
      n: suffixes.get(id) || `Variant ${id}`,
    }));
  }
  output[item.id] = record;
}

for (const gem of input.gems || [])
  gemOutput[gem.id] = { ...bonusRecord(gem), c: Number(gem.color || 0) };
for (const enchant of input.enchants || []) {
  enchantOutput[enchant.spellId || enchant.effectId] = {
    ...bonusRecord(enchant),
    t: slots[enchant.type] || "",
  };
}
// Wowhead planner payloads sometimes use the crafting spell immediately after
// the applied enchant aura. Retain those IDs for import without listing them.
for (const enchant of input.enchants || []) {
  const appliedId = enchant.spellId || enchant.effectId;
  const plannerId = Number(appliedId) + 1;
  if (!enchantOutput[plannerId])
    enchantOutput[plannerId] = { ...enchantOutput[appliedId], a: 1 };
}

fs.writeFileSync(
  new URL("../item-db.js", import.meta.url),
  `globalThis.ITEM_DB=${JSON.stringify(output)};\nglobalThis.GEM_DB=${JSON.stringify(gemOutput)};\nglobalThis.ENCHANT_DB=${JSON.stringify(enchantOutput)};\n`,
);
console.log(
  `Wrote ${Object.keys(output).length} items, ${Object.keys(gemOutput).length} gems, and ${Object.keys(enchantOutput).length} enchants.`,
);
