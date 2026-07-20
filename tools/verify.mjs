import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;

function run(label, command, args, options = {}) {
  process.stdout.write(`${label}... `);
  execFileSync(command, args, {
    cwd: projectRoot,
    stdio: "pipe",
    encoding: "utf8",
    ...options,
  });
  console.log("passed");
}

function collectJavaScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectJavaScriptFiles(path));
    else if ([".js", ".mjs"].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

function auditStaticApplication() {
  const html = readFileSync(resolve(projectRoot, "index.html"), "utf8");
  const css = readFileSync(resolve(projectRoot, "styles.css"), "utf8");

  const localAssets = [
    ...html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)="([^"]+)"/g),
  ]
    .map((match) => match[1])
    .filter((path) => !/^(?:https?:|data:|#)/.test(path));
  for (const asset of localAssets) {
    assert.ok(statSync(resolve(projectRoot, asset)).isFile(), `Missing runtime asset: ${asset}`);
  }

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "index.html contains duplicate IDs");

  const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
  assert.ok(buttons.length > 0, "No static buttons found");
  for (const button of buttons) {
    assert.match(button, /\btype="button"/, `Static button lacks type=button: ${button}`);
  }

  const headers = [...html.matchAll(/<th\b[^>]*>/g)].map((match) => match[0]);
  for (const header of headers) {
    assert.match(header, /\bscope="col"/, `Static table header lacks scope=col: ${header}`);
  }

  assert.match(html, /<meta\s+name="description"\s+content="[^"]+"\s*\/?>/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /!important/);

  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const opens = (withoutComments.match(/{/g) || []).length;
  const closes = (withoutComments.match(/}/g) || []).length;
  assert.equal(opens, closes, "styles.css has unbalanced blocks");
}

function verifyGeneratedDatabase() {
  const tempRoot = mkdtempSync(resolve(tmpdir(), "reforge-planner-verify-"));
  try {
    cpSync(resolve(projectRoot, "db.json"), resolve(tempRoot, "db.json"));
    cpSync(resolve(projectRoot, "tools"), resolve(tempRoot, "tools"), { recursive: true });
    execFileSync(node, [resolve(tempRoot, "tools", "build-item-db.mjs")], {
      cwd: tempRoot,
      stdio: "pipe",
    });
    const committed = readFileSync(resolve(projectRoot, "item-db.js"));
    const generated = readFileSync(resolve(tempRoot, "item-db.js"));
    assert.deepEqual(generated, committed, "Regenerated item-db.js differs from committed output");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

run("Characterization tests", node, ["--test", "tests/*.test.mjs"], { shell: true });

const scripts = collectJavaScriptFiles(projectRoot).filter(
  (path) => !path.includes(`${resolve(projectRoot, ".git")}`),
);
for (const script of scripts) {
  run(`Syntax ${script.slice(projectRoot.length + 1)}`, node, ["--check", script]);
}

process.stdout.write("Static HTML/CSS and runtime asset audit... ");
auditStaticApplication();
console.log("passed");

process.stdout.write("Item database reproducibility... ");
verifyGeneratedDatabase();
console.log("passed");

console.log(`\nFinal verification passed (${scripts.length} JavaScript files checked).`);
