#!/usr/bin/env node
/**
 * `pnpm tolls:check-real <folder>` — run the three toll statement readers over REAL statements kept
 * outside the repo, and print whether each one read and tied (TOLLS-PER-TRUCK-PLAN TL5).
 *
 * WHY this exists and is not a CI test: the readers are proven in CI on word fixtures that copy the
 * real layout with invented numbers, because the real files carry the account, tag and plate numbers
 * and must never be committed. That proves the reading logic, not that the fixtures are faithful. This
 * check closes that gap on the machine that holds the files: every statement must be read by exactly
 * one reader (the other two refuse it on their header check) and tie every total, sub-total and
 * balance step to the cent. TL5's bar: all 18 of the owner's statements, April–October 2026.
 *
 * Prints no account, tag or plate — only file name, provider, period, line counts and the ties.
 * Needs `pnpm --filter @silvicom/shared build:rn` first (it reads the shared package's dist).
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readPdfWordsNode } from "./lib/pdfWordsNode.mjs";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: pnpm tolls:check-real <folder of toll statement PDFs>");
  process.exit(2);
}
let shared;
try {
  shared = await import("../packages/shared/dist/index.js");
} catch {
  console.error("Build the shared package first: pnpm --filter @silvicom/shared build:rn");
  process.exit(2);
}
const { readTollStatement, TOLL_PROVIDERS } = shared;

let failures = 0;
const files = readdirSync(dir).filter((f) => /\.pdf$/i.test(f)).sort();
for (const file of files) {
  const words = await readPdfWordsNode(join(dir, file));
  const read = [];
  const refusals = [];
  for (const provider of TOLL_PROVIDERS) {
    try {
      read.push(readTollStatement(provider, words));
    } catch (e) {
      refusals.push(`${provider}: ${e.message}`);
    }
  }
  if (read.length !== 1) {
    // Not every PDF in the folder is a statement (a truck list); say so rather than fail on it.
    const notAStatement = refusals.every((r) => /does not look like/.test(r));
    if (notAStatement) console.log(`·  ${file}: not a statement any reader knows — skipped`);
    else {
      failures++;
      console.log(`✗  ${file}: ${read.length === 0 ? refusals.filter((r) => !/does not look like/.test(r)).join(" | ") : "read by more than one reader"}`);
    }
    continue;
  }
  const r = read[0];
  const kinds = {};
  for (const l of r.lines) kinds[l.kind] = (kinds[l.kind] ?? 0) + 1;
  console.log(
    `✓  ${file}: ${r.provider} ${r.periodStart}…${r.periodEnd}, ${r.lines.length} lines ${JSON.stringify(kinds)}, ` +
      `${r.ties.length} printed totals tied, charges $${(r.printedChargesCents / 100).toFixed(2)}`,
  );
}
console.log(failures === 0 ? `\nRESULT: every statement read and tied (${files.length} PDFs).` : `\nRESULT: ${failures} statement(s) refused.`);
process.exit(failures === 0 ? 0 : 1);
