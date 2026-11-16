#!/usr/bin/env node
/**
 * A role or database setting in a migration must mean the same thing written in lower case.
 *
 * ── WHY IT EXISTS: THE OUTAGE OF 2026-11-15 ────────────────────────────────────────────────────────
 * Migration 0610 ran `alter role service_role set work_mem = '16MB'`. PostgREST re-applies the settings
 * of the role it impersonates at the start of every transaction, and production's build (14.5) hands
 * the value over in LOWER CASE. Postgres's memory units are case-sensitive — `MB` is one, `mb` is not
 * (asked of production itself that day: `set_config('work_mem','16mb',true)` → 22023 "invalid value for
 * parameter", `'16MB'` and `'16384'` → accepted). So every service-role request failed: 2,332 error
 * lines in CloudWatch from 17:43:29 to 18:08:50 UTC, 25 minutes with the API off the database, until
 * the setting was reset by hand (0613).
 *
 * Nothing could have seen it: the PGlite matrices have no PostgREST, and STAGING CARRIED THE SAME
 * MIGRATION WITHOUT ONE ERROR — it runs PostgREST 14.18 and Postgres 17.11 where production runs 14.5
 * and 17.6 (measured 2026-11-15; `schema-drift.mjs` now prints that difference every night). A setting
 * the PLATFORM applies is the one kind of migration staging cannot vouch for.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────────────────────────────
 * For every `alter role … set name = value` and `alter database … set name = value` in a migration
 * numbered above GRANDFATHERED, a real Postgres (PGlite) is asked two things:
 *   1. does it accept the value as written?
 *   2. does it accept the value in lower case, and read it back as the SAME setting?
 * `'16MB'` fails 2; `'16384'` (kB) and `'60s'` pass. It is the failure itself that is executed, not a
 * list of units somebody would have to keep.
 *
 * It asks this of EVERY role, not only the three PostgREST impersonates (anon, authenticated,
 * service_role): which roles and which builds re-apply settings is the platform's business and has
 * already changed once under us. A value that only works in one letter-case is a trap on any role.
 *
 * A statement that truly needs a case-sensitive value carries, on the line above it,
 *   -- role-setting-waiver: <why, and how it was proven on PRODUCTION's own PostgREST>
 *
 * ⚠ Blind spot, stated: a setting made inside dynamic SQL (`execute format('alter role …')`) is not
 * read. A statement inside a plain `do $$ … $$` block is — 0610's own second half is written that way.
 *
 * Run:  node scripts/check-role-settings.mjs
 *       node scripts/check-role-settings.mjs --self-test
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** 0610 is the outage and 0613 its reset; both are applied and may not be edited. Everything after is held. */
export const GRANDFATHERED = 613;
const MIGRATIONS = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const STATEMENT = /alter\s+(role|user|database)\s+("[^"]+"|[\w$]+)(?:\s+in\s+database\s+(?:"[^"]+"|[\w$]+))?\s+set\s+([\w.]+)\s*(?:=|\s+to\s)\s*([^;]+);/gi;

/** `'16MB'` → `16MB`; `on` → `on`. A list (`a, b`) is kept whole, as Postgres would take it from set_config. */
const unquote = (raw) => {
  const v = raw.trim();
  return /^'.*'$/s.test(v) ? v.slice(1, -1).replace(/''/g, "'") : v;
};

/** Every role/database setting in one migration's SQL, with whether the line above waives it. */
export function settingsIn(sql) {
  const lines = sql.split("\n");
  // Comments are blanked, not removed, so an offset still maps to its line — and a commented-out
  // statement is not a statement.
  const code = lines.map((l) => { const i = l.indexOf("--"); return i < 0 ? l : l.slice(0, i) + " ".repeat(l.length - i); }).join("\n");
  const found = [];
  for (const m of code.matchAll(STATEMENT)) {
    const value = m[4].trim();
    if (/^(default|from\s+current)$/i.test(value)) continue;
    const line = code.slice(0, m.index).split("\n").length;
    const waiver = /--\s*role-setting-waiver:\s*\S/.test(lines[line - 2] ?? "");
    found.push({ line, target: `${m[1].toLowerCase()} ${m[2]}`, name: m[3], value: unquote(value), waiver });
  }
  return found;
}

/** What a real Postgres makes of `value` for `name`: the setting as it reads back, or the refusal. */
async function reads(db, name, value) {
  try {
    await db.exec("begin");
    const { rows } = await db.query("select set_config($1, $2, true) as v", [name, value]);
    return { ok: true, value: rows[0].v };
  } catch (e) {
    return { ok: false, error: String(e.message).split("\n")[0] };
  } finally {
    await db.exec("rollback");
  }
}

/** The verdict on one setting: null when it is safe, else the sentence to print. */
export async function judge(db, s) {
  const written = await reads(db, s.name, s.value);
  if (!written.ok) return `Postgres does not accept it as written: ${written.error}`;
  const lowered = await reads(db, s.name, s.value.toLowerCase());
  if (!lowered.ok) {
    return `in lower case — how production's PostgREST handed 0610's value to Postgres — it is refused: ${lowered.error}. ` +
      `Write it without a case-sensitive unit (memory in kB as a bare number: 16MB is 16384).`;
  }
  if (lowered.value !== written.value) {
    return `in lower case it reads as a DIFFERENT setting ("${lowered.value}" instead of "${written.value}").`;
  }
  return null;
}

async function selfTest() {
  const db = new PGlite();
  const verdict = async (sql) => {
    const out = [];
    for (const s of settingsIn(sql)) out.push({ ...s, problem: s.waiver ? null : await judge(db, s) });
    return out;
  };
  const one = async (sql) => (await verdict(sql))[0];
  const cases = [
    ["0610's own statement fails", !!(await one("alter role service_role set work_mem = '16MB';")).problem],
    ["...and says how to write it", (await one("alter role service_role set work_mem = '16MB';")).problem.includes("16384")],
    ["the same memory in kB passes", (await one("alter role service_role set work_mem = '16384';")).problem === null],
    ["a lower-case time unit passes — 0610's other setting", (await one("alter role authenticator set idle_in_transaction_session_timeout = '60s';")).problem === null],
    ["an upper-case time unit that Postgres itself refuses is reported as written", (await one("alter role anon set statement_timeout = '3S';")).problem.startsWith("Postgres does not accept it as written")],
    ["a boolean passes", (await one("alter role authenticator set track_io_timing = 'on';")).problem === null],
    ["`set … to` is read like `set … =`", !!(await one("alter role service_role set work_mem to '16MB';")).problem],
    ["a database setting is held to the same rule", !!(await one("alter database postgres set work_mem = '8MB';")).problem],
    ["a setting inside a do block is read", (await verdict("do $$\nbegin\n  if true then\n    alter role authenticator set work_mem = '4MB';\n  end if;\nend $$;")).length === 1],
    ["a value whose case carries meaning is caught, not only units", !!(await one("alter database postgres set app.settings.token = 'AbC';")).problem],
    ["a reset is not a setting", (await verdict("alter role service_role reset work_mem;")).length === 0],
    ["a commented-out statement is not a statement", (await verdict("-- alter role service_role set work_mem = '16MB';")).length === 0],
    ["the waiver on the line above lets one through", (await one("-- role-setting-waiver: proven on production's PostgREST 2026-11-16\nalter role service_role set work_mem = '16MB';")).problem === null],
    ["...and a waiver two lines up does not", !!(await one("-- role-setting-waiver: stale\n\nalter role service_role set work_mem = '16MB';")).problem],
    ["the line reported is the statement's", (await one("select 1;\n\nalter role service_role set work_mem = '16MB';")).line === 3],
    ["0610 as it was merged is caught by this rule", await (async () => {
      const v = await verdict(readFileSync(join(MIGRATIONS, "0610_service_role_sort_memory_and_park_session_time_index.sql"), "utf8"));
      return v.length === 3 && v.filter((s) => s.problem).map((s) => s.name).join() === "work_mem";
    })()],
  ];
  const failed = cases.filter(([, ok]) => !ok);
  for (const [name, ok] of cases) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  console.log(`\nRESULT: ${cases.length - failed.length} passed, ${failed.length} failed`);
  await db.close();
  process.exit(failed.length === 0 ? 0 : 1);
}

async function main() {
  const db = new PGlite();
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) > GRANDFATHERED).sort();
  let checked = 0;
  const problems = [];
  for (const file of files) {
    for (const s of settingsIn(readFileSync(join(MIGRATIONS, file), "utf8"))) {
      checked += 1;
      if (s.waiver) { console.log(`  waived  ${file}:${s.line}  ${s.target} set ${s.name}`); continue; }
      const problem = await judge(db, s);
      if (problem) problems.push(`${file}:${s.line}  alter ${s.target} set ${s.name} = '${s.value}' — ${problem}`);
    }
  }
  await db.close();
  if (problems.length > 0) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error(`RESULT ${problems.length} role or database setting(s) that production may not read as written (the 2026-11-15 outage). See this script's header.`);
    process.exit(1);
  }
  console.log(`RESULT ✓ ${checked} role/database setting(s) in ${files.length} migration(s) above ${String(GRANDFATHERED).padStart(4, "0")} read the same in lower case.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--self-test")) await selfTest();
  else await main();
}
