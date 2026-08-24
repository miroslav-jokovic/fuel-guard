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
  `✓ McLeod recon ok — ${INSPECTION.length} read-only question(s), ` +
    `${FORBIDDEN.length} column(s) banned outright, ${COUNT_ONLY.length} countable-but-never-returned.`,
);
