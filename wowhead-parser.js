(function (root) {
  "use strict";

  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const SLOT_NAMES = {1:"Head",2:"Neck",3:"Shoulder",5:"Chest",6:"Waist",7:"Legs",8:"Feet",9:"Wrist",10:"Hands",11:"Finger 1",12:"Finger 2",13:"Trinket 1",14:"Trinket 2",15:"Back",16:"Main hand",17:"Off hand",18:"Ranged"};
  const SLOT_IDS = Object.fromEntries(Object.entries(SLOT_NAMES).map(([id,name]) => [name, Number(id)]));
  const REFORGE_IDS = {"Spirit->Dodge":113,"Spirit->Parry":114,"Spirit->Hit":115,"Spirit->Crit":116,"Spirit->Haste":117,"Spirit->Expertise":118,"Spirit->Mastery":119,"Dodge->Spirit":120,"Dodge->Parry":121,"Dodge->Hit":122,"Dodge->Crit":123,"Dodge->Haste":124,"Dodge->Expertise":125,"Dodge->Mastery":126,"Parry->Spirit":127,"Parry->Dodge":128,"Parry->Hit":129,"Parry->Crit":130,"Parry->Haste":131,"Parry->Expertise":132,"Parry->Mastery":133,"Hit->Spirit":134,"Hit->Dodge":135,"Hit->Parry":136,"Hit->Crit":137,"Hit->Haste":138,"Hit->Expertise":139,"Hit->Mastery":140,"Crit->Spirit":141,"Crit->Dodge":142,"Crit->Parry":143,"Crit->Hit":144,"Crit->Haste":145,"Crit->Expertise":146,"Crit->Mastery":147,"Haste->Spirit":148,"Haste->Dodge":149,"Haste->Parry":150,"Haste->Hit":151,"Haste->Crit":152,"Haste->Expertise":153,"Haste->Mastery":154,"Expertise->Spirit":155,"Expertise->Dodge":156,"Expertise->Parry":157,"Expertise->Hit":158,"Expertise->Crit":159,"Expertise->Haste":160,"Expertise->Mastery":161,"Mastery->Spirit":162,"Mastery->Dodge":163,"Mastery->Parry":164,"Mastery->Hit":165,"Mastery->Crit":166,"Mastery->Haste":167,"Mastery->Expertise":168};

  function sourceInfo(value) {
    const input = String(value || "").trim();
    if (!input) throw new Error("Paste a Wowhead Cataclysm gear-planner link.");
    if (/^[A-Za-z0-9_-]+$/.test(input)) return { payload: input, classSlug: "warrior", raceSlug: "human" };
    let url;
    try { url = new URL(input); } catch { throw new Error("That is not a valid URL."); }
    if (!/(^|\.)wowhead\.com$/i.test(url.hostname)) throw new Error("The link must be from wowhead.com.");
    const match = url.pathname.match(/\/cata\/gear-planner\/([^/]+)\/([^/]+)\/([A-Za-z0-9_-]+)\/?$/i);
    if (!match) throw new Error("This is not a Cataclysm Wowhead gear-planner link.");
    return { classSlug: match[1], raceSlug: match[2], payload: match[3] };
  }

  function parse(value) {
    const source = sourceInfo(value), payload = source.payload;
    const version = ALPHABET.indexOf(payload[0]);
    if (version < 0 || version > 4) throw new Error(`Unsupported Wowhead planner format version (${version}).`);
    const values = [...payload.slice(1)].map((char) => ALPHABET.indexOf(char));
    if (values.some((entry) => entry < 0)) throw new Error("The Wowhead planner payload contains invalid characters.");
    function read() {
      if (!values.length) throw new Error("The Wowhead planner payload ended unexpectedly.");
      let offset = 0, bytes = 1, first = values[0];
      while ((first & 32) > 0) { bytes++; first <<= 1; }
      if (bytes > 5 || values.length < bytes) throw new Error("The Wowhead planner payload is malformed.");
      let result = values.shift() & (63 >> bytes); bytes--;
      for (let index = 1; index <= bytes; index++) { offset += 1 << (5 * index); result = result * 64 + (values.shift() || 0); }
      return result + offset;
    }
    const dataEnv = version >= 2 ? read() : null;
    const gender = read() - 1, level = read();
    const talentTrees = [];
    for (let tree = 0; tree < 3; tree++) {
      const talentCount = read(), chunks = [];
      let remaining = talentCount;
      while (remaining > 0) { chunks.push(read()); remaining -= Math.min(remaining, 7); }
      talentTrees.push({ talentCount, chunks });
    }
    const glyphHashLength = read();
    if (values.length < glyphHashLength) throw new Error("The Wowhead glyph payload is malformed.");
    const glyphValues = values.splice(0, glyphHashLength), glyphHash = glyphValues.map((entry) => ALPHABET[entry]).join("");
    const itemCount = read();
    if (itemCount > 30) throw new Error("The Wowhead planner contains an invalid item count.");
    const items = [];
    for (let index = 0; index < itemCount; index++) {
      let hasRandom = false, hasUpgrade = false, hasReforge = false, gemCount = 0, enchantCount = 0;
      if (version === 0) { const flags = values.shift(); hasRandom = !!((flags >> 5) & 1); gemCount = (flags >> 2) & 7; enchantCount = flags & 3; }
      else if (version <= 2) { const flags = read(); hasRandom = !!((flags >> 6) & 1); hasReforge = !!((flags >> 5) & 1); gemCount = (flags >> 2) & 7; enchantCount = flags & 3; }
      else { const flags = read(); hasRandom = !!((flags >> 7) & 1); hasUpgrade = !!((flags >> 6) & 1); hasReforge = !!((flags >> 5) & 1); gemCount = (flags >> 2) & 7; enchantCount = flags & 3; }
      const slotId = read(), itemId = read();
      let randomEnchantId, upgradeId, reforgeId;
      if (hasRandom) { let packed = read(); const negative = !!(packed & 1); packed >>= 1; randomEnchantId = negative ? -packed : packed; }
      if (hasUpgrade) upgradeId = read();
      if (hasReforge) reforgeId = read();
      const gemIds = [], enchantIds = [];
      while (gemCount-- > 0) gemIds.push(read());
      while (enchantCount-- > 0) enchantIds.push(read());
      if (SLOT_NAMES[slotId] && itemId) items.push({slotId,slotName:SLOT_NAMES[slotId],itemId,randomEnchantId,upgradeId,reforgeId,gemIds,enchantIds});
    }
    if (!items.length) throw new Error("No supported gear slots were found in that Wowhead link.");
    return { version, classSlug: source.classSlug, raceSlug: source.raceSlug, dataEnv, gender, level, talentTrees, glyphHash, items };
  }

  function writeInteger(value, output) {
    let number = Math.max(0, Math.floor(Number(value) || 0)), bytes = 1, offset = 0, maximum = 31;
    while (number > offset + maximum && bytes < 5) { offset += 1 << (5 * bytes); bytes++; maximum = (1 << (6 * bytes - bytes)) - 1; }
    let encoded = number - offset;
    const digits = Array(bytes).fill(0);
    for (let index = bytes - 1; index > 0; index--) { digits[index] = encoded & 63; encoded = Math.floor(encoded / 64); }
    const prefix = bytes === 1 ? 0 : ((1 << (bytes - 1)) - 1) << (7 - bytes);
    digits[0] = prefix | encoded;
    output.push(...digits);
  }

  function encode(profile = {}) {
    const version = Math.min(4, Math.max(3, Number(profile.version ?? 4))), output = [];
    if (version >= 2) writeInteger(profile.dataEnv ?? 0, output);
    writeInteger((profile.gender ?? 0) + 1, output);
    writeInteger(profile.level || 85, output);
    const trees = profile.talentTrees || [];
    for (let tree = 0; tree < 3; tree++) {
      const record = trees[tree] || { talentCount: 0, chunks: [] };
      writeInteger(record.talentCount || 0, output);
      for (const chunk of record.chunks || []) writeInteger(chunk, output);
    }
    const glyphHash = String(profile.glyphHash || "");
    writeInteger(glyphHash.length, output);
    for (const char of glyphHash) output.push(Math.max(0, ALPHABET.indexOf(char)));
    const items = (profile.items || []).filter((item) => item.itemId && item.slotId);
    writeInteger(items.length, output);
    for (const item of items) {
      const gems = (item.gemIds || []).filter(Boolean).slice(0, 7), enchants = (item.enchantIds || []).filter(Boolean).slice(0, 3);
      const hasRandom = item.randomEnchantId != null && Number(item.randomEnchantId) !== 0, hasUpgrade = item.upgradeId != null, hasReforge = item.reforgeId != null && Number(item.reforgeId) !== 0;
      const flags = (hasRandom ? 128 : 0) | (hasUpgrade ? 64 : 0) | (hasReforge ? 32 : 0) | (gems.length << 2) | enchants.length;
      writeInteger(flags, output); writeInteger(item.slotId, output); writeInteger(item.itemId, output);
      if (hasRandom) { const random = Number(item.randomEnchantId); writeInteger(Math.abs(random) * 2 + (random < 0 ? 1 : 0), output); }
      if (hasUpgrade) writeInteger(item.upgradeId, output);
      if (hasReforge) writeInteger(item.reforgeId, output);
      gems.forEach((id) => writeInteger(id, output)); enchants.forEach((id) => writeInteger(id, output));
    }
    const payload = ALPHABET[version] + output.map((entry) => ALPHABET[entry]).join("");
    return `https://www.wowhead.com/cata/gear-planner/${profile.classSlug || "warrior"}/${profile.raceSlug || "human"}/${payload}`;
  }

  function merge(left, right, selections = {}) {
    const sourceFor = (selection) => selection === "right" ? right : left;
    const talentSource = sourceFor(selections.talents);
    const gearSource = sourceFor(selections.gear);
    const profilesByField = {
      reforgeId: sourceFor(selections.reforges),
      gemIds: sourceFor(selections.gems),
      enchantIds: sourceFor(selections.enchants),
    };
    const itemsByFieldAndSlot = Object.fromEntries(
      Object.entries(profilesByField).map(([field, profile]) => [
        field,
        new Map((profile.items || []).map((item) => [item.slotId, item])),
      ]),
    );
    const result = {
      ...gearSource,
      classSlug: talentSource.classSlug,
      raceSlug: talentSource.raceSlug,
      dataEnv: talentSource.dataEnv,
      gender: talentSource.gender,
      level: talentSource.level,
      talentTrees: structuredClone(talentSource.talentTrees || []),
      glyphHash: talentSource.glyphHash || "",
      items: structuredClone(gearSource.items || []),
    };
    result.items = result.items.map((item) => {
      const merged = { ...item };
      for (const field of ["reforgeId", "gemIds", "enchantIds"]) {
        const counterpart = itemsByFieldAndSlot[field].get(item.slotId);
        merged[field] = counterpart
          ? structuredClone(counterpart[field] ?? (field === "reforgeId" ? undefined : []))
          : (field === "reforgeId" ? undefined : []);
      }
      return merged;
    });
    return result;
  }

  function reforgeId(source, destination) { return REFORGE_IDS[`${source}->${destination}`] || 0; }
  function slotId(slotName) { return SLOT_IDS[slotName] || 0; }

  parse.encode = encode; parse.merge = merge; parse.reforgeId = reforgeId; parse.slotId = slotId;
  root.parseWowheadGearPlanner = parse;
  root.encodeWowheadGearPlanner = encode;
  root.mergeWowheadGearPlanners = merge;
  if (typeof module !== "undefined" && module.exports) module.exports = parse;
})(typeof globalThis !== "undefined" ? globalThis : this);
