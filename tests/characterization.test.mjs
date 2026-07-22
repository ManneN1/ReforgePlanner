import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(projectRoot, "index.html"), "utf8");
const script = readFileSync(resolve(projectRoot, "app.js"), "utf8");
const styles = readFileSync(resolve(projectRoot, "styles.css"), "utf8");
const moduleContext = {
  globalThis: null,
  setTimeout,
  structuredClone,
  Map,
  CompressionStream,
  DecompressionStream,
  TextEncoder,
  TextDecoder,
  Blob,
  Response,
  btoa,
  atob,
};
moduleContext.globalThis = moduleContext;
for (const file of [
  "model.js",
  "items.js",
  "optimizer.js",
  "combinations.js",
  "persistence.js",
  "modal.js",
])
  vm.runInNewContext(
    readFileSync(resolve(projectRoot, "js", file), "utf8"),
    moduleContext,
    { filename: file },
  );
const modules = moduleContext.ReforgePlanner;

assert.ok(script, "The application script should be present");

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

function createRuntime(state, itemDb = {}, gemDb = {}, enchantDb = {}) {
  const databases = { itemDb, gemDb, enchantDb };
  const combinationOptions = {
    rules: state.comboRules || [],
    baseItems: state.items || [],
    itemDb,
  };
  return {
    fixedSlotItems: modules.model.normalizeFixedItems,
    countCandidateRange: (items, count, method) =>
      modules.combinations.countCandidateRange(
        items,
        count,
        method,
        combinationOptions,
      ),
    iterateCandidateRange: (items, count, method) =>
      modules.combinations.iterateCandidateRange(
        items,
        count,
        method,
        combinationOptions,
      ),
    optionsFor: (currentItem, caps) =>
      modules.optimizer.optionsFor(currentItem, caps, state.weights),
    capAllows: modules.optimizer.capAllows,
    calculate: (items) => modules.optimizer.optimize(items, state, databases),
    compareOptimizedResults: (left, right) =>
      modules.optimizer.compareOptimizedResults(left, right, state.weights),
    parseCsv: (text) =>
      modules.persistence.parseGearCsv(text, {
        fillLocal: modules.items.createItemRepository({ itemDb }).fillLocal,
      }),
  };
}

function emptyStats(overrides = {}) {
  return Object.fromEntries(STATS.map((stat) => [stat, overrides[stat] || 0]));
}

function item(slot, stats = {}, extra = {}) {
  return {
    slot,
    id: "",
    name: `${slot} test item`,
    mainStat: 0,
    gemIds: [],
    enchantIds: [],
    twoHanded: false,
    stats: emptyStats(stats),
    ...extra,
  };
}

function baseState(overrides = {}) {
  return {
    weights: Object.fromEntries(TOTAL_STATS.map((stat) => [stat, 0])),
    baseline: Object.fromEntries(TOTAL_STATS.map((stat) => [stat, 0])),
    caps: [
      { stat: "None", rules: [{ method: "atleast", value: 0, after: 0 }] },
      { stat: "None", rules: [{ method: "atleast", value: 0, after: 0 }] },
    ],
    items: [item("Main hand")],
    candidates: [],
    comboRules: [],
    ...overrides,
  };
}

test("reforge options convert exactly 40% and cannot target an existing stat", () => {
  const state = baseState();
  state.weights.Hit = 1;
  const { optionsFor } = createRuntime(state);
  const options = optionsFor(
    item("Head", { Crit: 101, Mastery: 20 }),
    state.caps,
  );

  assert.ok(
    options.some(
      (option) =>
        option.src === "Crit" && option.dst === "Hit" && option.amount === 40,
    ),
  );
  assert.ok(
    !options.some(
      (option) => option.src === "Crit" && option.dst === "Mastery",
    ),
  );
});


test("socket colors are metadata only and socket bonuses belong in baseline stats", () => {
  const itemDb = {
    100: { k: [2, 3], b: { m: 10, s: [0, 0, 0, 0, 0, 0, 0, 5] } },
  };
  const gemDb = {
    1: { c: 5, m: 0, s: [0, 0, 0, 0, 10, 0, 0, 0] },
    2: { c: 7, m: 0, s: [0, 0, 0, 0, 0, 10, 0, 0] },
  };
  const bonuses = modules.optimizer.equipmentBonuses(
    item("Head", {}, {
      id: "100",
      gemIds: [1, 2],
      socketColors: [2, 3],
      gemBonus: { [MAIN_STAT]: 10, Mastery: 5 },
    }),
    { itemDb, gemDb, enchantDb: {} },
  );
  assert.equal(bonuses[MAIN_STAT], 0);
  assert.equal(bonuses.Mastery, 0);
  assert.equal(bonuses.Crit, 10);
  assert.equal(bonuses.Haste, 10);
});

test("optimizer prioritizes meeting a configured breakpoint", async () => {
  const state = baseState({
    weights: { ...baseState().weights, Mastery: 2, Crit: 1 },
    caps: [
      { stat: "Hit", rules: [{ method: "atleast", value: 60, after: 0 }] },
      { stat: "None", rules: [{ method: "atleast", value: 0, after: 0 }] },
    ],
  });
  const { calculate } = createRuntime(state);
  const result = await calculate(
    [item("Head", { Crit: 100 }), item("Shoulder", { Crit: 50 })],
    false,
  );

  assert.equal(result.totals.Hit, 60);
  assert.equal(result.allCapsMet, true);
});



test("cap rules switch to their configured after weight", () => {
  const weights = { ...baseState().weights, Hit: 2 };
  const cap = {
    stat: "Hit",
    rules: [{ method: "atleast", value: 100, after: 0.25 }],
  };
  assert.equal(modules.optimizer.capScore(cap, 80, weights), 160);
  assert.equal(modules.optimizer.capScore(cap, 140, weights), 210);
  assert.doesNotMatch(script, /\+ Breakpoint|method: "new"|Weight breakpoint/);
});

test("legacy weight breakpoint exports migrate into the matching cap rule", () => {
  const normalized = modules.model.normalizeCaps([
    {
      stat: "Hit",
      rules: [
        { method: "atleast", value: 100, after: 0 },
        { method: "new", value: 100, after: 0.25 },
      ],
    },
  ]);
  assert.equal(
    JSON.stringify(normalized[0]),
    JSON.stringify({
      stat: "Hit",
      rules: [{ method: "atleast", value: 100, after: 0.25 }],
    }),
  );
});



test("candidate count zero includes the base setup whenever the comparison permits it", () => {
  const helm = item("Head", {}, { candidateKey: "helm" });
  const runtime = createRuntime(baseState());

  assert.equal(runtime.countCandidateRange([helm], 0, "exactly"), 1n);
  assert.equal(runtime.countCandidateRange([helm], 0, "atmost"), 1n);
  assert.equal(runtime.countCandidateRange([helm], 0, "atleast"), 2n);

  assert.equal([...runtime.iterateCandidateRange([helm], 0, "exactly")].length, 1);
  assert.equal([...runtime.iterateCandidateRange([helm], 0, "atmost")].length, 1);
  assert.equal([...runtime.iterateCandidateRange([helm], 0, "atleast")].length, 2);
});

test("candidate count input accepts zero without falling back to one", () => {
  assert.match(html, /id="comboCount" type="number" min="0" value="1"/);
  assert.match(script, /configureIntegerField\(\$\("#comboCount"\), "Candidate count", \{ min: 0 \}\)/);
  assert.doesNotMatch(script, /Math\.max\(1, Math\.floor\(n\(\$\("#comboCount"\)/);
});
test("candidate set rules require all selected set members or none", () => {
  const weapon = item("Main hand", {}, { candidateKey: "weapon" });
  const shield = item("Off hand", {}, { candidateKey: "shield" });
  const helm = item("Head", {}, { candidateKey: "helm" });
  const state = baseState({
    comboRules: [{ type: "candidateSet", candidateKeys: ["weapon", "shield"] }],
  });
  const runtime = createRuntime(state);
  const candidates = [weapon, shield, helm];
  assert.equal(runtime.countCandidateRange(candidates, 1, "exactly"), 1n);
  assert.equal(runtime.countCandidateRange(candidates, 2, "exactly"), 1n);
  const pairs = [...runtime.iterateCandidateRange(candidates, 2, "exactly")];
  assert.equal(pairs.length, 1);
  assert.deepEqual(Array.from(pairs[0], (entry) => entry.candidateKey), ["weapon", "shield"]);
});

test("item count rules support at least, at most, and exactly across base and candidate items", () => {
  const baseHead = item("Head");
  const shoulder = item("Shoulder", {}, { candidateKey: "shoulder" });
  const chest = item("Chest", {}, { candidateKey: "chest" });
  const refs = ["base:Head", "candidate:shoulder", "candidate:chest"];
  const expected = new Map([
    ["atleast", 2n],
    ["exactly", 2n],
    ["atmost", 0n],
  ]);
  for (const [method, total] of expected) {
    const state = baseState({
      items: [baseHead],
      comboRules: [{ type: "itemCount", method, value: method === "atmost" ? 1 : 2, itemRefs: refs }],
    });
    const runtime = createRuntime(state);
    assert.equal(runtime.countCandidateRange([shoulder, chest], 1, "exactly"), total);
    assert.equal(
      BigInt([...runtime.iterateCandidateRange([shoulder, chest], 1, "exactly")].length),
      total,
    );
  }
});

test("item count rules count the final equipped setup after replacements", () => {
  const baseHead = item("Head");
  const candidateHead = item("Head", {}, { candidateKey: "new-head" });
  const state = baseState({
    items: [baseHead],
    comboRules: [{
      type: "itemCount",
      method: "exactly",
      value: 1,
      itemRefs: ["base:Head", "candidate:new-head"],
    }],
  });
  const runtime = createRuntime(state);
  assert.equal(runtime.countCandidateRange([candidateHead], 1, "exactly"), 1n);
  assert.equal([...runtime.iterateCandidateRange([candidateHead], 1, "exactly")].length, 1);
});

test("item count rule UI blocks partial Candidate Set selections", () => {
  assert.match(html, /id="addItemCountRule">\+ Item Count/);
  assert.match(script, /type: "itemCount"/);
  assert.match(script, /Select either all or none of the candidates from Candidate Set/);
  assert.match(script, /\["atleast", "At least"\]/);
  assert.match(script, /\["atmost", "At most"\]/);
  assert.match(script, /\["exactly", "Exactly"\]/);
});

test("Cogwheel gems and sockets use their own database color", () => {
  assert.match(script, /\[9, "Cogwheel"\]/);
  assert.match(styles, /\.socket-border-cogwheel \{ --socket-border: #9bd7d5; \}/);
  assert.match(styles, /\.gem-color-cogwheel \{ color: #9bd7d5; \}/);
  const database = readFileSync(resolve(projectRoot, "item-db.js"), "utf8");
  assert.match(database, /"59477":\{"n":"Subtle Cogwheel"[^}]*"c":9\}/);
});

test("Main stat follows its configured priority in Lab ranking", () => {
  const state = baseState();
  const { compareOptimizedResults } = createRuntime(state);
  const lowerMainHigherCrit = {
    allCapsMet: true,
    capResults: [],
    totals: { ...state.baseline, [MAIN_STAT]: 100, Crit: 20 },
  };
  const higherMainLowerCrit = {
    allCapsMet: true,
    capResults: [],
    totals: { ...state.baseline, [MAIN_STAT]: 500, Crit: 10 },
  };

  state.weights.Crit = 200;
  state.weights[MAIN_STAT] = 100;
  assert.ok(
    compareOptimizedResults(higherMainLowerCrit, lowerMainHigherCrit) > 0,
  );

  state.weights[MAIN_STAT] = 300;
  assert.ok(
    compareOptimizedResults(higherMainLowerCrit, lowerMainHigherCrit) < 0,
  );
  assert.match(
    script,
    /const compareRecords = \(left, right\) =>\s*compareOptimizedResults\(left\.result, right\.result\)/,
    "Rendered Lab results should use the canonical comparator",
  );
});

test("combination count and generator agree for rings, rules, and weapons", () => {
  const cases = [
    {
      name: "one ring has two placements",
      state: baseState(),
      candidates: [item("Finger")],
      count: 1,
      expected: 2n,
    },
    {
      name: "2H plus off-hand is excluded",
      state: baseState(),
      candidates: [
        item("Main hand", {}, { twoHanded: true }),
        item("Off hand"),
      ],
      count: 2,
      expected: 0n,
    },
    {
      name: "1H candidate can replace a base 2H and permit an off-hand",
      state: baseState({ items: [item("Main hand", {}, { twoHanded: true })] }),
      candidates: [item("Main hand"), item("Off hand")],
      count: 2,
      expected: 1n,
    },
    {
      name: "slot-group rule limits selected candidates",
      state: baseState({
        comboRules: [{ max: 1, slots: ["Head"] }],
      }),
      candidates: [item("Head"), item("Head"), item("Shoulder")],
      count: 2,
      expected: 2n,
    },
  ];

  for (const current of cases) {
    const runtime = createRuntime(current.state);
    const counted = runtime.countCandidateRange(
      current.candidates,
      current.count,
      "exactly",
    );
    const generated = BigInt(
      [...runtime.iterateCandidateRange(current.candidates, current.count, "exactly")]
        .length,
    );
    assert.equal(counted, current.expected, current.name);
    assert.equal(generated, current.expected, current.name);
  }
});

test("state and CSV normalization enforce gem and enchant limits", () => {
  const state = baseState();
  const { fixedSlotItems, parseCsv } = createRuntime(state);
  const normalized = fixedSlotItems([
    item("Head", {}, { gemIds: [1, 2, 3, 4], enchantIds: [10, 11] }),
  ]).find((entry) => entry.slot === "Head");
  assert.deepEqual(Array.from(normalized.gemIds), [1, 2, 3]);
  assert.deepEqual(Array.from(normalized.enchantIds), [10, 11]);

  const [parsed] = parseCsv(
    'Item,Gem IDs,Enchant IDs\n"Custom","1;2;3;4","10;11"',
  );
  assert.deepEqual(Array.from(parsed.gemIds), [1, 2, 3]);
  assert.deepEqual(Array.from(parsed.enchantIds), [10, 11]);
});

test("Wowhead parser decodes the current Cataclysm planner format", () => {
  const require = createRequire(import.meta.url);
  const parseWowheadGearPlanner = require(resolve(projectRoot, "wowhead-parser.js"));
  const result = parseWowheadGearPlanner(
    "ELBg1AAAAQJB4Gf84IiK4EfU4PPWAC4I-2FD4Gf_4EfM4PPbJF4Gf-4EfU4EfM4J3qJG4GiK4Ef24EfU4MWoBH4Gf94MgrFI4GiL4EfM4J3sBJ4GiP4PPoGK4Gf74Ef24J3v4FK3AL4GjSAM4GjTAN4G_kAO4GlgCP4GlL4KGK4FK6BQ4INb4PDPES4Guu4EfU",
  );

  assert.ok(result.items.length >= 15);
  assert.ok(result.items.every((entry) => entry.itemId > 0 && entry.slotName));
});

test("displayed combination counts use spaces for thousands grouping", () => {
  const { formatCount } = modules.model;
  assert.equal(formatCount(1337), "1 337");
  assert.equal(formatCount(1234567n), "1 234 567");
});

test("item repository keeps local and online lookup behind one interface", async () => {
  const database = { "42": { n: "Local item", m: 12, s: [0, 0, 0, 3, 0, 0, 0, 4] } };
  const repository = modules.items.createItemRepository({
    itemDb: database,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        name: "Online item",
        tooltip: "<!--stat3-->+21<!--rtg32-->17",
      }),
    }),
  });
  const local = modules.model.blankItem("Head");
  assert.equal(repository.fillLocal(local, 42), true);
  assert.equal(local.name, "Local item");
  assert.equal(local.stats.Hit, 3);

  const online = modules.model.blankItem("Head");
  assert.equal(await repository.fillWithFallback(online, 99, -12), "wowhead");
  assert.equal(online.name, "Online item");
  assert.equal(online.mainStat, 21);
  assert.equal(online.stats.Crit, 17);
  assert.equal(online.randomEnchantId, "-12");
});

test("setup and gear persistence round-trip through their public APIs", () => {
  const state = baseState({
      comboCount: 3,
      comboMethod: "atleast",
      wowheadProfile: { classSlug: "warrior", glyphHash: "temporary" },
    }),
    serialized = modules.persistence.serializeSetup(state),
    restored = modules.persistence.parseSetup(serialized);
  assert.equal(restored.format, "ReforgePlanner");
  assert.equal(restored.comboCount, 3);
  assert.equal(restored.comboMethod, "atleast");
  assert.equal(restored.wowheadProfile, undefined);
  assert.doesNotMatch(serialized, /wowheadProfile|glyphHash|temporary/);

  const original = item("Head", { Crit: 17 }, {
    id: "42",
    name: 'Helm, "Test"',
    gemIds: [1, 2, 3],
    enchantIds: [10],
  });
  const csv = modules.persistence.serializeGearCsv([original]);
  const [restoredItem] = modules.persistence.parseGearCsv(csv);
  assert.equal(restoredItem.name, original.name);
  assert.equal(restoredItem.stats.Crit, 17);
  assert.deepEqual(Array.from(restoredItem.gemIds), [1, 2, 3]);
  assert.deepEqual(Array.from(restoredItem.enchantIds), [10]);
});

test("static entry point owns final layout and loads extracted assets", () => {
  assert.match(html, /<link rel="stylesheet" href="styles\.css" \/>/);
  assert.match(html, /<script src="app\.js"><\/script>/);
  assert.match(html, /<script src="js\/model\.js"><\/script>/);
  assert.match(html, /<script src="js\/items\.js"><\/script>/);
  assert.match(html, /<script src="js\/optimizer\.js"><\/script>/);
  assert.match(html, /<script src="js\/combinations\.js"><\/script>/);
  assert.match(html, /<script src="js\/persistence\.js"><\/script>/);
  assert.match(html, /<script src="js\/modal\.js"><\/script>/);
  assert.doesNotMatch(html, /<style>|style="|<script>\s*const STATS/);
  assert.doesNotMatch(script, /pageGrid\.after|\$\("#gearCard"\)\.append/);
  assert.doesNotMatch(script, /function\*?\s+iterateCandidateRange\s*\(/);
  assert.doesNotMatch(script, /function\s+parseCsv\s*\(/);

  const gearIndex = html.indexOf('id="gearCard"');
  const resultsIndex = html.indexOf('id="results"');
  const labIndex = html.indexOf('id="comboLab"');
  assert.ok(gearIndex >= 0 && gearIndex < resultsIndex);
  assert.ok(resultsIndex < labIndex);
});

test("shared styles remain valid and avoid specificity escapes", () => {
  assert.match(styles, /--surface-input:/);
  assert.match(styles, /--line-soft:/);
  assert.match(styles, /\/\* Responsive overrides \*\//);
  assert.doesNotMatch(styles, /!important/);
  assert.doesNotMatch(styles, /\\n/);

  const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  for (const character of withoutComments) {
    if (character === "{") depth++;
    if (character === "}") depth--;
    assert.ok(depth >= 0, "CSS must not contain an unmatched closing brace");
  }
  assert.equal(depth, 0, "CSS blocks must be balanced");
});

test("Phase 7 semantics and accessibility contracts remain intact", () => {
  assert.match(html, /<meta name="description" content="[^"]+" \/>/);
  assert.match(
    html,
    /id="modal" role="dialog" hidden aria-modal="true" aria-labelledby="setupDialogTitle"/,
  );
  assert.match(
    html,
    /id="wowheadModal" role="dialog" hidden aria-modal="true" aria-labelledby="wowheadDialogTitle"/,
  );
  assert.match(html, /<label class="visually-hidden"(?: id="dataBoxLabel")? for="dataBox">/);
  assert.match(html, /<label class="visually-hidden" for="wowheadLink">/);
  assert.match(html, /id="status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /id="comboProgress" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /<th scope="col" aria-sort="none">/);
  assert.match(html, /<tr id="gearHead"><\/tr>/);
  assert.match(html, /<tr id="candidateHead"><\/tr>/);
  assert.match(script, /const ITEM_EDITOR_COLUMNS = \[/);
  assert.match(script, /function renderItemEditorHeader\(/);
  assert.match(html, /id="toggleResults"[^>]+aria-expanded="true"/);
  assert.match(script, /setAttribute\("aria-expanded", String\(!collapsed\)\)/);
  assert.match(script, /button\.closest\("th"\)\.setAttribute\(/);
  assert.match(script, /const originalRank = defaultRank\.get\(record\)/);
  assert.match(script, /class="combo-main-row" tabindex="0" role="button"/);
  assert.match(script, /aria-controls="\$\{detailId\}"/);
  assert.match(script, /row\.onkeydown =/);
  assert.doesNotMatch(script, /class="secondary combo-toggle"/);
  assert.match(script, /ariaLabel: `Remove candidate \$\{index \+ 1\}`/);
  assert.match(script, /type: "button",\n\s+title: "Remove Rule"/);

  const modalScript = readFileSync(resolve(projectRoot, "js", "modal.js"), "utf8");
  assert.match(modalScript, /event\.key === "Escape"/);
  assert.match(modalScript, /element\.hidden = false/);
  assert.match(modalScript, /element\.hidden = true/);
  assert.match(modalScript, /returnFocus\?\.isConnected/);
  assert.match(styles, /input:focus-visible/);
  assert.match(styles, /textarea:focus-visible/);
  assert.match(styles, /\.visually-hidden \{/);
});

test("Combination Lab keeps candidate actions and empty state in a labelled candidate section", () => {
  const rulesIndex = html.indexOf('class="candidate-rules"');
  const candidateHeadingIndex = html.indexOf('<h3>Candidates</h3>');
  const addCandidateIndex = html.indexOf('id="addCandidate"');
  const candidateTableIndex = html.indexOf('class="item-editor-table candidate-table"');
  assert.ok(rulesIndex >= 0 && candidateHeadingIndex > rulesIndex);
  assert.ok(addCandidateIndex > candidateHeadingIndex);
  assert.ok(candidateTableIndex > addCandidateIndex);
  assert.match(script, /className: "item-editor-empty"/);
  assert.match(script, /No candidates added yet\. Use Add Candidate to create one\./);
  assert.match(styles, /\.candidate-table-wrap \{[\s\S]*?min-height:\s*0;/);
  assert.match(styles, /\.item-editor-empty td \{[\s\S]*?height:\s*72px;/);
  assert.match(styles, /\.item-editor-table \{/);
  assert.match(styles, /\.candidate-section-head \{/);
  assert.match(styles, /\.item-editor-table th \{[\s\S]*?text-align:\s*center;/);
});

test("application orchestration is scope-contained and validates module startup", () => {
  assert.match(script, /^\(\(\) => \{\n  "use strict";/);
  assert.match(script, /const requiredNamespaces = \[/);
  for (const namespace of [
    "model",
    "items",
    "optimizer",
    "combinations",
    "persistence",
    "modal",
  ]) {
    assert.match(script, new RegExp(`"${namespace}"`));
  }
  assert.match(script, /missingNamespaces\.join\(", "\)/);
  assert.match(script, /\n\}\)\(\);\s*$/);
});



test("Combination Rules panel is visually distinct and slot menus are not clipped", () => {
  const css = readFileSync(resolve(projectRoot, "styles.css"), "utf8");
  assert.match(css, /#comboLab\s*\{[^}]*overflow:\s*visible/s);
  assert.match(css, /\.candidate-rules\s*\{[^}]*padding:\s*16px 20px[^}]*border-bottom:\s*1px solid var\(--line\)/s);
  assert.doesNotMatch(css, /\.candidate-rules\s*\{[^}]*background:/s);
  assert.doesNotMatch(css, /\.candidate-rules\s*\{[^}]*border-radius:/s);
  assert.match(css, /\.candidate-rules\s*\{[^}]*z-index:\s*3/s);
  assert.match(css, /\.combo-controls\s*\{[^}]*z-index:\s*1/s);
});

test("Gear and Candidate editors share labels, cell builders, and centered alignment", () => {
  assert.match(script, /const ITEM_EDITOR_COLUMNS = \[[\s\S]*?"Name"/);
  assert.doesNotMatch(script, /const ITEM_EDITOR_COLUMNS = \[[\s\S]*?"Item",/);
  assert.match(script, /function appendItemEditorCell\(/);
  assert.match(script, /function createItemEditorNameInput\(/);
  assert.match(script, /function createItemEditorStatInput\(/);
  assert.ok((script.match(/createItemEditorNameInput\(/g) || []).length >= 3);
  assert.ok((script.match(/createItemEditorStatInput\(/g) || []).length >= 5);
  assert.match(styles, /\.item-editor-table td \{[\s\S]*?text-align:\s*center;[\s\S]*?vertical-align:\s*middle;/);
  assert.match(styles, /\.item-editor-table input,[\s\S]*?\.item-editor-table select \{[\s\S]*?text-align:\s*center;[\s\S]*?text-align-last:\s*center;/);
});


test("stat weight labels render above their inputs", () => {
  assert.match(styles, /\.weights label\s*\{[^}]*grid-template-rows:\s*auto auto/s);
  assert.doesNotMatch(styles, /\.weights label\s*\{[^}]*grid-template-columns:/s);
});

test("gem and socket color enums match the database schema", () => {
  assert.match(script, /const SOCKET_COLORS = Object\.freeze\(\[\s*\[1, "Meta"\],\s*\[2, "Red"\],\s*\[3, "Blue"\],\s*\[4, "Yellow"\],\s*\[5, "Green"\],\s*\[6, "Orange"\],\s*\[7, "Purple"\],\s*\[8, "Prismatic"\]/s);
  const database = readFileSync(resolve(projectRoot, "item-db.js"), "utf8");
  assert.match(database, /"52212":\{"n":"Delicate Inferno Ruby"[^}]*"c":2\}/);
  assert.match(database, /"52235":\{"n":"Rigid Ocean Sapphire"[^}]*"c":3\}/);
  assert.match(database, /"52219":\{"n":"Fractured Amberjewel"[^}]*"c":4\}/);
  assert.match(database, /"52218":\{"n":"Forceful Dream Emerald"[^}]*"c":5\}/);
  assert.match(database, /"52204":\{"n":"Adept Ember Topaz"[^}]*"c":6\}/);
  assert.match(database, /"52213":\{"n":"Etched Demonseye"[^}]*"c":7\}/);
});

test("gem colors are read-only visual cues", () => {
  assert.doesNotMatch(script, /createSocketColorControl|socket-color-select|Socket \$\{socket \+ 1\} color/);
  assert.match(script, /function|const applyKnownSocketColor/);
  assert.match(script, /appendGemOptions\(gem, item\.gemIds\?\.\[socket\]\)/);
  assert.match(script, /applySelectedGemColor\(gem\)/);
  assert.match(styles, /\.gear-socket select\.known-socket,[\s\S]*?border-color:\s*var\(--socket-border/);
  assert.match(styles, /\.gem-color-red \{ color:/);
  assert.match(styles, /\.socket-border-meta \{ --socket-border: #d6e1e8; \}/);
  assert.match(styles, /\.gem-color-meta \{ color: #d6e1e8; \}/);
  assert.doesNotMatch(styles, /\.gem-color-meta \{ color: #c9a8ff; \}/);
  assert.doesNotMatch(styles, /\.gear-socket\.known-socket|\.candidate-socket\.known-socket/);
  assert.match(styles, /input:focus-visible,[\s\S]*?outline:\s*none;[\s\S]*?box-shadow:\s*none;/);
});


test("footer credits distinguish the creator from acknowledgements", () => {
  const html = readFileSync(resolve(projectRoot, "index.html"), "utf8");
  const app = readFileSync(resolve(projectRoot, "app.js"), "utf8");

  assert.match(html, /<footer class="site-footer"/);
  assert.doesNotMatch(html, /Created by ManneN/);
  assert.match(html, /github\.com\/ManneN1/);
  assert.match(html, /ReforgeLite Engine/);
  assert.match(html, /Cataclysm Item Database/);
  assert.match(html, /Special thanks to/);
  assert.match(html, /github\.com\/d07RiV/);
  assert.match(html, /github\.com\/wowsims\/cata/);
  assert.match(html, /href="LICENSE"/);
  assert.match(app, /const startYear = 2026/);
  assert.match(app, /footerYear\.textContent/);
});

test("current setup persistence chunks cookies and falls back to local storage", () => {
  const jar = new Map();
  const cookieDocument = {
    get cookie() {
      return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
    },
    set cookie(value) {
      const [pair, ...attributes] = value.split(";").map((part) => part.trim());
      const separator = pair.indexOf("=");
      const key = pair.slice(0, separator);
      const storedValue = pair.slice(separator + 1);
      const maxAge = attributes.find((part) => part.startsWith("Max-Age="));
      if (maxAge === "Max-Age=0") jar.delete(key);
      else jar.set(key, storedValue);
    },
  };
  const storageValues = new Map();
  const storage = {
    getItem: (key) => storageValues.get(key) || null,
    setItem: (key, value) => storageValues.set(key, value),
    removeItem: (key) => storageValues.delete(key),
  };
  const state = baseState({
    candidates: Array.from({ length: 30 }, (_, index) =>
      item("Head", { Hit: index }, { name: `Candidate ${index}` }),
    ),
  });

  modules.persistence.saveCurrentSetup(state, {
    documentRef: cookieDocument,
    storage,
  });
  const saved = modules.persistence.loadCurrentSetup({
    documentRef: cookieDocument,
    storage,
  });
  assert.equal(modules.persistence.parseSetup(saved).candidates.length, 30);
  assert.ok(Number(jar.get("reforgePlannerCurrent.count")) > 1);
  assert.equal(storageValues.size, 0);

  const blockedCookies = { get cookie() { return ""; }, set cookie(_) {} };
  modules.persistence.saveCurrentSetup(state, {
    documentRef: blockedCookies,
    storage,
  });
  assert.ok(storageValues.get("reforgePlanner.currentSetup.v1"));
  assert.equal(
    modules.persistence.parseSetup(
      modules.persistence.loadCurrentSetup({ documentRef: blockedCookies, storage }),
    ).candidates.length,
    30,
  );
});


test("mutual exclusion rules reject combinations containing both selected entities", () => {
  const state = baseState({ items: modules.model.normalizeFixedItems([]) });
  state.items.find((item) => item.slot === "Head").id = "base-head";
  state.candidates = [
    item("Head", {}, { candidateKey: "candidate-head" }),
    item("Neck", {}, { candidateKey: "candidate-neck" }),
  ];
  state.comboRules = [{
    type: "mutualExclusion",
    leftRef: "base:Head",
    rightRef: `candidate:${state.candidates[1].candidateKey}`,
  }];
  const combos = [...modules.combinations.iterateCandidateRange(
    state.candidates,
    0,
    "atleast",
    { rules: state.comboRules, baseItems: state.items, itemDb: {} },
  )];
  assert.equal(combos.some((combo) => combo.some((item) => item.slot === "Neck") && !combo.some((item) => item.slot === "Head")), false);
  assert.equal(modules.combinations.countCandidateRange(
    state.candidates,
    0,
    "atleast",
    { rules: state.comboRules, baseItems: state.items, itemDb: {} },
  ), BigInt(combos.length));
});

test("mutual exclusion rules support candidate sets as an entity", () => {
  const state = baseState({ items: modules.model.normalizeFixedItems([]) });
  state.candidates = [item("Main hand", {}, { candidateKey: "weapon" }), item("Off hand", {}, { candidateKey: "shield" }), item("Head", {}, { candidateKey: "helm" })];
  const setKey = "weapon-pair";
  state.comboRules = [
    { type: "candidateSet", setKey, candidateKeys: state.candidates.slice(0, 2).map((item) => item.candidateKey) },
    { type: "mutualExclusion", leftRef: `set:${setKey}`, rightRef: `candidate:${state.candidates[2].candidateKey}` },
  ];
  const combos = [...modules.combinations.iterateCandidateRange(
    state.candidates,
    0,
    "atleast",
    { rules: state.comboRules, baseItems: state.items, itemDb: {} },
  )];
  assert.equal(combos.some((combo) => combo.length === 3), false);
  assert.equal(modules.combinations.countCandidateRange(
    state.candidates,
    0,
    "atleast",
    { rules: state.comboRules, baseItems: state.items, itemDb: {} },
  ), BigInt(combos.length));
});



test("off-hand-only database items retain the Off hand slot", () => {
  const context = { globalThis: null };
  context.globalThis = context;
  vm.runInNewContext(
    readFileSync(resolve(projectRoot, "item-db.js"), "utf8"),
    context,
    { filename: "item-db.js" },
  );
  for (const id of [56289, 56306, 56349]) {
    assert.equal(context.ITEM_DB[String(id)].t, "Off hand");
    assert.equal(context.ITEM_DB[String(id)].h, 3);
  }
});

test("Wowhead planner encoding round-trips talents, glyphs, reforges, gems, and enchants", () => {
  const require = createRequire(import.meta.url);
  const parse = require(resolve(projectRoot, "wowhead-parser.js"));
  const url = "https://www.wowhead.com/cata/gear-planner/warrior/human/ELBg1U7Ix47B_q4Q5pDCH7HvqgO001s0011xtw21s0j31xv142pxb51s0g61rqg71rqf822j4QNB4GO_4IiL4IgU4GQ24PPXgAC4KEmh_gBD4FMDh_4PPagBF4FMGiG4J3qgFG4KFTh44EfO4FLIBH4FME4MgrgBI4KFQhp4J2tgFJ4KFUhr4Eew4PPlgFK4FMAh44Eew4J3ugAL4u9qhygAM4u9qhygAN4Ff5h_gAO4FhPhpgBP4u9niG4KGKgBQ4Ff2iI4J3mgAS4Ffdhr";
  const parsed = parse(url);
  const encoded = parse.encode(parsed);
  assert.equal(encoded, url);
  assert.ok(parsed.items.some((item) => item.reforgeId));
  assert.ok(parsed.items.some((item) => item.gemIds.length));
  assert.ok(parsed.items.some((item) => item.enchantIds.length));
});

test("Wowhead planner merge can select independent augmentation sources", () => {
  const require = createRequire(import.meta.url);
  const parse = require(resolve(projectRoot, "wowhead-parser.js"));
  const left = {
    version: 4, classSlug: "warrior", raceSlug: "human", level: 85,
    talentTrees: [{ talentCount: 0, chunks: [] }, { talentCount: 0, chunks: [] }, { talentCount: 0, chunks: [] }],
    glyphHash: "A", items: [{ slotId: 1, itemId: 100, reforgeId: 113, gemIds: [1], enchantIds: [2] }],
  };
  const right = {
    ...left, classSlug: "death-knight", raceSlug: "orc", glyphHash: "B",
    items: [{ slotId: 1, itemId: 200, reforgeId: 168, gemIds: [3], enchantIds: [4] }],
  };
  const merged = parse.merge(left, right, { talents: "right", gear: "right", reforges: "left", gems: "right", enchants: "left" });
  assert.equal(merged.classSlug, "death-knight");
  assert.equal(merged.items[0].itemId, 200);
  assert.equal(merged.items[0].reforgeId, 113);
  assert.deepEqual(merged.items[0].gemIds, [3]);
  assert.deepEqual(merged.items[0].enchantIds, [2]);
});


test("item editor columns and generated WowHead links stay compact and inline", () => {
  assert.match(script, /itemSlotLabel\(slot, twoHanded = false\)/);
  assert.match(script, /return twoHanded \? "2H" : "1H"/);
  assert.match(script, /variants\.length \? "Base Item" : "N\/A"/);
  assert.doesNotMatch(script, /function openWowheadProfile/);
  assert.match(script, /renderGeneratedWowheadLink/);
  assert.match(html, /Generate WowHead Gear Planner Link/);
  assert.match(html, /ReforgePlanner GitHub/);
  assert.doesNotMatch(html, /Copy Results|id="copyResults"/);
  assert.match(styles, /item-editor-table td:nth-child\(3\)[\s\S]*min-width: 280px/);
});

test("compact setup exports round-trip and are smaller than formatted JSON", async () => {
  const setup = baseState({
    items: Array.from({ length: 17 }, (_, index) =>
      item(SLOTS[index], { Crit: 100 + index, Mastery: 80 + index }, {
        id: String(60000 + index),
        name: `Repeated equipment item ${index + 1}`,
        gemIds: [52207, 52207, 52207],
        enchantIds: [4091],
      }),
    ),
    candidates: Array.from({ length: 12 }, (_, index) =>
      item("Head", { Hit: 90 + index, Haste: 70 + index }, {
        id: String(70000 + index),
        name: `Candidate item ${index + 1}`,
      }),
    ),
  });
  const json = modules.persistence.serializeSetup(setup);
  const compact = await modules.persistence.serializeCompactSetup(setup);
  const restored = await modules.persistence.parseCompactSetup(compact);

  assert.ok(compact.startsWith("RFP1:"));
  assert.ok(compact.length < json.length / 2);
  assert.equal(restored.format, "ReforgePlanner");
  assert.equal(restored.items[0].name, setup.items[0].name);
  assert.equal(restored.candidates.length, setup.candidates.length);
  assert.equal(restored.wowheadProfile, undefined);
});

test("setup dialogs expose JSON and compact formats", () => {
  assert.match(html, /id="setupFormat"/);
  assert.match(html, /value="json">JSON</);
  assert.match(html, /value="compact">Compact string</);
  assert.match(html, /id="openImport">\s*Import\s*</);
  assert.match(html, /id="exportJson">\s*Export\s*</);
});

test("import and export feedback is shown beside the header actions", () => {
  assert.match(html, /id="setupStatus"[^>]*role="status"/);
  assert.match(script, /setSetupStatus\(`\$\{setupFormatName\(\)\} import complete\.`/);
  assert.match(script, /setSetupStatus\(`\$\{setupFormatName\(\)\} copied\.`/);
  assert.doesNotMatch(script, /\$\("#status"\)\.textContent = `\$\{setupFormatName\(\)\} import complete\.`/);
});


test("Wowhead merge planner URLs use compact single-line inputs", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<input id="mergeWowheadA"[^>]*type="url"/);
  assert.match(html, /<input id="mergeWowheadB"[^>]*type="url"/);
  assert.doesNotMatch(html, /<textarea id="mergeWowhead[AB]"/);
  assert.match(html, /<span>Gear and variants<\/span><label><input type="radio" name="merge-gear" value="left" checked>/);
  assert.match(script, /gear: selected\("gear"\)/);
});

test("Wowhead enchant export uses planner spell IDs and normalizes imported aliases", () => {
  const context = { globalThis: null };
  context.globalThis = context;
  vm.runInNewContext(
    readFileSync(resolve(projectRoot, "item-db.js"), "utf8"),
    context,
    { filename: "item-db.js" },
  );
  const landslide = context.ENCHANT_DB[74245];
  const plannerAlias = context.ENCHANT_DB[74246];
  assert.equal(landslide.n, "Enchant Weapon - Landslide");
  assert.equal(landslide.p, 74246);
  assert.equal(plannerAlias.c, 74245);
  assert.equal(plannerAlias.a, 1);
  assert.match(script, /function wowheadPlannerEnchantId\(enchantId\)/);
  assert.match(script, /\.map\(wowheadPlannerEnchantId\)/);
  assert.match(script, /\.map\(canonicalEnchantId\)/);
});


test("Rogue Wowhead planner imports verified enchant aliases and multiple slot enchants", () => {
  const require = createRequire(import.meta.url);
  const parseWowheadGearPlanner = require(resolve(projectRoot, "wowhead-parser.js"));
  const parsed = parseWowheadGearPlanner(
    "https://www.wowhead.com/cata/gear-planner/rogue/night-elf/ELBg1GyHzAT4TB47I4jxChgO001qf711xrn21qf031qfk41qfc52s5361rnp71rng81rnhRNB4GQf4IiK4IgU4GQ24PPWgAC4KEih-gBD4Fizhw4PPbgBF4FjKiF4J3qgFG4Fi-h-4Eev4FLIgBH4FjLhw4K07gBI4FiyiF4J3sgFJ4Fiqh44EdS4PPpgFK4Firhw4EdS4J3vgAL4KEbhwgAM4KEbhwAN4ESRAO4FhYgCP4KEkhw4KGK4FK6BQ4Hpr4J3mBR4Fgm4OjoAS4FhE",
  );
  const bySlot = new Map(parsed.items.map((item) => [item.slotName, item]));
  assert.deepEqual(Array.from(bySlot.get("Chest").enchantIds), [74250]);
  assert.deepEqual(Array.from(bySlot.get("Back").enchantIds), [75178, 55002]);
  assert.deepEqual(Array.from(bySlot.get("Off hand").enchantIds), [93448]);

  const context = { globalThis: null };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(resolve(projectRoot, "item-db.js"), "utf8"), context);
  assert.equal(context.ENCHANT_DB[74250].c, 74249);
  assert.equal(context.ENCHANT_DB[75178].c, 75177);
  assert.equal(context.ENCHANT_DB[93448].c, 43588);
});

test("equipment bonuses include every imported enchant on a slot", () => {
  const bonuses = modules.optimizer.equipmentBonuses(
    item("Back", {}, { enchantIds: [1, 2] }),
    {
      itemDb: {},
      gemDb: {},
      enchantDb: {
        1: { m: 0, s: [0, 0, 0, 0, 10, 0, 0, 0] },
        2: { m: 0, s: [0, 0, 0, 0, 0, 20, 0, 0] },
      },
    },
  );
  assert.equal(bonuses.Crit, 10);
  assert.equal(bonuses.Haste, 20);
});

test("Wowhead enchant mappings are explicit and cover Death Knight runeforges", () => {
  const context = { globalThis: null };
  context.globalThis = context;
  vm.runInNewContext(
    readFileSync(resolve(projectRoot, "item-db.js"), "utf8"),
    context,
    { filename: "item-db.js" },
  );
  const expected = new Map([
    [53387, 53323],
    [56903, 53331],
    [53362, 53342],
    [53365, 53344],
    [53386, 53341],
    [50401, 53343],
    [54448, 54446],
    [54449, 54447],
    [62157, 62158],
    [70163, 70164],
  ]);
  for (const [canonicalId, plannerId] of expected) {
    assert.equal(context.ENCHANT_DB[canonicalId].p, plannerId);
    assert.equal(context.ENCHANT_DB[plannerId].c, canonicalId);
    assert.equal(context.ENCHANT_DB[plannerId].a, 1);
  }
  const builder = readFileSync(
    new URL("../tools/build-item-db.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(builder, /Number\(appliedId\) \+ 1/);
  assert.match(builder, /const wowheadPlannerEnchantIds = new Map/);
});

test("Wowhead result actions live below Final Stats and merge prefills Planner A", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="gearCard"[\s\S]*?<div class="toolbar">[\s\S]*?id="mergeWowhead"/);
  assert.match(html, /<h3 class="section-title">Final Stats<\/h3>[\s\S]*?id="openBaseWowhead"[\s\S]*?id="mergeBaseWowhead"/);
  assert.match(script, /class="secondary combo-wowhead-merge"/);
  assert.match(script, /function openMergeWowheadWithPlannerA\(url = ""\)/);
  assert.match(script, /\$\("#mergeWowheadA"\)\.value = url/);
  assert.match(script, /openMergeWowheadWithPlannerA\(wowheadProfileUrl\(state\.items, lastResult\)\)/);
  assert.match(script, /openMergeWowheadWithPlannerA\(wowheadProfileUrl\(gear, record\.result\)\)/);
});
