// FuelGuard — migration 0404, the idle engine's hour / stop / day tables and their one writer
// (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md IE2; D-IE3, D-IE8, Q-IE8).
//
// Every migration is applied, two trucks of the carrier and one of another organisation are seeded,
// then `idle_engine_write` is driven through the cases the collector will hit. What must hold:
//
//   1. A write stores exactly its payload and says how much.
//   2. Day rows are derived from the hour rows on the org's LOCAL day (an hour belongs to the day its
//      start falls in), with fuel and engine-seconds summed over the hours that had a delta, counted.
//   3. Replacing a window makes it equal the payload: hours outside it, other trucks and stops wholly
//      before it survive; a stop overlapping it is replaced, never duplicated; a touched day is
//      re-derived from ALL its stored hours.
//   4. An empty payload for a truck empties its window.
//   5. Refusals — a row outside the window or its trucks, another org's truck, an unaligned or empty
//      window, an unknown zone, buckets that are not a whole hour, stop parts that are not its
//      duration — raise, and change nothing.
//   6. The writer is the service role's alone; the tables have RLS and no client policy.
//
// Run: node supabase/tests/idle-engine-tables.test.mjs

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const ALL = readdirSync(join(SUPA, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];

// Supabase-managed schemas, shimmed identically to rls.test.mjs.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key,
    name text,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner uuid,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text,
    name text,
    owner uuid, owner_id text,
    created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (
    version text primary key,
    name text,
    statements text[]
  );
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);

for (const f of ALL) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}


const ORG = "86d6b3ea-4361-4f71-877f-e8373615769b";
await db.query(`insert into organizations (id, name) values ($1, 'Silvicom')`, [ORG]);
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const truck = async (org, unit) =>
  (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1, $2, 200) returning id`, [org, unit])).id;
const A = await truck(ORG, "650");
const B = await truck(ORG, "661");
const X = await truck(OTHER, "650");
const TZ = "America/Chicago";
const V = "ie2-test";

// An hour row: bucket seconds default to the whole hour engine-off.
const hour = (vehicle_id, hour_start, o = {}) => ({
  vehicle_id, hour_start, driving_sec: 0, stopped_running_sec: 0, brief_stop_sec: 0, engine_off_sec: 3600,
  no_data_sec: 0, fuel_ml: 0, engine_sec: 0, engine_starts: 0, ambient_milli_c: 20000, classifier_version: V, ...o,
});
const stop = (vehicle_id, started_at, ended_at, o = {}) => ({
  vehicle_id, started_at, ended_at, start_observed: true, duration_sec: 600, running_sec: 600, off_sec: 0,
  no_data_sec: 0, engine_starts: 0, longest_run_sec: 600, fuel_ml: 500, lat: 41.5, lng: -88.1,
  place: "Joliet, IL", state: "IL", ambient_milli_c: 20000, classifier_version: V, ...o,
});
const write = (vehicles, from, to, hours, stops, org = ORG, tz = TZ) =>
  one(`select idle_engine_write($1, $2::uuid[], $3, $4, $5, $6::jsonb, $7::jsonb) r`, [
    org, vehicles, from, to, tz, JSON.stringify(hours), JSON.stringify(stops),
  ]).then((x) => x.r);
const fails = async (name, fn, pattern) => {
  try {
    await fn();
    ok(name, false, "did not raise");
  } catch (e) {
    ok(name, pattern.test(e.message), e.message);
  }
};
const num = async (q, p = []) => Number((await one(q, p)).n);
const hoursOf = async (v) =>
  (await db.query(`select hour_start, driving_sec, fuel_ml from idle_engine_hours where vehicle_id = $1 order by hour_start`, [v])).rows;

// ── 1. the first write: three hours that straddle Chicago's midnight (05:00Z = 00:00 CDT) ──────
// 03:00Z and 04:00Z belong to 10/01 local, 05:00Z to 10/02.
let r = await write([A, B], "2026-10-02T03:00:00Z", "2026-10-02T06:00:00Z", [
  hour(A, "2026-10-02T03:00:00Z", { driving_sec: 3000, engine_off_sec: 600, fuel_ml: 30000, engine_sec: 3000 }),
  hour(A, "2026-10-02T04:00:00Z", { stopped_running_sec: 3600, engine_off_sec: 0, fuel_ml: null, engine_sec: 3600, engine_starts: 1 }),
  hour(A, "2026-10-02T05:00:00Z", { driving_sec: 1800, engine_off_sec: 1800, fuel_ml: 9000, engine_sec: 1800 }),
  hour(B, "2026-10-02T03:00:00Z"),
  hour(B, "2026-10-02T04:00:00Z"),
  hour(B, "2026-10-02T05:00:00Z", { engine_off_sec: 0, no_data_sec: 3600, fuel_ml: null, engine_sec: null }),
], [
  stop(A, "2026-10-02T03:50:00Z", "2026-10-02T05:10:00Z", { duration_sec: 4800, running_sec: 4200, off_sec: 600, longest_run_sec: 4200, engine_starts: 1 }),
]);
ok("the writer reports what it wrote", r.hours === 6 && r.stops === 1 && r.days === 4, JSON.stringify(r));

// ── 2. days are derived from the hours, on the org's local day ─────────────────────────────────
const day = (v, d) => one(`select * from idle_engine_days where vehicle_id = $1 and day = $2`, [v, d]);
const d1 = await day(A, "2026-10-01");
ok("an hour before local midnight belongs to the local day before (2 hours on 10/01)", d1?.hours === 2 && d1.driving_sec === 3000 && d1.stopped_running_sec === 3600, JSON.stringify(d1));
ok("a day's fuel sums only the hours that had a delta, and counts them", Number(d1?.fuel_ml) === 30000 && d1.fuel_hours === 1 && Number(d1.engine_sec) === 6600 && d1.engine_sec_hours === 2, JSON.stringify(d1));
ok("…and carries the zone it was cut on", d1?.tz === TZ);
const d2 = await day(A, "2026-10-02");
ok("the hour after local midnight is 10/02's", d2?.hours === 1 && d2.driving_sec === 1800, JSON.stringify(d2));
const b2 = await day(B, "2026-10-02");
ok("a no-data hour is a no-data hour on the day, never off", b2?.no_data_sec === 3600 && b2.engine_off_sec === 0 && b2.fuel_hours === 0 && Number(b2.fuel_ml) === 0, JSON.stringify(b2));

// ── 3. replacing a window makes it EQUAL the payload, and touches nothing else ────────────────
// An unrelated stop of B's entirely before the window, and an earlier hour of A's.
await write([A, B], "2026-10-02T01:00:00Z", "2026-10-02T02:00:00Z", [
  hour(A, "2026-10-02T01:00:00Z", { fuel_ml: 111 }),
  hour(B, "2026-10-02T01:00:00Z"),
], [stop(B, "2026-10-02T01:10:00Z", "2026-10-02T01:40:00Z", { duration_sec: 1800, running_sec: 1800, longest_run_sec: 1800 })]);
// Re-run the 04:00–06:00 part of the first window with a corrected picture for A only.
r = await write([A], "2026-10-02T04:00:00Z", "2026-10-02T06:00:00Z", [
  hour(A, "2026-10-02T04:00:00Z", { stopped_running_sec: 1800, engine_off_sec: 1800, fuel_ml: 4000 }),
  hour(A, "2026-10-02T05:00:00Z", { fuel_ml: 0 }),
], [
  // a late gateway moved the stop's start: the old row must not survive beside it
  stop(A, "2026-10-02T03:55:00Z", null, { duration_sec: 3900, running_sec: 1800, off_sec: 2100, longest_run_sec: 1800 }),
]);
const ah = await hoursOf(A);
ok("the window holds exactly the payload, and the hours outside it are untouched",
  ah.length === 4 && ah[0].fuel_ml === 111 && ah[1].driving_sec === 3000 && ah[2].fuel_ml === 4000 && ah[3].driving_sec === 0,
  JSON.stringify(ah));
const as = (await db.query(`select started_at, ended_at from idle_engine_stops where vehicle_id = $1`, [A])).rows;
ok("a stop overlapping the window is replaced, not duplicated (moved start, now open)",
  as.length === 1 && new Date(as[0].started_at).toISOString() === "2026-10-02T03:55:00.000Z" && as[0].ended_at === null,
  JSON.stringify(as));
ok("a stop wholly before the window survives", (await num(`select count(*) n from idle_engine_stops where vehicle_id = $1`, [B])) === 1);
ok("another truck's hours in the same window survive", (await num(`select count(*) n from idle_engine_hours where vehicle_id = $1 and hour_start >= '2026-10-02T03:00Z'`, [B])) === 3);
const d1b = await day(A, "2026-10-01");
ok("a re-written day is re-derived from ALL its stored hours, inside and outside the window",
  d1b?.hours === 3 && d1b.stopped_running_sec === 1800 && Number(d1b.fuel_ml) === 30000 + 4000 + 111 && d1b.fuel_hours === 3,
  JSON.stringify(d1b));

// ── 4. an empty payload for a truck clears its window (the replace is total) ──────────────────
await write([B], "2026-10-02T03:00:00Z", "2026-10-02T04:00:00Z", [], []);
ok("an empty payload empties the window for that truck",
  (await num(`select count(*) n from idle_engine_hours where vehicle_id = $1 and hour_start = '2026-10-02T03:00Z'`, [B])) === 0);

// ── 5. refusals, and a refusal changes nothing ─────────────────────────────────────────────────
const before = await num(`select count(*) n from idle_engine_hours`);
await fails("an hour row outside the window is refused", () =>
  write([A], "2026-10-02T04:00:00Z", "2026-10-02T05:00:00Z", [hour(A, "2026-10-02T05:00:00Z")], []), /outside the window/);
await fails("an hour row of a truck not in the set is refused", () =>
  write([A], "2026-10-02T04:00:00Z", "2026-10-02T05:00:00Z", [hour(B, "2026-10-02T04:00:00Z")], []), /outside the window/);
await fails("a stop that does not overlap the window is refused", () =>
  write([A], "2026-10-02T04:00:00Z", "2026-10-02T05:00:00Z", [], [stop(A, "2026-10-02T03:00:00Z", "2026-10-02T03:30:00Z")]), /do not overlap/);
await fails("a stop ending exactly at the window start does not overlap it", () =>
  write([A], "2026-10-02T04:00:00Z", "2026-10-02T05:00:00Z", [], [stop(A, "2026-10-02T03:50:00Z", "2026-10-02T04:00:00Z")]), /do not overlap/);
await fails("another organisation's truck is refused", () =>
  write([A, X], "2026-10-02T04:00:00Z", "2026-10-02T05:00:00Z", [], []), /not this org/);
await fails("a window that does not start on the hour is refused", () =>
  write([A], "2026-10-02T04:30:00Z", "2026-10-02T05:00:00Z", [], []), /on the hour/);
await fails("an empty window is refused", () =>
  write([A], "2026-10-02T04:00:00Z", "2026-10-02T04:00:00Z", [], []), /from < to/);
await fails("an unknown zone is refused", () =>
  write([A], "2026-10-02T04:00:00Z", "2026-10-02T05:00:00Z", [], [], ORG, "America/Nowhere"), /time zone/);
await fails("an hour whose buckets do not add up to 3,600 s is refused", () =>
  write([A], "2026-10-02T04:00:00Z", "2026-10-02T05:00:00Z", [hour(A, "2026-10-02T04:00:00Z", { engine_off_sec: 3599 })], []), /whole_hour/);
await fails("a stop whose parts do not add up to its duration is refused", () =>
  write([A], "2026-10-02T04:00:00Z", "2026-10-02T05:00:00Z", [], [stop(A, "2026-10-02T04:10:00Z", null, { off_sec: 1 })]), /parts/);
await fails("a longest run longer than the running time is refused", () =>
  write([A], "2026-10-02T04:00:00Z", "2026-10-02T05:00:00Z", [], [stop(A, "2026-10-02T04:10:00Z", null, { longest_run_sec: 601 })]), /longest/);
ok("…and a refused write deleted nothing", (await num(`select count(*) n from idle_engine_hours`)) === before);

// ── 6. who may call it, and who may read ───────────────────────────────────────────────────────
const grants = await one(`
  select has_function_privilege('authenticated', p.oid, 'execute') auth,
         has_function_privilege('anon', p.oid, 'execute') anon,
         has_function_privilege('service_role', p.oid, 'execute') svc
    from pg_proc p where p.proname = 'idle_engine_write'`);
ok("the writer is callable by the service role only", grants.svc === true && grants.auth === false && grants.anon === false, JSON.stringify(grants));
const rls = (await db.query(`
  select c.relname, c.relrowsecurity, (select count(*)::int from pg_policies p where p.tablename = c.relname) policies
    from pg_class c where c.relname in ('idle_engine_hours', 'idle_engine_stops', 'idle_engine_days') order by 1`)).rows;
ok("all three tables have RLS on and no client policy", rls.length === 3 && rls.every((t) => t.relrowsecurity && t.policies === 0), JSON.stringify(rls));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
