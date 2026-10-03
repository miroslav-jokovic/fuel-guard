// Silvicom 360 — recruiting_settings matrix (migration 0379, APPLICATION-FLOW-V2-PLAN.md S1, Q-AW41).
//
//   1. ONE ROW PER ORG, every answer required — no column default stands in for the shared constants.
//   2. THE BOUNDS — link 1–60 days (the same 60 as `INVITE_TTL_DAYS_MAX`), reminder 24–1440 hours.
//   3. A REMINDER THAT IS ON COMES BEFORE THE LINK DIES; one that is off keeps its number unchecked.
//   4. DENY-ALL — RLS enabled, zero client policies; the api is the only door.
//
// Run:  node supabase/tests/recruiting-settings.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false, file_size_limit bigint,
    allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text)
  returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  try { await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, "")); }
  catch (e) { console.error(`migration ${f} failed: ${e.message}`); process.exit(1); }
}

console.log("\n---- Matrix: recruiting-settings -----------------------------------");
const ORG = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
await db.query(`insert into organizations (id, name) values ($1,'Carrier A'), ($2,'Carrier B')`, [ORG, ORG_B]);

const refused = async (sql, params) => {
  try { await db.query(sql, params); return false; } catch { return true; }
};
const put = (org, days, on, hours) =>
  db.query(
    `insert into recruiting_settings (org_id, invite_ttl_days, reminders_enabled, reminder_after_hours)
     values ($1, $2, $3, $4)`,
    [org, days, on, hours],
  );
const clear = () => db.query(`delete from recruiting_settings`);

// ── 1. one row per org, every answer required ─────────────────────────────────────────────────
await put(ORG, 14, true, 48);
ok("a second row for the same org is refused", await refused(
  `insert into recruiting_settings (org_id, invite_ttl_days, reminders_enabled, reminder_after_hours) values ($1, 7, true, 48)`, [ORG]));
for (const col of ["invite_ttl_days", "reminders_enabled", "reminder_after_hours"]) {
  const cols = ["invite_ttl_days", "reminders_enabled", "reminder_after_hours"].filter((c) => c !== col);
  const vals = { invite_ttl_days: 14, reminders_enabled: true, reminder_after_hours: 48 };
  ok(`an org's row without ${col} is refused — no column default restates the shared constant`, await refused(
    `insert into recruiting_settings (org_id, ${cols.join(", ")}) values ($1, $2, $3)`, [ORG_B, vals[cols[0]], vals[cols[1]]]));
}
const defaults = await db.query(
  `select count(*)::int n from information_schema.columns
    where table_name = 'recruiting_settings'
      and column_name in ('invite_ttl_days','reminders_enabled','reminder_after_hours') and column_default is not null`);
ok("none of the three answers carries a column default", defaults.rows[0].n === 0);
await clear();

// ── 2. the bounds ─────────────────────────────────────────────────────────────────────────────
// The upper bound of the link must be the shared constant the invite route already accepts. Read from
// its source, because a CHECK cannot import it and a copy in this file would agree with itself.
const shared = readFileSync(join(SUPA, "..", "packages", "shared", "src", "applicationIntake.ts"), "utf8");
const max = Number(/export const INVITE_TTL_DAYS_MAX = (\d+);/.exec(shared)?.[1]);
ok("INVITE_TTL_DAYS_MAX was read from the shared source", Number.isInteger(max) && max > 1, `got ${max}`);
ok("a link of INVITE_TTL_DAYS_MAX days is accepted", !(await refused(
  `insert into recruiting_settings (org_id, invite_ttl_days, reminders_enabled, reminder_after_hours) values ($1, $2, true, 48)`, [ORG, max])));
await clear();
ok("a link of INVITE_TTL_DAYS_MAX + 1 days is refused", await refused(
  `insert into recruiting_settings (org_id, invite_ttl_days, reminders_enabled, reminder_after_hours) values ($1, $2, false, 48)`, [ORG, max + 1]));
ok("a link of 0 days is refused", await refused(
  `insert into recruiting_settings (org_id, invite_ttl_days, reminders_enabled, reminder_after_hours) values ($1, 0, false, 48)`, [ORG]));
ok("a link of 1 day is accepted (reminder off)", !(await refused(
  `insert into recruiting_settings (org_id, invite_ttl_days, reminders_enabled, reminder_after_hours) values ($1, 1, false, 48)`, [ORG])));
await clear();
// The hour bounds are the contract's (S2, recruitingSettingsContract.ts), read from source for the same
// reason as the day bound: the screen, the api and this CHECK must refuse the same numbers.
const contract = readFileSync(join(SUPA, "..", "packages", "shared", "src", "recruitingSettingsContract.ts"), "utf8");
const hMin = Number(/export const REMINDER_AFTER_HOURS_MIN = (\d+);/.exec(contract)?.[1]);
const hMax = Number(/export const REMINDER_AFTER_HOURS_MAX = (\d+);/.exec(contract)?.[1]);
ok("REMINDER_AFTER_HOURS_MIN and _MAX were read from the contract's source", Number.isInteger(hMin) && Number.isInteger(hMax) && hMin < hMax, `got ${hMin}, ${hMax}`);
ok("a reminder after REMINDER_AFTER_HOURS_MIN - 1 hours is refused", await refused(
  `insert into recruiting_settings (org_id, invite_ttl_days, reminders_enabled, reminder_after_hours) values ($1, 14, true, $2)`, [ORG, hMin - 1]));
ok("a reminder after REMINDER_AFTER_HOURS_MIN hours is accepted", !(await refused(
  `insert into recruiting_settings (org_id, invite_ttl_days, reminders_enabled, reminder_after_hours) values ($1, 14, true, $2)`, [ORG, hMin])));
await clear();
ok("a reminder after REMINDER_AFTER_HOURS_MAX + 1 hours is refused, even switched off", await refused(
  `insert into recruiting_settings (org_id, invite_ttl_days, reminders_enabled, reminder_after_hours) values ($1, 60, false, $2)`, [ORG, hMax + 1]));
ok("a reminder after REMINDER_AFTER_HOURS_MAX hours is accepted when switched off", !(await refused(
  `insert into recruiting_settings (org_id, invite_ttl_days, reminders_enabled, reminder_after_hours) values ($1, 60, false, $2)`, [ORG, hMax])));
await clear();

// ── 3. a reminder that is on comes before the link dies ───────────────────────────────────────
ok("a reminder at the moment a 2-day link dies (48 h) is refused while on", await refused(
  `insert into recruiting_settings (org_id, invite_ttl_days, reminders_enabled, reminder_after_hours) values ($1, 2, true, 48)`, [ORG]));
ok("a reminder at 47 h on a 2-day link is accepted", !(await refused(
  `insert into recruiting_settings (org_id, invite_ttl_days, reminders_enabled, reminder_after_hours) values ($1, 2, true, 47)`, [ORG])));
ok("shortening the link under a live reminder is refused on UPDATE too", await refused(
  `update recruiting_settings set invite_ttl_days = 1 where org_id = $1`, [ORG]));
ok("switching the reminder off lets the link shorten and keeps the carrier's number", !(await refused(
  `update recruiting_settings set reminders_enabled = false, invite_ttl_days = 1 where org_id = $1`, [ORG])));
const kept = await db.query(`select reminder_after_hours from recruiting_settings where org_id = $1`, [ORG]);
ok("the switched-off reminder still holds 47", kept.rows[0].reminder_after_hours === 47);
ok("switching it back on over a 1-day link is refused", await refused(
  `update recruiting_settings set reminders_enabled = true where org_id = $1`, [ORG]));

// ── the row's bookkeeping ─────────────────────────────────────────────────────────────────────
await db.query(`update recruiting_settings set updated_at = '2020-01-01' where org_id = $1`, [ORG]);
await db.query(`update recruiting_settings set invite_ttl_days = 3 where org_id = $1`, [ORG]);
const touched = await db.query(`select updated_at > '2021-01-01' as fresh from recruiting_settings where org_id = $1`, [ORG]);
ok("an update stamps updated_at", touched.rows[0].fresh === true);
await db.query(`delete from organizations where id = $1`, [ORG]);
const gone = await db.query(`select count(*)::int n from recruiting_settings`);
ok("deleting the org deletes its settings", gone.rows[0].n === 0);

// ── 4. deny-all ───────────────────────────────────────────────────────────────────────────────
const rls = await db.query(`select relrowsecurity from pg_class where relname='recruiting_settings'`);
const pol = await db.query(`select count(*)::int n from pg_policies where tablename='recruiting_settings'`);
ok("RLS enabled with zero client policies — deny-all on purpose", rls.rows[0].relrowsecurity === true && pol.rows[0].n === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
