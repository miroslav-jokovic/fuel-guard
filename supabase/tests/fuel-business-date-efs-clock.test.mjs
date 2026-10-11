// Silvicom 360 — a fill's business date on EFS's Central clock (migration 0444, Q-F5, chunk 10a).
//
// 0287 stored the STATION's day. EFS prints the CENTRAL day (guide p. 10), and on production 129 fills
// — every one an evening fill west of Central — were filed a day before the statement bills them.
//
// What this matrix pins:
//   1. THE PLAN'S CASE. A Nevada fill at 22:12 local on 09-30 is 00:12 on 10-01 in Chicago: it is
//      inside October and outside September, after the backfill AND for a fill written afterwards.
//   2. THE BACKFILL MOVES ONLY WHAT CHANGES, QUIETLY. The moved row keeps its `updated_at` and its
//      satellites; a Central fill, whose day does not change, is not written at all.
//   3. THE READERS FOLLOW. `fuel_spend_lines` (and so `fuel_report_days`) dates the fill 10-01.
//   4. THE STATION NO LONGER MOVES THE DAY. Correcting the state leaves the business date where it is.
//   5. D-FI1 HOLDS. Neither per-row scalar carries a `SET` clause, which would block inlining (0248).
//
// Run:  node supabase/tests/fuel-business-date-efs-clock.test.mjs
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

// The backfill needs rows written under the station rule: apply everything before 0444, plant the
// history, then apply 0444 and after — the order production runs it in.
const apply = async (files) => {
  for (const f of files) {
    try { await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, "")); }
    catch (e) { console.error(`migration ${f} failed: ${e.message}`); process.exit(1); }
  }
};
await apply(MIGRATIONS.filter((f) => f < "0444"));

const ORG = "11111111-1111-1111-1111-111111111111";
const NV = "cccccccc-0000-0000-0000-000000000001"; // Nevada, 22:12 PDT on 09-30 = 05:12Z on 10-01
const TX = "cccccccc-0000-0000-0000-000000000002"; // Texas, midday: the same day on either rule
await db.query(`insert into organizations (id, name) values ($1,'Carrier A')`, [ORG]);
await db.query(
  `insert into fuel_transactions (id, org_id, fueled_at, state, gallons, total_cost, samsara_recon_status, is_canonical)
   values ($1, $3, '2026-10-01T05:12:00Z', 'NV', 150, 540.00, 'success', true),
          ($2, $3, '2026-09-15T17:00:00Z', 'TX', 120, 430.00, 'success', true)`,
  [NV, TX, ORG],
);
await db.query(`update fuel_transactions set updated_at = '2026-10-01T06:00:00Z' where org_id = $1`, [ORG]);
const dayOf = async (id) =>
  (await db.query(`select business_date::text as d from fuel_transactions where id=$1`, [id])).rows[0]?.d;
const stamps = async () =>
  JSON.stringify((await db.query(`select id, updated_at from fuel_transactions where org_id=$1 order by id`, [ORG])).rows);
const satStamps = async () =>
  JSON.stringify((await db.query(`select txn_id, updated_at from fuel_txn_recon order by txn_id`)).rows);

const nvBefore = await dayOf(NV);
const stampsBefore = await stamps();
const satBefore = await satStamps();
// xmin changes on every write, so an unchanged xmin is how "this row was not written" is observed.
const txXminBefore = (await db.query(`select xmin::text x from fuel_transactions where id=$1`, [TX])).rows[0].x;

await apply(MIGRATIONS.filter((f) => f >= "0444"));

console.log("\n---- Matrix: fuel-business-date-efs-clock --------------------------");

// ── 1. the plan's case, through the backfill ─────────────────────────────────────────────────
ok("before 0444 the Nevada fill was filed on the station's day, 09-30 (the plant is real)",
   nvBefore === "2026-09-30", `got ${nvBefore}`);
ok("after 0444 a Nevada fill at 22:12 local on 09-30 lands on 10-01, EFS's Central day",
   (await dayOf(NV)) === "2026-10-01", `got ${await dayOf(NV)}`);
const inMonth = async (from, to) =>
  (await db.query(
    `select count(*)::int n from fuel_transactions where id=$1 and business_date between $2 and $3`,
    [NV, from, to])).rows[0].n;
ok("  it is inside October", (await inMonth("2026-10-01", "2026-10-31")) === 1);
ok("  and outside September", (await inMonth("2026-09-01", "2026-09-30")) === 0);

// ── 2. the backfill is narrow and quiet ──────────────────────────────────────────────────────
ok("the backfill did not stamp updated_at on the fill it moved", (await stamps()) === stampsBefore);
ok("  nor re-write the 0261 satellites", (await satStamps()) === satBefore);
const txXminAfter = (await db.query(`select xmin::text x from fuel_transactions where id=$1`, [TX])).rows[0].x;
ok("  and a Central fill whose day does not change was not written at all", txXminAfter === txXminBefore,
   `xmin ${txXminBefore} → ${txXminAfter}`);
ok("  that Central fill keeps its day", (await dayOf(TX)) === "2026-09-15");

// ── 1 again, for a fill written after the migration ──────────────────────────────────────────
const NEW = "cccccccc-0000-0000-0000-000000000003";
await db.query(
  `insert into fuel_transactions (id, org_id, fueled_at, state, gallons, business_date, is_canonical)
   values ($1, $2, '2026-10-01T05:12:00Z', 'NV', 80, '2026-09-30', true)`,
  [NEW, ORG],
);
ok("a new Nevada fill at 22:12 local on 09-30 is stored on 10-01, whatever the writer sent",
   (await dayOf(NEW)) === "2026-10-01", `got ${await dayOf(NEW)}`);

// ── 3. the composed readers follow ───────────────────────────────────────────────────────────
const lines = await db.query(
  `select tran_date::text d from fuel_spend_lines('2026-09-29', '2026-10-02', null, $1) where net_amount = 540`,
  [ORG]);
ok("fuel_spend_lines dates the Nevada fill 10-01 too", lines.rows.length === 1 && lines.rows[0].d === "2026-10-01",
   JSON.stringify(lines.rows));

// ── 4. the station no longer moves the day ───────────────────────────────────────────────────
await db.query(`update fuel_transactions set state='TX' where id=$1`, [NEW]);
ok("correcting the state leaves the business date on EFS's day", (await dayOf(NEW)) === "2026-10-01");
await db.query(`update fuel_transactions set fueled_at='2026-10-01T04:59:00Z' where id=$1`, [NEW]);
ok("  while correcting the instant across Central midnight moves it", (await dayOf(NEW)) === "2026-09-30");

// ── 5. D-FI1: no SET clause on either per-row scalar ─────────────────────────────────────────
const cfg = await db.query(
  `select proname, proconfig from pg_proc where proname in ('efs_clock_tz', 'fuel_business_date') order by proname`);
ok("efs_clock_tz and fuel_business_date both exist", cfg.rows.length === 2, JSON.stringify(cfg.rows));
ok("  and neither carries a SET clause that would block inlining (0248)",
   cfg.rows.every((r) => r.proconfig === null), JSON.stringify(cfg.rows));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
