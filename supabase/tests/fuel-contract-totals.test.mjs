// fuel_contract_totals (0418) — the four sums behind Buy discipline's "Paid vs Pilot quote" tile (Q-FSV18).
//
// The tile used to download every `fuel_spend_lines` row to add them up in the browser, nine seconds on
// production. This function adds them where they live. It decides nothing — whether a fill was OVER contract
// (the per-gallon tolerance) is `analyzeContractCapture`'s — so what is asserted is the arithmetic and the
// edges where a wrong sum reads as a plausible tile:
//
//   1. IT AGREES WITH THE ROWS IT SUMMARISES. The ruler is `fuel_spend_lines` read raw and summed in this
//      file by the TS rules (measured = carries a quote), not a second SQL query by the same author.
//   2. NULL IS NOT ZERO. A fill with no quote is UNMEASURED: it adds to `unmeasured_paid` and nothing else.
//      Counted as measured with expected 0, every unquoted dollar would become a variance.
//   3. THE FILTER IS `isInScope`'S. Reefer, zero-gallon and no-cost fills are not fuel the tile speaks for.
//   4. ALWAYS ONE ROW, zeros over an empty window, so the page can tell "nothing measured" from "failed".
//   5. SCOPE FAILS CLOSED. No org, zeros (D-FC1, 0247); another carrier's fills never appear.
//
// Run:  node supabase/tests/fuel-contract-totals.test.mjs
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
const ST = (await one(`insert into fuel_stations (brand,store_number,name,lat,lng,state,city)
  values ('pilot','436','Pilot #436',35,-101,'TX','Amarillo') returning id`)).id;
const ST2 = (await one(`insert into fuel_stations (brand,store_number,name,lat,lng,state,city)
  values ('loves','210','Love''s #210',35,-111,'AZ','Flagstaff') returning id`)).id;
const VEH = (await one(`insert into vehicles (org_id,unit_number,tank_capacity_gal) values ($1,'754',150) returning id`, [ORG])).id;
const VEH2 = (await one(`insert into vehicles (org_id,unit_number,tank_capacity_gal) values ($1,'755',150) returning id`, [ORG])).id;

const fill = (day, gallons, cost, o = {}) => {
  const { org = ORG, veh = VEH, st = ST, at = "15:00:00", state = "TX", tank = "tractor" } = o;
  return db.query(
    `insert into fuel_transactions (org_id, vehicle_id, station_id, fueled_at, gallons, total_cost, state, tank_type, source)
     values ($1,$2,$3,$4::timestamptz,$5,$6,$7,$8,'import')`,
    [org, veh, st, `${day}T${at}Z`, gallons, cost, state, tank],
  );
};
const price = (day, posted, net, { org = ORG, st = ST } = {}) =>
  db.query(
    `insert into fuel_prices (org_id, station_id, product, posted_price, net_price, source, observed_at)
     values ($1,$2,'diesel',$3,$4,'pilot_email',$5::timestamptz)`,
    [org, st, posted, net, `${day}T12:00:00Z`],
  );
const tot = async (from, to, vehicles = null, org = ORG) =>
  (await rows(
    `select * from fuel_contract_totals(p_from => $1::date, p_to => $2::date, p_vehicles => $3::uuid[], p_org => $4::uuid)`,
    [from, to, vehicles, org],
  ));
const n = (v) => Number(v);
// The ruler: raw rows, the TS rules (`isInScope`, `isMeasurable`) written out here, summed in JS.
const ruler = async (from, to, org = ORG) => {
  const raw = (await rows(`select * from fuel_spend_lines(p_from => $1::date, p_to => $2::date, p_org => $3::uuid)`, [from, to, org]))
    .filter((x) => x.tank === "tractor" && n(x.gallons) > 0 && x.net_amount != null);
  const m = raw.filter((x) => x.contract_amount != null);
  const u = raw.filter((x) => x.contract_amount == null);
  const sum = (a, f) => a.reduce((s, x) => s + n(f(x)), 0);
  return {
    ml: m.length, mg: sum(m, (x) => x.gallons), mp: sum(m, (x) => x.net_amount), me: sum(m, (x) => x.contract_amount),
    ul: u.length, up: sum(u, (x) => x.net_amount),
  };
};
const close = (a, b) => Math.abs(a - b) < 1e-6;

// ── 1. the sums, checked against the raw rows ───────────────────────────────────────────────────
await price("2026-08-10", 5.5, 5.0);               // quote for the Texas station on the 10th
await price("2026-08-12", 5.6, 5.1, { st: ST2 });  // and for the Arizona one on the 12th
await fill("2026-08-10", 100, 520);                // quoted, billed ABOVE contract (expected 500)
await fill("2026-08-12", 60, 300, { st: ST2, state: "AZ" }); // quoted, billed BELOW contract (expected 306)
await fill("2026-08-20", 80, 440);                 // no quote that day: unmeasured
await fill("2026-08-21", 40, 230, { st: null, state: "NM" }); // no station, so no quote: unmeasured

const t1 = (await tot("2026-08-01", "2026-08-31"))[0];
ok("measured fills are the ones that carry a quote", t1.measured_lines === 2, JSON.stringify(t1));
ok("what EFS billed on them is summed", close(n(t1.measured_paid), 820));
ok("and what they should have cost, from 'Your Price'", close(n(t1.measured_expected), 806));
ok("and their gallons", close(n(t1.measured_gallons), 160));
ok("a fill with no quote is counted as unmeasured", t1.unmeasured_lines === 2);
ok("and only its billed dollars are carried, as the rest of the denominator", close(n(t1.unmeasured_paid), 670));
ok("net variance is paid minus expected, so over and under offset", close(n(t1.measured_paid) - n(t1.measured_expected), 14));

const r1 = await ruler("2026-08-01", "2026-08-31");
ok(
  "every figure equals the raw rows summed independently",
  t1.measured_lines === r1.ml && t1.unmeasured_lines === r1.ul && close(n(t1.measured_paid), r1.mp) &&
    close(n(t1.measured_expected), r1.me) && close(n(t1.measured_gallons), r1.mg) && close(n(t1.unmeasured_paid), r1.up),
  JSON.stringify([t1, r1]),
);

// ── 2. null is not zero ────────────────────────────────────────────────────────────────────────
ok("an unquoted dollar is NOT a variance: expected is only the quoted fills' contract amounts", close(n(t1.measured_expected), 806));
ok("and measured lines are not inflated by the unquoted ones", t1.measured_lines !== 4);

// ── 3. the filter is isInScope's ───────────────────────────────────────────────────────────────
await fill("2026-08-14", 30, 150, { tank: "reefer" });
await fill("2026-08-15", 0, 0);
await fill("2026-08-16", 25, null);
const t3 = (await tot("2026-08-01", "2026-08-31"))[0];
ok("a reefer fill adds nothing", t3.measured_lines === 2 && t3.unmeasured_lines === 2);
ok("nor do a zero-gallon fill and a fill with no cost", close(n(t3.unmeasured_paid), 670) && close(n(t3.measured_paid), 820));

// ── 4. always one row ──────────────────────────────────────────────────────────────────────────
const empty = await tot("2026-01-01", "2026-01-31");
ok("a window with no fuel still returns exactly one row", empty.length === 1);
ok(
  "and it is zeros, never null",
  // `Number(null)` is 0, so the null check has to come first or a null sails through as a zero.
  Object.values(empty[0]).every((v) => v !== null) &&
    empty[0].measured_lines === 0 && empty[0].unmeasured_lines === 0 && n(empty[0].measured_paid) === 0 &&
    n(empty[0].measured_expected) === 0 && n(empty[0].unmeasured_paid) === 0 && n(empty[0].measured_gallons) === 0,
  JSON.stringify(empty[0]),
);

// ── 5. scope fails closed ──────────────────────────────────────────────────────────────────────
await fill("2026-08-10", 999, 4321, { org: OTHER, veh: null });
const t5 = (await tot("2026-08-01", "2026-08-31"))[0];
ok("another carrier's fill never appears", close(n(t5.unmeasured_paid), 670) && t5.unmeasured_lines === 2);
const theirs = (await tot("2026-08-01", "2026-08-31", null, OTHER))[0];
ok("asking for that carrier returns THEIR fill and not ours", theirs.unmeasured_lines === 1 && close(n(theirs.unmeasured_paid), 4321));
const none = await rows(`select * from fuel_contract_totals(p_from => '2026-08-01', p_to => '2026-08-31')`);
ok("a caller that names no org gets zeros, not everything", none.length === 1 && none[0].measured_lines === 0 && none[0].unmeasured_lines === 0);

// ── 6. the truck filter and the window ─────────────────────────────────────────────────────────
await fill("2026-08-22", 50, 275, { veh: VEH2 });
const only2 = (await tot("2026-08-01", "2026-08-31", [VEH2]))[0];
ok("naming a truck keeps only its fills", only2.unmeasured_lines === 1 && close(n(only2.unmeasured_paid), 275) && only2.measured_lines === 0);
const day = (await tot("2026-08-10", "2026-08-10"))[0];
ok("the window's last day is inclusive", day.measured_lines === 1 && close(n(day.measured_paid), 520));

// ── 7. who may call it ─────────────────────────────────────────────────────────────────────────
const can = async (role) =>
  (await one(`select has_function_privilege($1, 'fuel_contract_totals(date, date, uuid[], uuid)', 'execute') as ok`, [role])).ok;
ok("a signed-in browser may call it (supabase.rpc)", (await can("authenticated")) === true);
ok("the API's service role may call it", (await can("service_role")) === true);
ok("an anonymous caller may not", (await can("anon")) === false);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
