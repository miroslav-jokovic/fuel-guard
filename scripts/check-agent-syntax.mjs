#!/usr/bin/env node
/**
 * Every `tools/**` module must PARSE.
 *
 * `eslint.config.js` excludes `tools/**` on purpose — the on-prem agent runs on the carrier's own
 * Node, not the app's, and linting it as app code would be wrong. But the exclusion left it with no
 * gate at all, and on 2026-08-28 that shipped: a comment inside the billing SELECT was written with
 * backticks around a column name, which TERMINATED the template literal it lived in. The agent then
 * died at import with `SyntaxError: Unexpected identifier 'distance'` — not on a code path, at load,
 * so every sweep it performs was broken at once. CI was green, because nothing read the file.
 *
 * That is a bad failure for this particular directory to be capable of. The agent is the only thing
 * that puts McLeod data into the store; when it cannot start, settlements, fuel, billing, vouchers,
 * movements and the general ledger all stop arriving together, and the pages that read them degrade
 * to "not swept yet" rather than to an error anyone would chase.
 *
 * So this checks the one property that needs no knowledge of the agent's runtime: it parses. Node's
 * own parser, the same one the carrier's Node will use, via `--check`. Nothing about style, imports
 * or environment — a syntax gate and only that.
 *
 * Chained onto `lint:cli-streams` so CI runs it without a workflow edit (the house convention;
 * `lint:schema-snapshot` and `lint:table-access` are chained the same way).
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";

const ROOT = new URL("..", import.meta.url).pathname;
const SCAN = join(ROOT, "tools");

/** `node --check` treats .mjs as ESM, which is what these files are. */
const PARSEABLE = /\.mjs$/;
const SKIP = new Set(["node_modules"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (PARSEABLE.test(entry)) out.push(full);
  }
  return out;
}

let files;
try {
  files = walk(SCAN);
} catch {
  console.log("✓ agent syntax ok — no tools/ directory to scan.");
  process.exit(0);
}

const broken = [];
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    const detail = String(e.stderr ?? "").split("\n").find((l) => l.includes("Error")) ?? "parse failed";
    broken.push({ file: file.replace(ROOT, ""), detail: detail.trim() });
  }
}

if (broken.length) {
  console.error(`\n✗ ${broken.length} tools/ file(s) do not parse:`);
  for (const b of broken) console.error(`  ${b.file}  ${b.detail}`);
  console.error("\n  These run on the carrier's Node, outside eslint's scope — a syntax error here");
  console.error("  stops every McLeod sweep at import, and the pages just read as 'not swept yet'.");
  process.exit(1);
}

console.log(`✓ agent syntax ok — ${files.length} tools/ module(s) parse.`);
