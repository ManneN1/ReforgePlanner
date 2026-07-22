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
  // Type 13 contains weapons, shields, and caster off-hands. handType 3 is
  // off-hand-only and must never be offered as a Main hand candidate.
  if (item.type === 13 && item.handType === 3) record.t = "Off hand";
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
  const appliedId = enchant.spellId || enchant.effectId;
  enchantOutput[appliedId] = {
    ...bonusRecord(enchant),
    t: slots[enchant.type] || "",
  };
}
// Wowhead planner payloads sometimes use a recipe/runeforge spell ID rather
// than the applied aura ID stored by the item database. These relationships are
// not arithmetic; keep an explicit, verified mapping only.
const wowheadPlannerEnchantIds = new Map([
  // Cataclysm profession enchants.
  [74245, 74246], // Landslide
  [94746, 94747], // Power Torrent
  [95471, 95472], // Mighty Agility
  [95653, 95654], // Heartsong
  [95713, 95714], // Gnomish X-Ray Scope
  [96262, 96263], // Mighty Intellect
  [96264, 96265], // Bracer Agility
  [99622, 99623], // Flintlocke's Woodchucker
  [74249, 74250], // Peerless Stats
  [75177, 75178], // Swordguard Embroidery
  [43588, 93448], // Pyrium Weapon Chain

  // Death Knight runeforges: applied aura -> runeforging spell.
  [53387, 53323], // Rune of Swordshattering
  [56903, 53331], // Rune of Lichbane
  [53362, 53342], // Rune of Spellshattering
  [53365, 53344], // Rune of the Fallen Crusader
  [53386, 53341], // Rune of Cinderglacier
  [50401, 53343], // Rune of Razorice
  [54448, 54446], // Rune of Swordbreaking
  [54449, 54447], // Rune of Spellbreaking
  [62157, 62158], // Rune of the Stoneskin Gargoyle
  [70163, 70164], // Rune of the Nerubian Carapace
]);

for (const [appliedId, plannerId] of wowheadPlannerEnchantIds) {
  const record = enchantOutput[appliedId];
  if (!record)
    throw new Error(`Missing canonical enchant ${appliedId} for planner ID ${plannerId}.`);
  if (enchantOutput[plannerId] && plannerId !== appliedId)
    throw new Error(`Planner enchant ID ${plannerId} conflicts with a canonical enchant.`);
  record.p = plannerId;
  if (plannerId !== appliedId)
    enchantOutput[plannerId] = { ...record, a: 1, c: appliedId };
}

fs.writeFileSync(
  new URL("../item-db.js", import.meta.url),
  `globalThis.ITEM_DB=${JSON.stringify(output)};\nglobalThis.GEM_DB=${JSON.stringify(gemOutput)};\nglobalThis.ENCHANT_DB=${JSON.stringify(enchantOutput)};\n`,
);
console.log(
  `Wrote ${Object.keys(output).length} items, ${Object.keys(gemOutput).length} gems, and ${Object.keys(enchantOutput).length} enchants.`,
);
