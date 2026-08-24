#!/usr/bin/env node
/**
 * The McLeod recon pack must stay safe to hand to somebody else.
 *
 * `tools/mcleod-agent/inspect.mjs` is meant to be run by the carrier's IT against a database we will
 * never see — `lme`, which our login cannot read (`HAS_DBACCESS('lme') = 0`). That is the whole point
 * of it being a command rather than a query somebody pastes into an editor, and it is also why it
 * needs a gate: the reviewer of that pull request has to be able to trust the file without reading
 * 22 SQL statements closely.
 *
 * Four rules, each with a failure it prevents:
 *
 *  1. **Every statement is a single SELECT.** The login it will eventually run under is not ours to
 *     scope, and a recon pack is not the place to discover that somebody had write access.
 *  2. **FORBIDDEN columns appear nowhere, in any form.** `db_datareader` can read
 *     `social_security_no` today and 1,461 of 1,463 driver rows have one. Counting it would still put
 *     the column name in a query plan, a trace and a log.
 *  3. **COUNT_ONLY columns are counted, never returned.** A recon answer is a number; a name, a
 *     licence or a home address in a result set is a data extract wearing a measurement's clothes.
 *  4. **Anything reading driver / tractor / trailer binds `@companyId`.** `dbo.company` holds four
 *     legal entities in the same tables. An unbound query blends Silvicom Inc with Silvicom
 *     Logistics, which is the mistake §4.4 of the roster plan exists to record.
 */
import { INSPECTION, FORBIDDEN, COUNT_ONLY } from "../tools/mcleod-agent/inspect.mjs";
import { rosterQueries, retirementQueries } from "../tools/mcleod-agent/queries.mjs";
import "../tools/mcleod-agent/roster.mjs";

/**
 * ── AND THE AGENT HAS TO PARSE AT ALL ───────────────────────────────────────────────────────────
 *
 * `tools/mcleod-agent` is deliberately outside the pnpm workspace — it is zero-dependency and ships to
 * the carrier's own machine — which means `pnpm typecheck` and `pnpm test` never look at it. A syntax
 * error in it is invisible to every other gate in this repo.
 *
 * That is not theoretical. A SQL comment containing `backticks` was added inside a JS template literal
 * on 2026-08-24, breaking `queries.mjs` outright, and CI stayed green because nothing imports it. The
 * agent is the half of this integration that runs where we cannot see it; a build that cannot tell us
 * it is broken is worse than no build.
 *
 * The imports above are the check: this file cannot run unless every agent module parses. The
 * assertions below add the two things a parse alone would not catch.
 */
for (const [mode, q] of [["identity", rosterQueries("identity")], ["link", rosterQueries("link")]]) {
  for (const [entity, sql] of Object.entries(q)) {
    if (!/@companyId\b/.test(sql)) {
      console.error(`✗ roster query ${entity} (${mode}) does not bind @companyId`);
      process.exit(1);
    }
    if (/\bselect\s+\*/i.test(sql)) {
      console.error(`✗ roster query ${entity} (${mode}) uses SELECT * — the column allowlist IS the PII boundary`);
      process.exit(1);
    }
  }
}
for (const [entity, sql] of Object.entries(retirementQueries())) {
  if (!/@companyId\b/.test(sql)) {
    console.error(`✗ retirement query ${entity} does not bind @companyId`);
    process.exit(1);
  }
}

const FORBIDDEN_STATEMENTS = /\b(insert|update|delete|drop|alter|create|truncate|merge|exec|execute|grant|revoke|into)\b/i;
const SCOPED_TABLES = /\bdbo\.(driver|tractor|trailer)\b/i;

const problems = [];
const seen = new Set();

for (const q of INSPECTION) {
  const where = `${q.id}`;
  if (seen.has(q.id)) problems.push(`${where}: duplicate question id`);
  seen.add(q.id);
  if (!q.blocks || !q.question) problems.push(`${where}: every question must say what it BLOCKS and ask something`);

  const sql = String(q.sql);
  const bare = sql.trim().toLowerCase();

  if (!bare.startsWith("select")) problems.push(`${where}: must start with SELECT`);
  if (sql.includes(";")) problems.push(`${where}: one statement per question — no semicolons`);

  // Strip string literals first, so a column NAME quoted as a label ('purchase_date' as column_name)
  // is not mistaken for a reference to the column itself.
  const code = sql.replace(/'[^']*'/g, "''");

  const dml = code.match(FORBIDDEN_STATEMENTS);
  if (dml) problems.push(`${where}: contains "${dml[1]}" — recon is read-only`);

  for (const col of FORBIDDEN) {
    if (new RegExp(`\\b${col}\\b`, "i").test(code)) problems.push(`${where}: references ${col}, which may never appear`);
  }

  for (const col of COUNT_ONLY) {
    // Every occurrence must sit inside a count(...). Checked by removing the counted ones first.
    const withoutCounts = code.replace(/count\s*\([^)]*\)/gi, "count()");
    if (new RegExp(`\\b${col}\\b`, "i").test(withoutCounts)) {
      problems.push(`${where}: returns ${col} — it may be counted, never selected`);
    }
  }

  if (SCOPED_TABLES.test(code) && !/@companyId\b/.test(code)) {
    problems.push(`${where}: reads a per-company table without binding @companyId`);
  }
}

if (problems.length) {
  console.error(`✗ McLeod recon pack: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(
  `✓ McLeod agent ok — every module parses; roster + retirement queries bind @companyId and name their ` +
    `columns; ${INSPECTION.length} read-only recon question(s), ${FORBIDDEN.length} column(s) banned ` +
    `outright, ${COUNT_ONLY.length} countable-but-never-returned.`,
);
