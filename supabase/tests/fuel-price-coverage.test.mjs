// FuelGuard — fuel_price_coverage matrix (migration 0251).
//
// Discount capture can only price a fill on a day a quote exists for. Measured on production, that is
// 27.8% of the default window's spend — so WHICH DAYS are missing is the reader's actual next action,
// and three properties of this function decide whether they can see it:
//
//   1. A DAY WITH NOTHING MUST STILL APPEAR. The whole point is the gap. A group-by over what exists
//      can only return days it found rows for, which is why this generates the series (D-PC2).
//   2. `stale_days` LOOKS BACKWARDS PAST THE WINDOW. "Quotes start on the 2nd" is a fact about the org,
//      not about whatever the reader filtered to, and a day at the leading edge still carries forward.
//   3. ORG SCOPE, FAILING CLOSED. `security invoker` with `coalesce(p_org, auth_org_id())` — no org,
//      no rows (D-PC1), the same contract `fuel_spend_lines` has.
//
// Run:  node supabase/tests/fuel-price-coverage.test.mjs
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
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const all = async (q, p = []) => (await db.query(q, p)).rows;

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
    bucket_id text, name text, owner uuid, created_at timestamptz default now()
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
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;
const STATION = (await one(
  `insert into fuel_stations (brand, store_number, name, lat, lng, state)
   values ('pilot','436','Amarillo',35.2,-101.8,'TX') returning id`)).id;
const STATION2 = (await one(
  `insert into fuel_stations (brand, store_number, name, lat, lng, state)
   values ('pilot','747','Springville',40.1,-111.6,'UT') returning id`)).id;

const price = async (org, day, station = STATION) =>
  db.query(
    `insert into fuel_prices (org_id, station_id, product, posted_price, net_price, observed_at, source)
     values ($1,$2,'diesel',5.60,5.00,($3::date + interval '12 hours'),'pilot_daily')`,
    [org, station, day]);

// Quotes on the 2nd and the 5th only — the shape production actually has: a run of days, then gaps.
await price(ORG, "2026-08-02");
await price(ORG, "2026-08-02", STATION2);
await price(ORG, "2026-08-05");
await price(OTHER, "2026-08-03"); // another carrier's day, which must never appear below

const cov = async (from, to, org = ORG) =>
  await all(`select * from fuel_price_coverage($1::date, $2::date, $3)`, [from, to, org]);

// ── 1. every day appears, including the empty ones ───────────────────────────────────────────────
const week = await cov("2026-08-01", "2026-08-07");
ok("returns one row per day in the window, not one per day that has data", week.length === 7, `got ${week.length}`);
ok("a day with no quote is present and says so",
  week.find((r) => r.day.toISOString().slice(0, 10) === "2026-08-04")?.quoted_sites === 0);
ok("a day with quotes counts the distinct stations",
  week.find((r) => r.day.toISOString().slice(0, 10) === "2026-08-02")?.quoted_sites === 2);

// ── 2. staleness ────────────────────────────────────────────────────────────────────────────────
const byDay = Object.fromEntries(week.map((r) => [r.day.toISOString().slice(0, 10), r]));
ok("a day with its own quote is not stale", byDay["2026-08-02"].stale_days === 0);
ok("a day after one carries it forward, and says how far", byDay["2026-08-04"].stale_days === 2);
ok("a day BEFORE any quote exists reports nothing rather than zero",
  byDay["2026-08-01"].stale_days === null);

// The leading edge of a window still sees the quote behind it — "quotes start on the 2nd" is a fact
// about the org, not about what the reader filtered to.
const later = await cov("2026-08-06", "2026-08-07");
ok("a window opening after the last quote still carries it forward",
  later[0].stale_days === 1 && later[1].stale_days === 2, JSON.stringify(later));

// ── 3. org scope, failing closed ────────────────────────────────────────────────────────────────
const theirs = Object.fromEntries(
  (await cov("2026-08-01", "2026-08-07", OTHER)).map((r) => [r.day.toISOString().slice(0, 10), r]),
);
ok("the other carrier sees its own day", theirs["2026-08-03"].quoted_sites === 1);
ok("and not ours", theirs["2026-08-02"].quoted_sites === 0);
ok("nor we theirs", byDay["2026-08-03"].quoted_sites === 0);

const nobody = await all(`select * from fuel_price_coverage('2026-08-01'::date,'2026-08-07'::date, null)`);
ok("no org means no rows — it fails closed, like fuel_spend_lines", nobody.every((r) => r.quoted_sites === 0));

await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
