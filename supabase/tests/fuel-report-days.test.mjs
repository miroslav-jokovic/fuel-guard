// FuelGuard — fuel_report_days / fuel_report_sites matrix (migration 0405, FS1 of
// docs/plans/fuel/FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md).
//
// The Fuel Costs report filters fuel by truck, state, station and network and shows it per day. The
// function SUMS `fuel_spend_lines` and the spec of those sums lives in `@silvicom/shared`
// (`filterFuelReportLines`, `foldFuelReportDays`), imported here from `dist` — so the parity checks below
// compare SQL against the real TypeScript, not against a restatement of it in this file.
//
// What fails quietly if it breaks:
//   1. THE UNKNOWN BUCKET. A fill with no station folded into `out` charges an unknown to the drivers;
//      into `in`, it disappears. D-FSV2 gives it its own bucket.
//   2. THE BRAND LIST IS AN ARGUMENT. If SQL hard-coded Pilot/Flying J, the report and the planner
//      would disagree the day the carrier changes `preferred_brands`.
//   3. QUOTED-ONLY SUMS. A discount is retail − spend over the fills that HAD a posted price; summing
//      spend over every fill beside a quoted-only retail figure invents a discount (or a loss).
//   4. ORG SCOPE fails closed, as in every fuel read (D-FC1).
//
// Run:  node supabase/tests/fuel-report-days.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { filterFuelReportLines, foldFuelReportDays, fuelNetworkOf } from "../../packages/shared/dist/index.js";

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
const station = async (brand, store, state, city) =>
  (await one(`insert into fuel_stations (brand,store_number,name,lat,lng,state,city) values ($1,$2,$1,35,-101,$3,$4) returning id`,
    [brand, store, state, city])).id;
const PILOT = await station("pilot", "436", "TX", "Amarillo");
const FJ = await station("flying_j", "706", "OK", "Tulsa");
const ONE9 = await station("one9", "1251", "TX", "Dallas");
const LOVES = await station("loves", "88", "CA", "Barstow");
const V1 = (await one(`insert into vehicles (org_id,unit_number,tank_capacity_gal) values ($1,'754',150) returning id`, [ORG])).id;
const V2 = (await one(`insert into vehicles (org_id,unit_number,tank_capacity_gal) values ($1,'612',150) returning id`, [ORG])).id;

// 15:00Z is morning in every zone used here, so the business date is the day named.
const fill = (day, st, gallons, cost, { org = ORG, veh = V1, state = "TX", tank = "tractor", at = "15:00:00", text = null } = {}) =>
  db.query(
    `insert into fuel_transactions (org_id, vehicle_id, station_id, fueled_at, gallons, total_cost, state, tank_type, source, location_text)
     values ($1,$2,$3,$4::timestamptz,$5,$6,$7,$8,'import',$9)`,
    [org, veh, st, `${day}T${at}Z`, gallons, cost, state, tank, text],
  );
const price = (st, day, posted, net) =>
  db.query(
    `insert into fuel_prices (org_id, station_id, product, posted_price, net_price, source, observed_at)
     values ($1,$2,'diesel',$3,$4,'pilot_email',$5::timestamptz)`,
    [ORG, st, posted, net, `${day}T12:00:00Z`],
  );

// ── fixture: every bucket, both tanks, quoted and unquoted fills, two trucks, three states ─────────
await price(PILOT, "2026-09-01", 5.5, 5.0);
await price(FJ, "2026-09-01", 5.4, 4.9);
// A quote with a contract price and NO posted price: retail and contract sums must not share a filter.
await price(PILOT, "2026-09-02", null, 5.1);
await fill("2026-09-01", PILOT, 100, 500);                                  // in, quoted
await fill("2026-09-01", PILOT, 20, 110, { tank: "reefer" });               // in, reefer, quoted
await fill("2026-09-01", FJ, 120, 590, { veh: V2, state: "OK" });           // in, quoted
await fill("2026-09-01", ONE9, 80, 470);                                    // out (ONE9, R11), unquoted
await fill("2026-09-01", null, 90, 520, { veh: V2, text: "BOB'S DIESEL" }); // unknown, TX
await fill("2026-09-02", PILOT, 110, 562);                                  // in, contract-only quote
await fill("2026-09-02", LOVES, 70, 480, { veh: V2, state: "CA" });         // out, CA
await fill("2026-09-02", null, 60, 400, { state: "CA", text: "SOMEWHERE" }); // unknown, CA
await fill("2026-09-03", FJ, 100, 495, { veh: V2, state: "OK" });           // in, no quote in range (09-01 is 2 days back)
await fill("2026-09-01", PILOT, 999, 9999, { org: OTHER, veh: null });      // another carrier

const IN = ["pilot", "flying_j"];
const days = (p = {}) =>
  rows(
    `select * from fuel_report_days(p_from => $1::date, p_to => $2::date, p_in_network_brands => $3::text[],
       p_vehicles => $4::uuid[], p_states => $5::text[], p_sites => $6::uuid[], p_network => $7::text[], p_org => $8::uuid)`,
    [p.from ?? "2026-09-01", p.to ?? "2026-09-30", p.brands ?? IN, p.vehicles ?? null, p.states ?? null, p.sites ?? null,
      p.networks ?? null, p.org === undefined ? ORG : p.org],
  );
const spendLines = async (p = {}) =>
  (await rows(`select * from fuel_spend_lines(p_from => $1::date, p_to => $2::date, p_vehicles => $3::uuid[], p_org => $4::uuid)`,
    [p.from ?? "2026-09-01", p.to ?? "2026-09-30", p.vehicles ?? null, ORG])).map((r) => ({
    tranDate: ymd(r.tran_date), brand: r.brand, state: r.state, stationId: r.station_id, tank: r.tank,
    gallons: Number(r.gallons), netAmount: r.net_amount == null ? null : Number(r.net_amount),
    retailAmount: r.retail_amount == null ? null : Number(r.retail_amount),
    contractAmount: r.contract_amount == null ? null : Number(r.contract_amount),
  }));
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));
const shape = (r) => ({
  day: ymd(r.day), network: r.network, tank: r.tank, fills: Number(r.fills), gallons: Number(r.gallons), spend: Number(r.spend),
  retailFills: Number(r.retail_fills), retailGallons: Number(r.retail_gallons), retailSpend: Number(r.retail_spend), retail: Number(r.retail),
  contractFills: Number(r.contract_fills), contractGallons: Number(r.contract_gallons), contractSpend: Number(r.contract_spend),
  contract: Number(r.contract),
});
const near = (a, b) => JSON.stringify(a, (_, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v)) ===
  JSON.stringify(b, (_, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v));

// ── 1. parity with the shared spec, over every filter shape ─────────────────────────────────────
const CASES = [
  ["no filter", {}],
  ["one truck", { vehicles: [V2] }],
  ["one state", { states: ["CA"] }],
  ["two states", { states: ["TX", "OK"] }],
  ["two stations", { sites: [PILOT, LOVES] }],
  ["out of network", { networks: ["out"] }],
  ["unknown station only", { networks: ["unknown"] }],
  ["in + unknown in TX", { networks: ["in", "unknown"], states: ["TX"] }],
  ["ONE9 counted in by a carrier that says so", { brands: ["pilot", "flying_j", "one9"] }],
  ["a one-day window", { from: "2026-09-02", to: "2026-09-02" }],
];
for (const [name, p] of CASES) {
  const sql = (await days(p)).map(shape);
  const lines = await spendLines(p);
  const spec = foldFuelReportDays(
    filterFuelReportLines(lines, { states: p.states ?? null, stationIds: p.sites ?? null, networks: p.networks ?? null }, p.brands ?? IN),
    p.brands ?? IN,
  );
  ok(`SQL equals the shared spec — ${name}`, sql.length > 0 && near(sql, spec), `\n sql ${JSON.stringify(sql)}\n spec ${JSON.stringify(spec)}`);
}

// ── 2. the buckets (D-FSV2) ─────────────────────────────────────────────────────────────────────
let r = (await days()).map(shape);
const bucket = (day, network, tank = "tractor") => r.find((x) => x.day === day && x.network === network && x.tank === tank);
ok("Pilot and Flying J are in network", bucket("2026-09-01", "in")?.fills === 2 && bucket("2026-09-01", "in")?.spend === 1090);
ok("ONE9 is OUT of network (R11)", bucket("2026-09-01", "out")?.spend === 470);
ok(
  "a fill with no station is its own bucket, in neither side",
  bucket("2026-09-01", "unknown")?.spend === 520 && bucket("2026-09-01", "unknown")?.fills === 1,
);
ok("reefer fuel is its own row, never inside the tractor figures", bucket("2026-09-01", "in", "reefer")?.gallons === 20);
ok(
  "every dollar is in exactly one bucket",
  r.reduce((s, x) => s + x.spend, 0) === 500 + 110 + 590 + 470 + 520 + 562 + 480 + 400 + 495,
);
ok("the shared definition agrees: no brand is unknown", fuelNetworkOf(null, IN) === "unknown" && fuelNetworkOf("one9", IN) === "out");
r = (await days({ brands: ["pilot", "flying_j", "one9"] })).map(shape);
ok(
  "the network list is the CALLER's: a carrier that names ONE9 gets it in network",
  bucket("2026-09-01", "in")?.spend === 1560 && !bucket("2026-09-01", "out"),
);
let threw = false;
try { await rows(`select * from fuel_report_days(p_from => '2026-09-01', p_to => '2026-09-30', p_org => $1::uuid)`, [ORG]); }
catch { threw = true; }
ok("and there is no default list to fall back on — a call that omits it does not resolve", threw);

// ── 3. quoted-only sums ─────────────────────────────────────────────────────────────────────────
r = (await days()).map(shape);
const d1 = bucket("2026-09-01", "in");
ok("retail is summed over the quoted fills", d1.retail === 100 * 5.5 + 120 * 5.4 && d1.retailFills === 2);
ok("and carries its own gallons and spend", d1.retailGallons === 220 && d1.retailSpend === 1090);
const d2 = bucket("2026-09-02", "in");
ok(
  "a quote with a contract price and no posted price counts toward contract, not retail",
  d2.contractFills === 1 && d2.contract === 110 * 5.1 && d2.retailFills === 0 && d2.retail === 0,
);
ok("so retail spend is 0 there while spend is not — the discount can't be invented", d2.retailSpend === 0 && d2.spend === 562);
const d3 = bucket("2026-09-03", "in");
ok("a fill with no quote in range counts in spend and in neither quoted sum", d3.spend === 495 && d3.retailFills === 0 && d3.contractFills === 0);

// ── 4. filters ──────────────────────────────────────────────────────────────────────────────────
r = (await days({ sites: [PILOT, LOVES, FJ, ONE9] })).map(shape);
ok("a station filter can never match a fill with no station", !r.some((x) => x.network === "unknown"));
r = (await days({ states: ["CA"] })).map(shape);
ok(
  "a state filter reads the FILL's state, so an unknown-station fill in CA is kept",
  bucket("2026-09-02", "unknown")?.spend === 400 && bucket("2026-09-02", "out")?.spend === 480 && r.length === 2,
);
r = (await days({ vehicles: [V1] })).map(shape);
ok("the truck filter keeps only that truck's fuel", r.reduce((s, x) => s + x.spend, 0) === 500 + 110 + 470 + 562 + 400);
r = (await days({ networks: ["out"] })).map(shape);
ok("the network filter keeps only that side", r.every((x) => x.network === "out") && r.length === 2);

// ── 5. org scope fails closed (D-FC1) ───────────────────────────────────────────────────────────
ok("another carrier's fill is never counted", !(await days()).some((x) => Number(x.spend) === 9999));
ok("a caller that names no org gets nothing", (await days({ org: null })).length === 0);
ok("asking for the other carrier returns theirs", (await days({ org: OTHER })).length === 1);

// ── 6. fuel_spend_lines kept its columns; station_id was APPENDED ───────────────────────────────
const cols = (await rows(
  `select unnest(proargnames) n, unnest(proargmodes) m from pg_proc where proname = 'fuel_spend_lines'`,
)).filter((c) => c.m === "t").map((c) => c.n);
ok(
  "every existing reader sees the same columns in the same places, with station_id last",
  JSON.stringify(cols) === JSON.stringify(["tran_date", "brand", "state", "site", "city", "unit", "driver", "tank", "gallons",
    "net_amount", "retail_amount", "contract_amount", "quote_stale_days", "station_id"]),
  JSON.stringify(cols),
);
ok("and there is still exactly one fuel_spend_lines", (await rows(`select oid from pg_proc where proname='fuel_spend_lines'`)).length === 1);

// ── 7. the places, for the state and location menus ────────────────────────────────────────────
await fill("2026-09-04", PILOT, 50, 250, { veh: V2 });
const sites = await rows(`select * from fuel_report_sites(p_from => '2026-09-01', p_to => '2026-09-30', p_org => $1::uuid)`, [ORG]);
const pilotRow = sites.filter((s) => s.station_id === PILOT);
ok("one row per station, however many fills", pilotRow.length === 1 && Number(pilotRow[0].fills) === 4, JSON.stringify(pilotRow));
ok("named by its own city, not the vendor's text", pilotRow[0]?.city === "Amarillo");
const unknownRows = sites.filter((s) => s.station_id == null);
ok(
  "fills with no station come back once per state, so the state menu still holds CA",
  unknownRows.length === 2 && unknownRows.some((s) => s.state === "CA") && unknownRows.some((s) => s.state === "TX"),
);
ok("and with no name, because their free text is not one place", unknownRows.every((s) => s.city == null));
ok("busiest first", Number(sites[0].fills) === Math.max(...sites.map((s) => Number(s.fills))));
ok("another carrier's station is not offered", sites.reduce((s, x) => s + Number(x.fills), 0) === 10);
ok("and no org means no places", (await rows(`select * from fuel_report_sites('2026-09-01','2026-09-30')`)).length === 0);

// ── 8. reachability ────────────────────────────────────────────────────────────────────────────
for (const fn of ["fuel_report_days", "fuel_report_sites", "fuel_spend_lines"]) {
  const g = await rows(`select grantee from information_schema.role_routine_grants where routine_name=$1`, [fn]);
  ok(`${fn}: authenticated may call it, anon may not`, g.some((x) => x.grantee === "authenticated") && !g.some((x) => x.grantee === "anon"));
  const p = await one(`select prosecdef, proconfig from pg_proc where proname=$1`, [fn]);
  ok(`${fn}: security INVOKER, so RLS still scopes a browser`, p.prosecdef === false);
  ok(`${fn}: keeps its SET — it reads tables, once per query`, p.proconfig !== null);
}
ok(
  "the per-row date helper still has NO SET clause (0248's 128x)",
  (await one(`select proconfig from pg_proc where proname='fuel_business_date'`)).proconfig === null,
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
