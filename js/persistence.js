(function (root) {
  "use strict";

  const { STATS, MAIN_STAT, MAX_GEMS, number, blankItem } =
    root.ReforgePlanner.model;


  const CURRENT_SETUP_COOKIE = "reforgePlannerCurrent";
  const CURRENT_SETUP_STORAGE_KEY = "reforgePlanner.currentSetup.v1";
  const COOKIE_CHUNK_SIZE = 3000;
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

  function cookieMap(cookieText = "") {
    return Object.fromEntries(
      cookieText
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const separator = part.indexOf("=");
          return separator < 0
            ? [part, ""]
            : [part.slice(0, separator), part.slice(separator + 1)];
        }),
    );
  }

  function writeCookie(name, value, documentRef) {
    documentRef.cookie = `${name}=${value}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
  }

  function expireCookie(name, documentRef) {
    documentRef.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  }

  function saveCurrentSetup(
    state,
    { documentRef = globalThis.document, storage = globalThis.localStorage } = {},
  ) {
    const serialized = serializeSetup(state);
    let savedToCookies = false;

    if (documentRef && typeof documentRef.cookie === "string") {
      try {
        const encoded = encodeURIComponent(serialized);
        const chunks = [];
        for (let index = 0; index < encoded.length; index += COOKIE_CHUNK_SIZE)
          chunks.push(encoded.slice(index, index + COOKIE_CHUNK_SIZE));

        const previousCount = Number(
          cookieMap(documentRef.cookie)[`${CURRENT_SETUP_COOKIE}.count`] || 0,
        );
        writeCookie(`${CURRENT_SETUP_COOKIE}.count`, String(chunks.length), documentRef);
        chunks.forEach((chunk, index) =>
          writeCookie(`${CURRENT_SETUP_COOKIE}.${index}`, chunk, documentRef),
        );
        for (let index = chunks.length; index < previousCount; index++)
          expireCookie(`${CURRENT_SETUP_COOKIE}.${index}`, documentRef);
        savedToCookies =
          Number(cookieMap(documentRef.cookie)[`${CURRENT_SETUP_COOKIE}.count`]) ===
          chunks.length;
      } catch {
        savedToCookies = false;
      }
    }

    if (!savedToCookies && storage)
      storage.setItem(CURRENT_SETUP_STORAGE_KEY, serialized);
    else if (savedToCookies && storage)
      storage.removeItem(CURRENT_SETUP_STORAGE_KEY);

    return serialized;
  }

  function loadCurrentSetup(
    { documentRef = globalThis.document, storage = globalThis.localStorage } = {},
  ) {
    if (documentRef && typeof documentRef.cookie === "string") {
      const cookies = cookieMap(documentRef.cookie);
      const count = Number(cookies[`${CURRENT_SETUP_COOKIE}.count`] || 0);
      if (Number.isInteger(count) && count > 0) {
        const chunks = Array.from(
          { length: count },
          (_, index) => cookies[`${CURRENT_SETUP_COOKIE}.${index}`],
        );
        if (chunks.every((chunk) => typeof chunk === "string"))
          return decodeURIComponent(chunks.join(""));
      }
    }
    return storage?.getItem(CURRENT_SETUP_STORAGE_KEY) || null;
  }



  function setupPayload(state) {
    const { wowheadProfile: _legacyWowheadProfile, ...payload } = state || {};
    return payload;
  }

  const COMPACT_SETUP_PREFIX = "RFP1:";

  function bytesToBase64Url(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize)
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    return btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
  }

  function base64UrlToBytes(value) {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function serializeCompactSetup(state) {
    if (typeof CompressionStream !== "function")
      throw new Error("Compact exports are not supported by this browser.");
    const payload = JSON.stringify({ format: "ReforgePlanner", version: 1, ...setupPayload(state) });
    const compressed = new Blob([new TextEncoder().encode(payload)])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
    return COMPACT_SETUP_PREFIX + bytesToBase64Url(bytes);
  }

  async function parseCompactSetup(input) {
    const value = String(input || "").trim();
    if (!value.startsWith(COMPACT_SETUP_PREFIX))
      throw new Error("This is not a Reforge Planner compact export.");
    if (typeof DecompressionStream !== "function")
      throw new Error("Compact imports are not supported by this browser.");
    try {
      const compressed = new Blob([
        base64UrlToBytes(value.slice(COMPACT_SETUP_PREFIX.length)),
      ])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));
      const text = new TextDecoder().decode(
        await new Response(compressed).arrayBuffer(),
      );
      return parseSetup(text);
    } catch (error) {
      throw new Error("The compact Reforge Planner export is invalid or damaged.", {
        cause: error,
      });
    }
  }

  function serializeSetup(state) {
    return JSON.stringify(
      { format: "ReforgePlanner", version: 1, ...setupPayload(state) },
      null,
      2,
    );
  }

  function parseSetup(input) {
    const setup = typeof input === "string" ? JSON.parse(input) : input;
    if (setup?.format !== "ReforgePlanner")
      throw new Error("This is not a Reforge Planner export.");
    return setup;
  }

  function quoteCsv(value) {
    return `"${String(value).replaceAll('"', '""')}"`;
  }

  function serializeGearCsv(items) {
    return [
      [
        "Item ID",
        "Variant",
        "Item",
        MAIN_STAT,
        ...STATS,
        "Gem IDs",
        "Enchant IDs",
      ].join(","),
      ...items.map((item) =>
        [
          item.id || "",
          item.randomEnchantId || "",
          item.name,
          item.mainStat || 0,
          ...STATS.map((stat) => item.stats[stat]),
          (item.gemIds || []).join(";"),
          (item.enchantIds || []).join(";"),
        ]
          .map(quoteCsv)
          .join(","),
      ),
    ].join("\n");
  }

  function splitCsvLine(line) {
    const values = [];
    let value = "",
      quoted = false;
    for (let index = 0; index <= line.length; index++) {
      const character = line[index];
      if (character === '"' && quoted && line[index + 1] === '"') {
        value += '"';
        index++;
      } else if (character === '"') quoted = !quoted;
      else if ((character === "," || index === line.length) && !quoted) {
        values.push(value.trim());
        value = "";
      } else value += character || "";
    }
    return values;
  }

  function parseGearCsv(text, { fillLocal = null } = {}) {
    const rows = text.trim().split(/\r?\n/).map(splitCsvLine),
      header = rows.shift().map((value) => value.toLowerCase());
    return rows
      .filter((row) => row.some(Boolean))
      .map((row, index) => {
        const id =
            row[header.indexOf("item id")] || row[header.indexOf("id")] || "",
          item = blankItem(
            row[header.indexOf("item")] || `Item ${index + 1}`,
          ),
          variant =
            row[header.indexOf("variant")] ||
            row[header.indexOf("suffix")] ||
            "";
        item.id = id;
        item.randomEnchantId = variant;
        if (id && !variant && typeof fillLocal === "function")
          fillLocal(item, id);
        item.mainStat = Math.max(
          0,
          number(
            header.includes(MAIN_STAT.toLowerCase())
              ? row[header.indexOf(MAIN_STAT.toLowerCase())]
              : item.mainStat,
          ),
        );
        item.gemIds = (row[header.indexOf("gem ids")] || "")
          .split(/[ ;]+/)
          .map((value) => Math.floor(number(value)))
          .filter(Boolean)
          .slice(0, MAX_GEMS);
        item.enchantIds = (row[header.indexOf("enchant ids")] || "")
          .split(/[ ;]+/)
          .map((value) => Math.floor(number(value)))
          .filter(Boolean)
          .slice(0, 1);
        STATS.forEach((stat) => {
          if (header.includes(stat.toLowerCase()))
            item.stats[stat] = Math.max(
              0,
              number(row[header.indexOf(stat.toLowerCase())]),
            );
        });
        return item;
      });
  }

  root.ReforgePlanner.persistence = Object.freeze({
    serializeSetup,
    parseSetup,
    serializeCompactSetup,
    parseCompactSetup,
    serializeGearCsv,
    parseGearCsv,
    saveCurrentSetup,
    loadCurrentSetup,
  });
})(globalThis);
