// FuelGuard — fuel_spend_lines matrix (migrations 0246, 0247).
//
// The function joins each recorded fill to the Pilot quote that applied at that station on that day, so
// "what should this fill have cost, and what did it" can be answered from the EFS feed instead of from a
// hand-uploaded statement.
//
// Four of its properties fail QUIETLY, and each corrupts a different number:
//
//   1. ORG SCOPE. The function is `security invoker`, which scopes a BROWSER by RLS and does nothing at
//      all for `apps/api`, which reads with the service role and bypasses RLS. Before 0247 it took no
//      org to filter on and the server-rendered PDF read every carrier in the database — a test org's
//      fills landed in a real carrier's report. This is the one that must fail CLOSED: no org, no rows.
//   2. THE BUSINESS DATE IS STATION-LOCAL. `fueled_at` is an instant; the vendor bills on the station's
//      local date. Dating by UTC moves 12% of fills onto the wrong day, which both mis-buckets the
//      trend and looks up the wrong day's quote.
//   3. ONE QUOTE PER FILL. A station can carry several price rows for one day: the daily email and the
//      EFS layer are separate sources, and a re-issued report supersedes by observation rather than by
//      deletion. A plain join emits the FILL once per price and double-counts its gallons — inflating
//      the fuel total on a page whose whole claim is that it ties to the bill.
//   4. NO QUOTE IS NULL, NEVER ZERO. Returned as 0 a missing quote reads as "this fill was billed
//      exactly at contract" (or "captured no discount at all") and manufactures a variance out of an
//      upload that never happened. The analyzers drop null rows; they cannot drop zeroes.
//
// Run:  node supabase/tests/fuel-spend-lines.test.mjs
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
    owner uuid, created_at timestamptz default now());
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
const VEH = (await one(`insert into vehicles (org_id,unit_number,tank_capacity_gal) values ($1,'754',150) returning id`, [ORG])).id;

// TX → America/Chicago. 15:00Z is 10:00 local, so the business date is the day named unless a test
// deliberately picks an hour that straddles local midnight.
const fill = (day, gallons, cost, { org = ORG, veh = VEH, at = "15:00:00", state = "TX" } = {}) =>
  db.query(
    `insert into fuel_transactions (org_id, vehicle_id, station_id, fueled_at, gallons, total_cost, state, tank_type, source)
     values ($1,$2,$3,$4::timestamptz,$5,$6,$7,'tractor','import')`,
    [org, veh, ST, `${day}T${at}Z`, gallons, cost, state],
  );
const price = (day, posted, net, { org = ORG, source = "pilot_email", at = "12:00:00" } = {}) =>
  db.query(
    `insert into fuel_prices (org_id, station_id, product, posted_price, net_price, source, observed_at)
     values ($1,$2,'diesel',$3,$4,$5,$6::timestamptz)`,
    [org, ST, posted, net, source, `${day}T${at}Z`],
  );

const call = (from, to, vehicles = null, org = ORG, stale = 1) =>
  rows(
    `select * from fuel_spend_lines(p_from => $1::date, p_to => $2::date, p_vehicles => $3::uuid[],
                                    p_org => $4::uuid, p_max_stale_days => $5)`,
    [from, to, vehicles, org, stale],
  );

// ── 1. the join ──────────────────────────────────────────────────────────────────────────────────
await fill("2026-08-11", 100, 500);
await price("2026-08-11", 5.5, 5.0);
let r = await call("2026-08-01", "2026-08-31");
ok("a fill is joined to the quote that applied that day", r.length === 1 && Number(r[0].retail_amount) === 550);
ok("and carries what it actually cost", Number(r[0].net_amount) === 500 && Number(r[0].gallons) === 100);
ok("and what it SHOULD have cost, from 'Your Price'", Number(r[0].contract_amount) === 500);
ok("with the station's brand, so the policy reports work off the same rows", r[0].brand === "pilot");
ok("and the unit, because a dispatcher speaks in unit numbers", r[0].unit === "754");
ok("and says the quote was same-day rather than carried forward", Number(r[0].quote_stale_days) === 0);

// ── 2. org scope fails CLOSED (D-FC1) ───────────────────────────────────────────────────────────
// The regression this exists for: the PDF report reads with the service role, so RLS is not scoping
// anything, and before 0247 a test org's fills were counted into a real carrier's numbers.
await fill("2026-08-11", 999, 4321, { org: OTHER, veh: null });
ok("another carrier's fill is never returned", (await call("2026-08-01", "2026-08-31")).length === 1);
ok(
  "asking for that carrier returns THEIR fill and not ours",
  (await call("2026-08-01", "2026-08-31", null, OTHER)).length === 1 &&
    Number((await call("2026-08-01", "2026-08-31", null, OTHER))[0].net_amount) === 4321,
);
ok(
  "and a caller that names no org at all gets NOTHING, rather than everything",
  (await rows(`select * from fuel_spend_lines(p_from => '2026-08-01', p_to => '2026-08-31')`)).length === 0,
);

// ── 3. the business date is station-local, not UTC (D-FC2) ──────────────────────────────────────
// 02:00Z on the 13th is 21:00 on the 12th in Texas. EFS bills it to the 12th; dating it by UTC would
// file it under the 13th and then look up the 13th's quote for a fill that happened the day before.
await fill("2026-08-13", 60, 300, { at: "02:00:00" });
ok(
  "an evening fill belongs to the local day it happened on, not the UTC day after",
  (await call("2026-08-12", "2026-08-12")).length === 1,
);
ok("and is absent from the UTC day", (await call("2026-08-13", "2026-08-13")).length === 0);
ok(
  "a window edge therefore catches it too — the instant filter is widened and the date filtered after",
  (await call("2026-08-01", "2026-08-12")).length === 2,
);

// ── 4. one quote per fill, whatever the sources say ─────────────────────────────────────────────
await price("2026-08-11", 9.99, 9.0, { source: "efs", at: "18:00:00" }); // second source, same station-day
r = await call("2026-08-11", "2026-08-11");
ok("a second price for the same station-day does NOT duplicate the fill", r.length === 1, `got ${r.length} rows`);
ok("and the newest observation wins", Number(r[0].retail_amount) === 999, JSON.stringify(r[0].retail_amount));
ok(
  "so the gallons cannot be double-counted by a re-upload",
  Number((await one(
    `select sum(gallons) g from fuel_spend_lines(p_from => '2026-08-11', p_to => '2026-08-11', p_org => $1::uuid)`,
    [ORG],
  )).g) === 100,
);

// ── 5. the quote is resolved as-of, bounded (D-FC4) ─────────────────────────────────────────────
// ⚠ This inverts what the 0246 matrix asserted. Exact-day equality made every Sunday structurally
// unmeasurable — reports exist for 20 of 24 days and all four absentees are Sundays — and priced only
// 80.7% of tractor gallons against the 96.0% the uploads actually cover.
//
// A carried quote is not exact (worst production deviation: $0.0700/gal), and that is not the test it
// has to pass. The test is whether it MANUFACTURES exceptions, and it does not: of 224 carried fills,
// 215 are at contract and NONE is over it, while all 19 overcharges in that window came from same-day
// quotes. Saturday's contract holds on Sunday closely enough to price it, not closely enough to accuse.
await fill("2026-08-20", 80, 420);
await price("2026-08-19", 6.0, 5.25);
r = await call("2026-08-20", "2026-08-20");
ok("yesterday's quote IS carried onto today's fill", r.length === 1 && Number(r[0].contract_amount) === 420);
ok("and the row says so, so a reader can tell a carried quote from a fresh one", Number(r[0].quote_stale_days) === 1);
// The bound has to be shown REFUSING something, or it is not being tested at all: this fill's nearest
// quote is the 19th's, two days back, and an unbounded as-of join would price it against a contract
// that had had two days to move.
await fill("2026-08-21", 70, 360);
r = await call("2026-08-21", "2026-08-21");
ok("but a two-day-old quote is beyond the bound and is not borrowed", r.length === 1 && r[0].contract_amount === null);
ok("leaving the fill unmeasurable rather than mis-measured", r[0].retail_amount === null && Number(r[0].net_amount) === 360);
ok(
  "and widening the bound admits it again, deliberately and by the caller",
  Number((await call("2026-08-21", "2026-08-21", null, ORG, 2))[0].contract_amount) === 367.5,
);

// ── 6. no quote is NULL, never zero (D-FC3) ─────────────────────────────────────────────────────
await fill("2026-09-15", 90, 480); // long after any report
r = await call("2026-09-15", "2026-09-15");
ok("a fill with no quote in range returns NULL contract", r.length === 1 && r[0].contract_amount === null);
ok("and NULL retail with it", r[0].retail_amount === null);
ok("and NOT zero, which would read as billed exactly at contract", r[0].contract_amount !== 0);
ok("while still reporting what it cost", Number(r[0].net_amount) === 480);

// ── 7. the window and the truck filter ──────────────────────────────────────────────────────────
ok("the window is inclusive of its last day", (await call("2026-08-11", "2026-08-11")).length === 1);
ok("and excludes a fill outside it", (await call("2026-08-14", "2026-08-19")).length === 0);
ok("naming the truck keeps its fills", (await call("2026-08-01", "2026-08-11", [VEH])).length === 1);
ok(
  "naming a different truck returns none of them",
  (await call("2026-08-01", "2026-08-31", ["00000000-0000-0000-0000-000000000000"])).length === 0,
);

// ── 8. the zone table matches the one the rollup uses ───────────────────────────────────────────
// `fuel_spend_days` dates fills with `businessDate()` in packages/shared; if these two tables drift the
// same fill lands on different days on two tabs of one page, which is the disagreement 0247 removed.
ok("Texas is Central", (await one(`select fuel_station_tz('TX') tz`)).tz === "America/Chicago");
ok("California is Pacific", (await one(`select fuel_station_tz('ca') tz`)).tz === "America/Los_Angeles");
ok("Arizona does not observe DST", (await one(`select fuel_station_tz('AZ') tz`)).tz === "America/Phoenix");
ok("an unknown state falls back to UTC deterministically", (await one(`select fuel_station_tz('ZZ') tz`)).tz === "UTC");
ok("and so does a null one", (await one(`select fuel_station_tz(null) tz`)).tz === "UTC");

// ── 9. reachability ─────────────────────────────────────────────────────────────────────────────
const grants = await rows(
  `select grantee from information_schema.role_routine_grants where routine_name='fuel_spend_lines'`,
);
ok("authenticated sessions may call it", grants.some((g) => g.grantee === "authenticated"));
ok("anonymous ones may not", !grants.some((g) => g.grantee === "anon"));
ok(
  "and it is security INVOKER, so RLS still decides what a browser sees",
  (await one(`select prosecdef from pg_proc where proname='fuel_spend_lines'`)).prosecdef === false,
);
ok(
  "the unscoped 3-argument form is GONE, not left beside it as a fallback",
  (await rows(`select oid from pg_proc where proname='fuel_spend_lines' and pronargs = 3`)).length === 0,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
