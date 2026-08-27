#!/usr/bin/env node
/**
 * Fitness function — every driver foreign key is accounted for by the merge (D-SEP5,
 * docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md P2.5; closes the trap the memory named
 * merge-driver-cascade-trap and 0234/0236/0238 could only warn about in comments).
 *
 * merge_driver was re-issued eight times because nothing connected "a migration added a
 * drivers(id) FK" to "the merge must move it" — a table it did not know about was silently
 * cascaded away by the next roster dedup. Since 0264 the mechanical moves live in
 * modules/roster/mergeDriver.ts (DRIVER_REASSIGNMENTS) and ride into merge_driver_v2 as a
 * parameter. This gate makes the pairing binding:
 *
 * Every column in migrations that `references drivers(id)` must appear in exactly one of:
 *   1. DRIVER_REASSIGNMENTS (parsed from the TypeScript list) — mechanically moved;
 *   2. REFUSAL_SET — signed evidence; merge_driver_v2 refuses the merge (MD010);
 *   3. HANDLED_IN_FUNCTION — semantic moves inside merge_driver_v2's stable body;
 *   4. EXEMPT — with the reason it never needs moving.
 * A drivers(id) FK the lists don't cover fails the build — the answer is one TypeScript list
 * entry, not a function re-issue.
 *
 * `--self-test` proves the detector fires on a synthetic unaccounted FK.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const TS_LIST = join(ROOT, "apps", "api", "src", "modules", "roster", "mergeDriver.ts");

const REFUSAL_SET = new Set([
  "driver_applications.driver_id", // certified application — DA010, may never be moved
  "esign_consents.driver_id",      // e-sign consent — EC010
  "sms_consents.driver_id",        // SMS consent — SC010
]);
const HANDLED_IN_FUNCTION = new Set([
  "driver_scores.driver_id",             // per-week dedup, canonical's row wins
  "driver_performance_weeks.driver_id",  // per-week dedup
  "driver_duty_sessions.driver_id",      // open-shift dedup
  "driver_app_feature_overrides.driver_id", // PK (org,driver,feature) — canonical's override wins (0264)
]);
const EXEMPT = new Map([
  // The application PDF's capture rows key on the application, not the driver, once certified;
  // driver_id there is provenance. Anything listed here carries the argument with it.
]);

// Tables that no longer exist take their FKs with them.
const stripSql = (sql) => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const dropped = new Set();
const found = new Map(); // "table.column" -> migration file

for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
  const sql = stripSql(readFileSync(join(MIGRATIONS, f), "utf8"));
  for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi))
    dropped.add(m[1].toLowerCase());
  // create table bodies: capture table, then each "col ... references drivers(id)" line
  for (const t of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\);/gi)) {
    const table = t[1].toLowerCase();
    for (const c of t[2].matchAll(/^\s*([a-z_][a-z0-9_]*)\s+[^,\n]*references\s+(?:public\.)?drivers\s*\(\s*id\s*\)/gim))
      found.set(`${table}.${c[1].toLowerCase()}`, f);
  }
  // alter table add column ... references drivers(id)
  for (const a of sql.matchAll(/alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)[\s\S]*?add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s+[^,;]*references\s+(?:public\.)?drivers\s*\(\s*id\s*\)/gi))
    found.set(`${a[1].toLowerCase()}.${a[2].toLowerCase()}`, f);
  // add constraint ... foreign key (col) references drivers(id)
  for (const k of sql.matchAll(/alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)[\s\S]*?foreign\s+key\s*\(\s*([a-z_][a-z0-9_]*)\s*\)\s*references\s+(?:public\.)?drivers\s*\(\s*id\s*\)/gi))
    found.set(`${k[1].toLowerCase()}.${k[2].toLowerCase()}`, f);
}
for (const key of [...found.keys()]) if (dropped.has(key.split(".")[0])) found.delete(key);
found.delete("drivers.id");

// Parse DRIVER_REASSIGNMENTS from the TypeScript source (string-literal pairs).
const tsSrc = readFileSync(TS_LIST, "utf8");
const listed = new Set();
for (const m of tsSrc.matchAll(/\{\s*table:\s*"([a-z_][a-z0-9_]*)",\s*column:\s*"([a-z_][a-z0-9_]*)"/g))
  listed.add(`${m[1]}.${m[2]}`);
if (listed.size === 0) {
  console.error("✗ could not parse DRIVER_REASSIGNMENTS from mergeDriver.ts — the gate cannot check anything; fix the parser with the file");
  process.exit(1);
}

function verdict(refs) {
  const errors = [];
  for (const [key, mig] of refs) {
    if (listed.has(key) || REFUSAL_SET.has(key) || HANDLED_IN_FUNCTION.has(key) || EXEMPT.has(key)) continue;
    errors.push(`${key} (added in ${mig}) references drivers(id) but no merge list accounts for it — add it to DRIVER_REASSIGNMENTS in modules/roster/mergeDriver.ts (one line), or pin it here with the reason`);
  }
  for (const key of listed)
    if (!found.has(key)) errors.push(`DRIVER_REASSIGNMENTS lists ${key} but no migration defines that drivers(id) FK — stale entry, remove it`);
  return errors;
}

if (process.argv.includes("--self-test")) {
  const fake = new Map(found);
  fake.set("ghost_table.driver_id", "9999_synthetic.sql");
  const fails = [];
  if (!verdict(fake).some((e) => e.startsWith("ghost_table.driver_id"))) fails.push("unaccounted-FK detector did not fire");
  if (verdict(found).length !== 0) fails.push("real tree should be clean for the self-test baseline");
  if (fails.length) { for (const f of fails) console.error(`✗ self-test: ${f}`); process.exit(1); }
  console.log("✓ driver-references self-test — the unaccounted-FK detector fires.");
  process.exit(0);
}

const errors = verdict(found);
if (errors.length) {
  console.error(`✗ ${errors.length} driver-reference violation(s):`);
  for (const e of errors) console.error(`   ${e}`);
  process.exit(1);
}
console.log(
  `✓ driver references ok — ${found.size} drivers(id) FKs: ${[...found.keys()].filter((k) => listed.has(k)).length} merge-listed, ${REFUSAL_SET.size} refusal-set, ${HANDLED_IN_FUNCTION.size} in-function, ${EXEMPT.size} exempt.`,
);
