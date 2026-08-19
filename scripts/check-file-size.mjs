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
 *
 * 3. A line budget can be satisfied by deleting whitespace instead of code, which leaves the gate green
 * and the file worse. The compression budget makes that route cost more than the honest one: pinned
 * files also have a baseline count of overlong or compressed statement lines, and that count may not rise.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PRETTIER_CONFIG_PATH = join(ROOT, ".prettierrc.json");
let prettierConfig;
try {
  prettierConfig = JSON.parse(readFileSync(PRETTIER_CONFIG_PATH, "utf8"));
} catch (error) {
  throw new Error(
    `Could not read ${PRETTIER_CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  );
}
const PRINT_WIDTH = prettierConfig.printWidth;
if (!Number.isInteger(PRINT_WIDTH) || PRINT_WIDTH <= 0) {
  throw new Error(`Missing valid printWidth in ${PRETTIER_CONFIG_PATH}`);
}

/**
 * Prettier's configured width is the only non-arbitrary definition of "too long" for this repo.
 * Hardcoding a second number creates two sources of truth that will drift.
 */
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
  "apps/api/src/routes/integrations.ts": 831,
  // Pinned 2026-08-13 — EFS card-control plan (docs/28-EFS-EXECUTION-PLAN.md) Phase 0 Step 0.6.
  // Phase 3 (the capability registry) restructures the remaining two: efsCardControl.ts splits into
  // five orchestrator phase modules, and cardControlContract.ts splits into per-capability contracts.
  // PHASE 3'S EXIT GATE DELETES THESE TWO ENTRIES. If they are still here after Phase 3, that is a
  // bug in the plan, not a new normal.
  // efsCardControl.ts (507) left this list on 2026-08-14. Phase 3 Step 3.4 split it into the five
  // orchestrator phase modules under apps/api/src/efs/orchestrator/ — plan, dispatch, ledger, steps,
  // resolve — leaving the service as a 62-line door. Ratcheted 530 → 507 on 2026-08-13 when
  // CardControlError moved out; deleted, which is the intended end state of this list.
  //
  // cardControlContract.ts (512) left it on 2026-08-14 too, in Step 3.7: the mutation ledger's view
  // shapes and the approver-scope vocabulary moved to cardControlLedger.ts, which is the line the
  // design already drew — a REQUEST's shape and a RECORD's shape change for different reasons.
  // 511 → 355, with no capability contract in either file; those live in efs/capabilities/.
  // Pinned 2026-08-13 for a different reason. Phase 1 Step 1.2 adds an org-ownership guard to the
  // probe routers; that guard lives in ONE shared helper imported by all three, so this file must
  // not grow. Removed when the Phase 4 harness supersedes the experiment router.
  //
  // 513 → 516 on 2026-08-17, deliberately and with the reason stated, per this gate's own rule that
  // justified growth raises the pin in the same commit. `VerifyReading` gained `overrideUses` so the
  // F9 probe's central observation is self-evidencing: WEX's portal guides say a card in override
  // accepts no changes, and a `landed: false` is only evidence of that if the override is known to
  // have been armed AT THE INSTANT of the reading. Inferring it from a `read_state` either side is
  // weaker for the reason docs/28 §8's four defects were weak — two sources agreeing about a third
  // thing neither observed.
  //
  // 516 → 536 later the same day, and this one was paid for by a run that produced an unusable
  // result. The F9 probe sent `Hold` to an account that stores `ACTIVE` — H1 exactly, answered with
  // the same void success and applied nothing — so `landed: false` had two sufficient explanations
  // and could not choose between them. `matchAccountCasing` opts a set_status experiment into
  // production's own `matchStatusCasing`, applied HERE from the document in hand so the rule stays
  // single-sourced; a CLI that recomputed it would be a second implementation of the rule H1 cost us.
  // The verbatim default is untouched, because casing IS hypothesis H1 and an endpoint that silently
  // corrected it could never have measured it. `statusSent` now reports the bytes actually sent
  // rather than the bytes requested — a transcript that reported the request while sending something
  // else is how the first run looked correct for an hour.
  //
  // 536 → 551 the same day, for the H16 FOLLOW-UP. `clearOverride` makes `set_status` send the status
  // and the override clear in ONE request — which is exactly what `card_lock` now does for
  // `clearException`, and the one combination H16 never tested. It appends `overrideClearEdits()`
  // itself rather than a hand-written trio, because a second definition of "clear an override" would
  // make a green result say nothing about the path that ships.
  "apps/api/src/routes/fuelCards/experiments.ts": 517,
  // soapClient.ts (571) and efsSoap.ts (519) left this list on 2026-08-10. The EFS card-control work
  // split them — soapClient → soapClient + efsTls, efsSoap → efsSoap + efsSoapSession + efsXml — and
  // all five now sit under BUDGET on their own. Deleting an entry is the intended end state of this
  // list; do not re-add one instead of splitting.
};

const COMPRESSION_BUDGETS = {
  "apps/api/src/routes/integrations.ts": 2,
  "apps/api/src/routes/fuelCards/experiments.ts": 12,
};

const SOURCE_EXT = new Set([".ts", ".tsx", ".vue"]);
const isSource = (f) =>
  !f.endsWith(".test.ts") && !f.endsWith(".test.tsx") && !f.endsWith(".spec.ts") && !f.endsWith(".spec.tsx") &&
  SOURCE_EXT.has(extname(f));

const isCommentLine = (trimmed) =>
  trimmed.startsWith("//") ||
  trimmed.startsWith("/*") ||
  trimmed.startsWith("*") ||
  trimmed.startsWith("*/");

function compressionLines(source) {
  return source.split("\n").flatMap((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || isCommentLine(trimmed)) return [];
    const overlong = line.length > PRINT_WIDTH;
    const isForHeader = /^for\s*\(/.test(trimmed);
    const semicolon = line.indexOf(";");
    const afterSemicolon = semicolon >= 0
      ? line.slice(semicolon + 1).replace(/\/\/.*$/, "").replace(/[}\])\s]+$/, "").trim()
      : "";
    const compressed = !isForHeader && afterSemicolon.length > 0;
    return overlong || compressed ? [i + 1] : [];
  });
}

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
const compressionGrown = [];
const warnings = [];
const seen = new Set();

for (const d of SCAN_DIRS) {
  let files;
  try { files = walk(join(ROOT, d)); } catch { continue; }
  for (const full of files) {
    const rel = relative(ROOT, full);
    const source = readFileSync(full, "utf8");
    const lines = source.split("\n").length;
    const pin = GRANDFATHERED[rel];
    const compressionBudget = COMPRESSION_BUDGETS[rel];

    if (compressionBudget !== undefined) {
      const compressed = compressionLines(source);
      if (compressed.length > compressionBudget) {
        compressionGrown.push({
          rel,
          count: compressed.length,
          pin: compressionBudget,
          lines: compressed,
        });
      }
    }

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

if (compressionGrown.length) {
  failed = true;
  console.error("\n✗ pinned files grew their compressed-line budget:");
  for (const g of compressionGrown.sort((a, b) => b.count - b.pin - (a.count - a.pin))) {
    console.error(`  ${g.rel}: ${g.count} compressed lines, baseline ${g.pin} (+${g.count - g.pin})`);
    for (const line of g.lines) console.error(`    line ${line}`);
  }
  console.error("\nKeep statements readable and split crowded code instead of compressing it onto fewer lines.");
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
