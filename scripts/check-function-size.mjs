#!/usr/bin/env node
/**
 * Fitness function — max function length. The file-size gate (check-file-size.mjs) can be dodged by a
 * single enormous function under the 500-line file budget (audit P2-B: scoreTransaction was 397 lines in a
 * 419-line file). This measures FUNCTION spans and fails any over MAX, so deep logic can't hide.
 *
 * Scope: apps/api/src service/logic code. Route files are excluded — an Express router factory is a flat
 * list of `router.<verb>(...)` registrations (breadth, not depth); its length is covered by the file gate.
 *
 * GRANDFATHERED holds the functions already over MAX, pinned to their CURRENT span: they may not GROW
 * (regression guard) and should ratchet down — refactor one and delete its entry. A new function over MAX,
 * or a grandfathered one that grew, fails.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = new URL("..", import.meta.url).pathname;
// TypeScript is a devDependency of apps/api — resolve it from there (robust to pnpm hoisting).
const require = createRequire(new URL("./apps/api/package.json", import.meta.url));
const ts = require("typescript");

const MAX = 200; // hard ceiling for any NEW function span (raw lines, matching the file-size gate's metric)

// path#function → the span it is pinned at. Audit P2-B follow-ups: refactor these into orchestrators +
// stage helpers (as scoreTransaction was) and remove the entry. They MAY NOT grow past the pinned size.
const GRANDFATHERED = {
  "apps/api/src/modules/anomalies/declinedScoring.ts#scoreDeclinedAttempt": 230,
  "apps/api/src/services/askData.ts#runTool": 212,
  "apps/api/src/services/fuelPlanning.ts#planFuelRoute": 210,
};

function listFiles() {
  // List the whole tree (git ls-files with a `**` glob misses direct children like src/app.ts) and filter.
  const out = execSync("git ls-files apps/api/src", { cwd: ROOT, encoding: "utf8" });
  return out.trim().split("\n").filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("/routes/"));
}

function functionsIn(relPath) {
  const src = readFileSync(join(ROOT, relPath), "utf8");
  const sf = ts.createSourceFile(relPath, src, ts.ScriptTarget.Latest, true);
  const found = [];
  const visit = (node) => {
    if (
      ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
    ) {
      const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
      const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
      let name = "(anonymous)";
      if (node.name) name = node.name.getText(sf);
      else if (node.parent && ts.isVariableDeclaration(node.parent) && node.parent.name) name = node.parent.name.getText(sf);
      found.push({ name, span: end - start + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// Same warning band as the file-size gate: a function creeping toward the ceiling should be visible
// BEFORE it fails on whoever happens to touch it next. A budget with no warning band ambushes people,
// and the reasonable response to an ambush is to add a waiver — which is how these gates die.
const WARN_AT = Math.floor(MAX * 0.9);
const violations = [];
const warnings = [];
const stale = [];
const seenGrandfathered = new Set();

for (const relPath of listFiles()) {
  for (const fn of functionsIn(relPath)) {
    const key = `${relPath}#${fn.name}`;
    const pin = GRANDFATHERED[key];
    if (pin != null) {
      seenGrandfathered.add(key);
      if (fn.span > pin) violations.push(`${key}  ${fn.span} lines  (grandfathered at ${pin} — it GREW; refactor, don't grow)`);
      else if (fn.span <= MAX) stale.push(`${key}  now ${fn.span} ≤ ${MAX} — remove its GRANDFATHERED entry`);
      continue;
    }
    if (fn.span > MAX) violations.push(`${relPath}#${fn.name}  ${fn.span} lines  (over the ${MAX}-line function budget — split into an orchestrator + stage helpers)`);
    else if (fn.span >= WARN_AT) warnings.push({ key, span: fn.span });
  }
}
// A grandfathered key that no longer matches any function (renamed/removed) is also stale.
for (const key of Object.keys(GRANDFATHERED)) if (!seenGrandfathered.has(key)) stale.push(`${key}  no longer found — remove its GRANDFATHERED entry`);

if (stale.length) {
  console.warn(`ℹ ${stale.length} grandfathered entr(y/ies) can be removed:`);
  for (const s of stale) console.warn("  " + s);
}
if (warnings.length) {
  console.warn(`\n⚠ ${warnings.length} function(s) within ${MAX - WARN_AT} lines of the ${MAX}-line budget (not a failure):`);
  for (const w of warnings.sort((a, b) => b.span - a.span)) console.warn(`  ${w.span}  ${w.key}`);
}
if (violations.length) {
  console.error(`✗ ${violations.length} function-size violation(s):`);
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}
console.log(`✓ function-size ok — no function over ${MAX} lines (${Object.keys(GRANDFATHERED).length} grandfathered, ratcheting down).`);
