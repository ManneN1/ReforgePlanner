(function (root) {
  "use strict";

  const ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const SLOT_NAMES = {
    1: "Head",
    2: "Neck",
    3: "Shoulder",
    5: "Chest",
    6: "Waist",
    7: "Legs",
    8: "Feet",
    9: "Wrist",
    10: "Hands",
    11: "Finger 1",
    12: "Finger 2",
    13: "Trinket 1",
    14: "Trinket 2",
    15: "Back",
    16: "Main hand",
    17: "Off hand",
    18: "Ranged",
  };

  function payloadFrom(value) {
    const input = String(value || "").trim();
    if (!input) throw new Error("Paste a Wowhead Cataclysm gear-planner link.");
    if (/^[A-Za-z0-9_-]+$/.test(input)) return input;
    let url;
    try {
      url = new URL(input);
    } catch {
      throw new Error("That is not a valid URL.");
    }
    if (!/(^|\.)wowhead\.com$/i.test(url.hostname))
      throw new Error("The link must be from wowhead.com.");
    const match = url.pathname.match(
      /\/cata\/gear-planner\/[^/]+\/[^/]+\/([A-Za-z0-9_-]+)\/?$/i,
    );
    if (!match)
      throw new Error("This is not a Cataclysm Wowhead gear-planner link.");
    return match[1];
  }

  function parse(value) {
    const payload = payloadFrom(value);
    const version = ALPHABET.indexOf(payload[0]);
    if (version < 0 || version > 4)
      throw new Error(
        `Unsupported Wowhead planner format version (${version}).`,
      );
    const values = [...payload.slice(1)].map((char) => ALPHABET.indexOf(char));
    if (values.some((value) => value < 0))
      throw new Error(
        "The Wowhead planner payload contains invalid characters.",
      );

    function read() {
      if (!values.length)
        throw new Error("The Wowhead planner payload ended unexpectedly.");
      let offset = 0,
        bytes = 1,
        first = values[0];
      while ((first & 32) > 0) {
        bytes++;
        first <<= 1;
      }
      if (bytes > 5 || values.length < bytes)
        throw new Error("The Wowhead planner payload is malformed.");
      let result = values.shift() & (63 >> bytes);
      bytes--;
      for (let index = 1; index <= bytes; index++) {
        offset += 1 << (5 * index);
        result = result * 64 + (values.shift() || 0);
      }
      return result + offset;
    }

    const dataEnv = version >= 2 ? read() : null;
    const gender = read() - 1;
    const level = read();

    // Cataclysm uses the three-tree classic talent encoding. Only its length
    // matters here, so consume it without interpreting the actual talents.
    for (let tree = 0; tree < 3; tree++) {
      let talentCount = read();
      while (talentCount > 0) {
        read();
        talentCount -= Math.min(talentCount, 7);
      }
    }
    const glyphHashLength = read();
    if (values.length < glyphHashLength)
      throw new Error("The Wowhead glyph payload is malformed.");
    values.splice(0, glyphHashLength);

    const itemCount = read();
    if (itemCount > 30)
      throw new Error("The Wowhead planner contains an invalid item count.");
    const items = [];
    for (let index = 0; index < itemCount; index++) {
      let hasRandom = false,
        hasUpgrade = false,
        hasReforge = false,
        gemCount = 0,
        enchantCount = 0;
      if (version === 0) {
        const flags = values.shift();
        hasRandom = !!((flags >> 5) & 1);
        gemCount = (flags >> 2) & 7;
        enchantCount = flags & 3;
      } else if (version <= 2) {
        const flags = read();
        hasRandom = !!((flags >> 6) & 1);
        hasReforge = !!((flags >> 5) & 1);
        gemCount = (flags >> 2) & 7;
        enchantCount = flags & 3;
      } else {
        const flags = read();
        hasRandom = !!((flags >> 7) & 1);
        hasUpgrade = !!((flags >> 6) & 1);
        hasReforge = !!((flags >> 5) & 1);
        gemCount = (flags >> 2) & 7;
        enchantCount = flags & 3;
      }
      const slotId = read(),
        itemId = read();
      let randomEnchantId;
      if (hasRandom) {
        let packedRandom = read();
        const negative = !!(packedRandom & 1);
        packedRandom >>= 1;
        randomEnchantId = negative ? -packedRandom : packedRandom;
      }
      if (hasUpgrade) read();
      if (hasReforge) read();
      const gemIds = [],
        enchantIds = [];
      while (gemCount-- > 0) gemIds.push(read());
      while (enchantCount-- > 0) enchantIds.push(read());
      if (SLOT_NAMES[slotId] && itemId)
        items.push({
          slotId,
          slotName: SLOT_NAMES[slotId],
          itemId,
          randomEnchantId,
          gemIds,
          enchantIds,
        });
    }
    if (!items.length)
      throw new Error(
        "No supported gear slots were found in that Wowhead link.",
      );
    return { version, dataEnv, gender, level, items };
  }

  root.parseWowheadGearPlanner = parse;
  if (typeof module !== "undefined" && module.exports) module.exports = parse;
})(typeof globalThis !== "undefined" ? globalThis : this);
