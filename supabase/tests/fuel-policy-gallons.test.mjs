// fuel_policy_gallons (0416) — the measurement Buy discipline grades its fuel targets from (Q-FSV16).
//
// The page used to download every `fuel_spend_lines` row and add them up in the browser, about nine
// seconds on production. This function adds the same rows up where they live and returns tractor
// gallons by month, brand and state. It carries no policy: which brand is "preferred" and which state
// is "avoided" are `gradePolicyTargets`' to decide in TypeScript, so nothing here may know a brand
// list. Four properties are asserted, each of which fails quietly if it breaks:
//
//   1. IT AGREES WITH THE ROWS IT SUMMARISES. The ruler is `fuel_spend_lines` read raw and summed in
//      this file, not a second SQL query written the same way — two queries by one author share their
//      mistakes. A cell that disagrees with the rows is a share the page would print wrongly.
//   2. THE FILTER IS `isTractorFuel`'S. A reefer fill, a zero-gallon fill and a fill with no cost are
//      not fuel the on-network share can speak for; counting them would move the share while no truck
//      bought a gallon.
//   3. THE MONTH IS THE STATION-LOCAL ONE. A fill at 03:00Z on the 1st is the evening of the 31st in
//      Texas; filed under the UTC month, a ceiling is held against gallons bought the month before.
//   4. SCOPE FAILS CLOSED. No org, no rows; another carrier's fills never appear (D-FC1, 0247).
//
// An unresolved station (no brand) is its OWN row, never dropped and never folded into a brand: TS
// counts it off-network and reports it as `unresolvedPct`, and can only do that if it arrives.
//
// Run:  node supabase/tests/fuel-policy-gallons.test.mjs
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
const rows = async (q, p = []) => (await db.query(q, p)).rows;

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text,
    owner uuid, owner_id text, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'EFS QA') returning id`)).id;
const station = async (brand, store, state) =>
  (await one(
    `insert into fuel_stations (brand,store_number,name,lat,lng,state,city)
     values ($1,$2,$3,35,-101,$4,'Town') returning id`,
    [brand, store, `${brand} #${store}`, state],
  )).id;
const PILOT_TX = await station("pilot", "436", "TX");
const LOVES_AZ = await station("loves", "210", "AZ");
const VEH = (await one(`insert into vehicles (org_id,unit_number,tank_capacity_gal) values ($1,'754',150) returning id`, [ORG])).id;
const VEH2 = (await one(`insert into vehicles (org_id,unit_number,tank_capacity_gal) values ($1,'755',150) returning id`, [ORG])).id;

// TX is America/Chicago and AZ America/Phoenix: 15:00Z is mid-morning in both, so the business date is
// the day named unless a test picks an hour that straddles local midnight on purpose.
const fill = (day, gallons, cost, o = {}) => {
  const { org = ORG, veh = VEH, st = PILOT_TX, at = "15:00:00", state = "TX", tank = "tractor" } = o;
  return db.query(
    `insert into fuel_transactions (org_id, vehicle_id, station_id, fueled_at, gallons, total_cost, state, tank_type, source)
     values ($1,$2,$3,$4::timestamptz,$5,$6,$7,$8,'import')`,
    [org, veh, st, `${day}T${at}Z`, gallons, cost, state, tank],
  );
};
const agg = (from, to, vehicles = null, org = ORG) =>
  rows(
    `select * from fuel_policy_gallons(p_from => $1::date, p_to => $2::date, p_vehicles => $3::uuid[], p_org => $4::uuid)`,
    [from, to, vehicles, org],
  );
const raw = (from, to, org = ORG) =>
  rows(`select * from fuel_spend_lines(p_from => $1::date, p_to => $2::date, p_org => $3::uuid)`, [from, to, org]);
const cell = (r, month, brand, state) => r.find((x) => x.month === month && x.brand === brand && x.state === state);

// ── 1. grouping by month, brand and state, checked against the raw rows ────────────────────────
await fill("2026-08-10", 100, 500);
await fill("2026-08-20", 50, 260);
await fill("2026-09-02", 80, 410);
await fill("2026-08-12", 70, 350, { st: LOVES_AZ, state: "AZ" });
await fill("2026-08-14", 40, 210, { st: null, state: "NM" }); // station never resolved: no brand

const r1 = await agg("2026-08-01", "2026-09-30");
ok("one row per month, brand and state", r1.length === 4, JSON.stringify(r1));
ok("a brand's gallons in a month are summed", Number(cell(r1, "2026-08", "pilot", "TX")?.gallons) === 150);
ok("and counted", cell(r1, "2026-08", "pilot", "TX")?.fills === 2);
ok("the next month is its own row", Number(cell(r1, "2026-09", "pilot", "TX")?.gallons) === 80);
ok("another brand and state is its own row", Number(cell(r1, "2026-08", "loves", "AZ")?.gallons) === 70);
ok(
  "an unresolved station arrives as its OWN null-brand row, not dropped",
  Number(cell(r1, "2026-08", null, "NM")?.gallons) === 40,
);

// Ruler: the raw rows, summed here in JS, grouped by a key built independently of the SQL.
const rawRows = (await raw("2026-08-01", "2026-09-30")).filter((x) => x.tank === "tractor" && Number(x.gallons) > 0 && x.net_amount != null);
const key = (m, b, s) => `${m}|${b}|${s}`;
const byRaw = new Map();
for (const x of rawRows) {
  const k = key(String(x.tran_date instanceof Date ? x.tran_date.toISOString() : x.tran_date).slice(0, 7), x.brand, x.state);
  byRaw.set(k, (byRaw.get(k) ?? 0) + Number(x.gallons));
}
ok(
  "every cell equals the raw rows summed independently",
  r1.length === byRaw.size && r1.every((x) => byRaw.get(key(x.month, x.brand, x.state)) === Number(x.gallons)),
  JSON.stringify([...byRaw]),
);
ok(
  "and the grand total is the raw total",
  r1.reduce((a, x) => a + Number(x.gallons), 0) === rawRows.reduce((a, x) => a + Number(x.gallons), 0),
);

// ── 2. the filter is isTractorFuel's ────────────────────────────────────────────────────────────
await fill("2026-08-15", 30, 150, { tank: "reefer" });
await fill("2026-08-16", 0, 0);
await fill("2026-08-17", 25, null);
const r2 = await agg("2026-08-01", "2026-09-30");
ok("a reefer fill adds nothing", Number(cell(r2, "2026-08", "pilot", "TX")?.gallons) === 150);
ok("a zero-gallon fill adds nothing, and not even a fill count", cell(r2, "2026-08", "pilot", "TX")?.fills === 2);
ok("a fill with no cost adds nothing", r2.length === 4);

// ── 3. the month is the station-local one ──────────────────────────────────────────────────────
// 03:00Z on 1 Sep is 22:00 on 31 Aug in Texas.
await fill("2026-09-01", 33, 170, { at: "03:00:00" });
const r3 = await agg("2026-08-01", "2026-09-30");
ok("an evening fill belongs to the local month it happened in", Number(cell(r3, "2026-08", "pilot", "TX")?.gallons) === 183);
ok("and not to the UTC month after it", Number(cell(r3, "2026-09", "pilot", "TX")?.gallons) === 80);

// ── 4. scope fails closed ──────────────────────────────────────────────────────────────────────
await fill("2026-08-11", 999, 4321, { org: OTHER, veh: null });
const r4 = await agg("2026-08-01", "2026-09-30");
ok("another carrier's fill never appears", Number(cell(r4, "2026-08", "pilot", "TX")?.gallons) === 183);
const theirs = await agg("2026-08-01", "2026-09-30", null, OTHER);
ok("asking for that carrier returns THEIR fill and not ours", theirs.length === 1 && Number(theirs[0].gallons) === 999);
ok(
  "a caller that names no org gets nothing, not everything",
  (await rows(`select * from fuel_policy_gallons(p_from => '2026-08-01', p_to => '2026-09-30')`)).length === 0,
);

// ── 5. the truck filter and the window ─────────────────────────────────────────────────────────
await fill("2026-08-18", 60, 300, { veh: VEH2 });
const both = await agg("2026-08-01", "2026-09-30");
const only2 = await agg("2026-08-01", "2026-09-30", [VEH2]);
ok("naming a truck keeps only its fills", only2.length === 1 && Number(only2[0].gallons) === 60);
ok("the other truck's gallons stay in the fleet figure", Number(cell(both, "2026-08", "pilot", "TX")?.gallons) === 243);
ok("a window that holds no fill returns no rows", (await agg("2026-07-01", "2026-07-31")).length === 0);
ok("the window's last day is inclusive", Number(cell(await agg("2026-08-10", "2026-08-10"), "2026-08", "pilot", "TX")?.gallons) === 100);

// ── 6. who may call it ─────────────────────────────────────────────────────────────────────────
const can = async (role) =>
  (await one(`select has_function_privilege($1, 'fuel_policy_gallons(date, date, uuid[], uuid)', 'execute') as ok`, [role])).ok;
ok("a signed-in browser may call it (supabase.rpc)", (await can("authenticated")) === true);
ok("the API's service role may call it", (await can("service_role")) === true);
ok("an anonymous caller may not", (await can("anon")) === false);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
