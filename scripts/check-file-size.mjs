#!/usr/bin/env node
/**
 * Fitness function — no NEW god-files, and no growth in the old ones.
 *
 * WHY THIS SHAPE (audit 2026-08-09 follow-up). The first version of this gate did two things that,
 * together, made it stop working:
 *
 *   1. The waiver list was an unconditional Set. Its own comment said "the grandfather list may only
 *      SHRINK", but nothing enforced that — so the four files it exempted grew by 282 lines in three
 *      weeks (integrations.ts 726→831, samsara.ts 508→639, soapClient.ts 525→570, efsSoap.ts
 *      507→518). The files the gate existed to contain became the only ones free to grow without
 *      limit. Its sibling, check-function-size.mjs, had already got this right by pinning each waiver
 *      to its measured span; this file now uses the same semantics.
 *
 *   2. It was pass/fail at the ceiling and silent below it, so nothing surfaced a file creeping
 *      toward the limit. Fourteen files sit between 450 and 499 — three within two lines. The gate
 *      therefore fires on whoever next touches one of them, for a reason unrelated to their change.
 *      That happened during the Stage 3 work: parse.ts sat at 499, a nine-line security guard pushed
 *      it over, and the split had to happen in the middle of an unrelated fix. A budget with no
 *      warning band is a budget that ambushes people, and the reasonable response to an ambush is to
 *      add a waiver — which is how gates die.
 *
 * So: waivers are PINNED (a waived file may not grow past its pin, and shrinking prints the new pin
 * to ratchet), and anything at or above WARN_AT is reported without failing.
 *
 * `.tsx` is in scope. It was previously excluded, which silently exempted all 68 driver UI files.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BUDGET = 500;
const WARN_AT = Math.floor(BUDGET * 0.9); // 450 — visible creep, not a failure
const SCAN_DIRS = ["apps", "packages"];
const SKIP = new Set(["node_modules", "dist", ".git", "coverage", ".pnpm-store", "android", "ios", ".expo"]);

/**
 * Waived god-files, PINNED to their current length. A waived file may not grow past its pin; when it
 * shrinks, lower the pin (this script prints the number). When it drops under BUDGET, delete the
 * entry. Re-pinning upward is a deliberate, reviewable act — that is the point.
 *
 * Pinned 2026-08-10 at the values these files had reached. They are not approved sizes; they are the
 * high-water mark the gate now holds them under.
 */
const GRANDFATHERED = {
  "apps/api/src/routes/integrations.ts": 832,
  "apps/api/src/lib/samsara.ts": 640,
  // soapClient.ts (571) and efsSoap.ts (519) left this list on 2026-08-10. The EFS card-control work
  // split them — soapClient → soapClient + efsTls, efsSoap → efsSoap + efsSoapSession + efsXml — and
  // all five now sit under BUDGET on their own. Deleting an entry is the intended end state of this
  // list; do not re-add one instead of splitting.
};

const SOURCE_EXT = new Set([".ts", ".tsx", ".vue"]);
const isSource = (f) =>
  !f.endsWith(".test.ts") && !f.endsWith(".test.tsx") && !f.endsWith(".spec.ts") && !f.endsWith(".spec.tsx") &&
  SOURCE_EXT.has(extname(f));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (isSource(name)) out.push(full);
  }
  return out;
}

const violations = [];
const grown = [];
const ratchet = [];
const warnings = [];
const seen = new Set();

for (const d of SCAN_DIRS) {
  let files;
  try { files = walk(join(ROOT, d)); } catch { continue; }
  for (const full of files) {
    const rel = relative(ROOT, full);
    const lines = readFileSync(full, "utf8").split("\n").length;
    const pin = GRANDFATHERED[rel];

    if (pin !== undefined) {
      seen.add(rel);
      if (lines > pin) grown.push({ rel, lines, pin });
      else if (lines < pin) ratchet.push({ rel, lines, pin });
      continue;
    }
    if (lines > BUDGET) violations.push({ rel, lines });
    else if (lines >= WARN_AT) warnings.push({ rel, lines });
  }
}

const stale = Object.keys(GRANDFATHERED).filter((g) => !seen.has(g));
if (stale.length) {
  console.warn("⚠ waiver entries for files that no longer exist (remove them):");
  for (const s of stale) console.warn("  - " + s);
}

if (warnings.length) {
  console.warn(`\n⚠ ${warnings.length} file(s) within ${BUDGET - WARN_AT} lines of the ${BUDGET}-line budget.`);
  console.warn("  Not a failure. Split one before it becomes somebody else's problem mid-PR:");
  for (const w of warnings.sort((a, b) => b.lines - a.lines)) console.warn(`  ${w.lines}  ${w.rel}`);
}

if (ratchet.length) {
  console.log(`\n↓ ${ratchet.length} waived file(s) have shrunk — lower the pin in scripts/check-file-size.mjs:`);
  for (const r of ratchet.sort((a, b) => b.lines - a.lines)) {
    const done = r.lines <= BUDGET ? "  ← now under budget: DELETE the entry" : "";
    console.log(`  "${r.rel}": ${r.lines},   (was ${r.pin})${done}`);
  }
}

let failed = false;

if (grown.length) {
  failed = true;
  console.error(`\n✗ ${grown.length} waived file(s) GREW past the size they were waived at:`);
  for (const g of grown.sort((a, b) => b.lines - b.pin - (a.lines - a.pin))) {
    console.error(`  ${g.rel}: ${g.lines} lines, pinned at ${g.pin} (+${g.lines - g.pin})`);
  }
  console.error(
    "\nA waiver is permission to be big, not permission to keep growing. Move the new code into a\n" +
      "module, or — if the growth is genuinely justified — raise the pin in the same commit so the\n" +
      "decision is reviewable.",
  );
}

if (violations.length) {
  failed = true;
  console.error(`\n✗ ${violations.length} file(s) over the ${BUDGET}-line budget — split into modules:`);
  for (const v of violations.sort((a, b) => b.lines - a.lines)) console.error(`  ${v.lines}  ${v.rel}`);
  console.error("\nSplit using the smartFueling/ recon/ module pattern. Adding a waiver instead is a deliberate, reviewable act.");
}

if (failed) process.exit(1);

const waived = Object.keys(GRANDFATHERED).length;
console.log(
  `\n✓ file-size budget ok — nothing over ${BUDGET} lines outside ${waived} pinned waiver(s)` +
    `${warnings.length ? `, ${warnings.length} approaching the limit` : ""}.`,
);
