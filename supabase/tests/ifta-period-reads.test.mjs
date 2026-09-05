// FuelGuard — ifta_period_reads matrix (migration 0256).
//
// The two reads behind the IFTA ledger. Three properties decide whether a quarter can be filed on,
// and each fails quietly:
//
//   1. THE JOIN IS FULL, IN BOTH DIRECTIONS. A jurisdiction with miles and no purchases OWES tax; one
//      with purchases and no miles HOLDS a credit. An inner join loses half a return and the total
//      still looks like a total.
//   2. THE QUARTER IS THREE MONTHS OF MILES AND THE SAME THREE MONTHS OF FUEL. If the two halves
//      describe different windows the net is wrong by whatever fell between them.
//   3. ORG SCOPE, FAILING CLOSED. `security invoker` + `coalesce(p_org, auth_org_id())` (D-FC1).
//
// Run:  node supabase/tests/ifta-period-reads.test.mjs
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
/** The SQLSTATE a statement raises, or null when it succeeds. */
const sqlstate = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
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
const USER = (await one(`insert into auth.users (id,email) values (gen_random_uuid(),'a@b.c') returning id`)).id;

const truck = async (org, unit) =>
  (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,$2,240) returning id`, [org, unit])).id;
const V1 = await truck(ORG, "701");
const V2 = await truck(ORG, "702");
const VOTHER = await truck(OTHER, "999");

const MI = 1609.344;
const miles = async (vehicle, jurisdiction, taxableMiles, o = {}) =>
  db.query(
    `insert into samsara_ifta_jurisdiction_miles
       (org_id, vehicle_id, samsara_vehicle_id, period_year, period_month, jurisdiction, recognised,
        taxable_meters, total_meters, tax_paid_liters)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [o.org ?? ORG, vehicle, o.sid ?? "s-1", o.year ?? 2026, o.month ?? 4, jurisdiction,
     o.recognised ?? true, taxableMiles * MI, (o.totalMiles ?? taxableMiles) * MI, o.liters ?? 0]);

const fill = async (state, gallons, at, o = {}) =>
  db.query(
    `insert into fuel_transactions (org_id, vehicle_id, fueled_at, state, gallons, total_cost, tank_type)
     values ($1,$2,$3::timestamptz,$4,$5,$6,$7)`,
    [o.org ?? ORG, o.vehicle ?? V1, at, state, gallons, o.cost ?? gallons * 4.5, o.tank ?? "tractor"]);

const jur = async (year = 2026, quarter = 2, org = ORG) =>
  await all(`select * from ifta_period_jurisdictions($2,$3,$1)`, [org, year, quarter]);
const sum = async (year = 2026, quarter = 2, org = ORG) =>
  (await all(`select * from ifta_period_summary($2,$3,$1)`, [org, year, quarter]))[0];

// Q2 2026: miles in TX (April) and CA (May); fuel bought in TX and in NM — where nothing was driven.
await miles(V1, "TX", 20000, { month: 4 });
await miles(V2, "TX", 15000, { month: 4, sid: "s-2" });
await miles(V1, "CA", 35000, { month: 5 });
await miles(V1, "ON", 1000,  { month: 5, recognised: false });
await fill("TX", 6000, "2026-04-10T18:00:00Z");
await fill("NM", 4000, "2026-05-10T18:00:00Z");
// Out of the quarter on both sides, and a reefer fill that is not a tractor's buying decision.
await miles(V1, "TX", 99999, { month: 3 });
await fill("TX", 9999, "2026-07-02T18:00:00Z");
await fill("TX", 555, "2026-05-11T18:00:00Z", { tank: "reefer" });
// Another carrier's, which must never appear.
await miles(VOTHER, "TX", 12345, { org: OTHER, month: 4, sid: "s-9" });
await fill("TX", 777, "2026-04-11T18:00:00Z", { org: OTHER, vehicle: VOTHER });

const rows = await jur();
const byJ = Object.fromEntries(rows.map((r) => [r.jurisdiction, r]));

// ── 1. the full join, in both directions ────────────────────────────────────────────────────────
ok("a jurisdiction with miles and no purchases is returned — it owes tax",
  byJ.CA != null && Number(byJ.CA.purchased_gallons) === 0 && Number(byJ.CA.taxable_meters) > 0,
  JSON.stringify(byJ.CA));
ok("a jurisdiction with purchases and no miles is returned — it holds a credit",
  byJ.NM != null && Number(byJ.NM.purchased_gallons) === 4000 && Number(byJ.NM.taxable_meters) === 0,
  JSON.stringify(byJ.NM));
ok("and one with both is a single row, not two",
  byJ.TX != null && rows.filter((r) => r.jurisdiction === "TX").length === 1);

// ── 2. the quarter is three months, on both halves ──────────────────────────────────────────────
ok("miles are summed across the quarter's months AND across trucks",
  Math.round(Number(byJ.TX.taxable_meters) / MI) === 35000, String(Number(byJ.TX.taxable_meters) / MI));
ok("a month outside the quarter is not counted",
  Math.round(Number(byJ.TX.taxable_meters) / MI) !== 135000);
ok("fuel outside the quarter is not counted",
  Number(byJ.TX.purchased_gallons) === 6000, String(byJ.TX.purchased_gallons));
ok("reefer fuel is not a tractor's buying decision and never appears",
  Number(byJ.TX.purchased_gallons) !== 6555);
// Q4, not Q1: the out-of-quarter March row above lives in Q1, so Q1 was never the empty one.
ok("a quarter with nothing in it returns no rows rather than throwing",
  (await jur(2026, 4)).length === 0);

// ── 3. what the surface needs to name a gap ─────────────────────────────────────────────────────
ok("an unrecognised jurisdiction is returned with its flag, not dropped",
  byJ.ON != null && byJ.ON.recognised === false, JSON.stringify(byJ.ON));
ok("the fill count comes with the gallons, so a share can state its own denominator",
  Number(byJ.TX.purchased_fills) === 1);

// ── 4. the summary: the second mileage reading and the fetch's own account ──────────────────────
// `fuel_spend_days_miles_pair` (0244) requires miles and mpg_gallons to be zero together — miles with
// no gallons behind them is exactly the state that table refuses to hold, which is the same instinct
// as `assessMpg`. The fixture honours it rather than working around it.
await db.query(
  `insert into fuel_spend_days (org_id, vehicle_id, day, miles, miles_rejected, mpg_gallons, gallons_tractor)
   values ($1,$2,'2026-04-10',18000,120,2600,6000), ($1,$3,'2026-05-10',12000,0,1700,0)`, [ORG, V1, V2]);
await db.query(
  `insert into samsara_ifta_fetches (org_id, period_year, period_month, provisional, unmapped_vehicles, troubleshooting)
   values ($1,2026,4,false,0,'{"unassignedFuelTypeVehicles":187}'::jsonb),
          ($1,2026,5,true,3,'{"unassignedFuelTypeVehicles":190}'::jsonb)`, [ORG]);
const s = await sum();
ok("the odometer miles come back for the tie-out's second reading",
  Number(s.odometer_miles) === 30000, String(s.odometer_miles));
ok("and the rejected intervals with them, so the reading can state its own quality",
  Number(s.odometer_rejected) === 120);
ok("a quarter is provisional if ANY of its months is",
  s.any_provisional === true);
ok("the worst unmapped count wins, because one bad month makes the quarter wrong",
  Number(s.max_unmapped) === 3);
ok("every month fetched is counted", Number(s.months_fetched) === 2);
ok("the troubleshooting block comes from the most recent fetch",
  s.troubleshooting.unassignedFuelTypeVehicles === 190, JSON.stringify(s.troubleshooting));

// A re-fetch of one month must not double-count it in `months_fetched`.
await db.query(
  `insert into samsara_ifta_fetches (org_id, period_year, period_month, provisional, unmapped_vehicles, troubleshooting)
   values ($1,2026,5,false,1,'{"unassignedFuelTypeVehicles":12}'::jsonb)`, [ORG]);
const s2 = await sum();
ok("a re-fetched month is still ONE month, and the latest fetch is the one that counts",
  Number(s2.months_fetched) === 2 && s2.any_provisional === false && Number(s2.max_unmapped) === 1,
  JSON.stringify([s2.months_fetched, s2.any_provisional, s2.max_unmapped]));

// ── 5. org scope, failing closed ────────────────────────────────────────────────────────────────
ok("another carrier's miles and fuel never appear",
  Number(byJ.TX.taxable_meters) / MI === 35000 && Number(byJ.TX.purchased_gallons) === 6000);
ok("the other carrier sees its own", (await jur(2026, 2, OTHER)).length > 0);

async function asClient(org, role, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: USER, org_id: org, user_role: role, role: "authenticated" }),
    ]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return { rows: res.rows, error: null };
  } catch (e) {
    await db.exec("rollback");
    return { rows: [], error: e.code ?? String(e.message) };
  }
}
const mine = await asClient(ORG, "admin", `select count(*)::int n from ifta_period_jurisdictions(2026, 2, null)`);
ok("a browser passing no org is scoped by its JWT", (mine.rows[0]?.n ?? 0) > 0, JSON.stringify(mine));
const crossed = await asClient(ORG, "admin", `select count(*)::int n from ifta_period_jurisdictions(2026, 2, $1)`, [OTHER]);
ok("and naming another carrier's org returns nothing, because RLS still applies underneath",
  crossed.rows[0]?.n === 0, JSON.stringify(crossed));


// ── THE CALL THE BROWSER ACTUALLY MAKES (0257) ──────────────────────────────────────────────────
// Every assertion above passes `p_org` explicitly, which is the API's call — and it is exactly why
// this file was green while `ifta_period_jurisdictions` was unreachable from the only surface that uses it. PostgREST
// resolves an RPC on the set of NAMED arguments supplied, so a parameter with no DEFAULT means there
// is no form that omits it, and the browser gets "could not find the function ... in the schema
// cache". D-FC1 says `coalesce(p_org, auth_org_id())`; the coalesce was there and the default was not.
// Named arguments with p_org OMITTED — not passed as null, OMITTED. That distinction is the whole
// defect: a positional `(…, null)` resolves fine without a default, which is why every assertion
// above passed while `/ifta` could not call either function at all.
const jurCall = await asClient(ORG, "admin",
  `select count(*)::int n from ifta_period_jurisdictions(p_year => 2026, p_quarter => 2)`);
ok("the browser's call — named arguments, p_org omitted entirely — resolves",
  jurCall.error === null, String(jurCall.error));
ok("and returns this org's rows, so the default really does fall through to auth_org_id()",
  (jurCall.rows[0]?.n ?? 0) > 0, JSON.stringify(jurCall.rows[0]));
const sumCall = await asClient(ORG, "admin",
  `select count(*)::int n from ifta_period_summary(p_year => 2026, p_quarter => 2)`);
ok("and the summary's browser call too — both were broken, and one being fixed proves nothing",
  sumCall.error === null, String(sumCall.error));

// Release the WASM database before the verdict. This matrix exits explicitly only when it FAILS, so
// on the green path Node had to drain PGlite's handles on its own — ~10 seconds of idle wait after
// the last assertion, paid once per matrix per run. Measured 2026-09-05: 11.33s -> 1.32s here.
await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
