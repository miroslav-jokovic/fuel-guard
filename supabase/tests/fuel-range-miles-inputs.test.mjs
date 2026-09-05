// Silvicom 360 — fuel_range_miles_inputs matrix (migration 0290, FUEL-T3b / D-AG1).
//
// This function is the second implementation of something that already exists, and the only thing that
// makes a second implementation safe is proving it agrees with the first. So this matrix does not
// restate `aggregateWindowOdo` in JavaScript and compare the restatement — it **imports the real one**
// from `packages/shared/dist` — built by `.github/actions/setup`, which is why the matrices job runs
// that action with `build-shared` left on — and asserts the SQL against the actual specification. A
// hand-written expectation here would drift from the TypeScript the day somebody edited it, which is
// the precise failure D-AG1 exists to prevent.
//
// What the SQL has to get right, each of which fails quietly:
//   1. THE MEASUREMENTS, not verdicts. Nothing here may know what ±1 is. `entered_worst_step` is the
//      most negative step between consecutive readings — TypeScript decides whether that is tolerable.
//   2. THE STEP IS OVER NON-NULL READINGS ONLY. A fill with no odometer must not manufacture a step or
//      break the chain across itself; the TypeScript filters nulls out before looking for a regression.
//   3. THE NULL-VEHICLE ROW SURVIVES. Fleet MPG counts fills attributed to no truck (the browser loop's
//      `if (!r.vehicle_id) continue` sits AFTER its MPG accumulation). Dropping that group would change
//      one figure while looking like a tidy-up.
//   4. THE BAND EXCLUDES FROM BOTH SIDES. A fill outside it contributes to neither numerator nor
//      denominator, or the mean is diluted rather than filtered.
//   5. ORG SCOPE, on the call a browser makes (p_org omitted).
//
// Run:  node supabase/tests/fuel-range-miles-inputs.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { aggregateWindowOdo, windowMilesFromAggregate } from "../../packages/shared/dist/index.js";

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
const mkVeh = async (unit) =>
  (await one(`insert into vehicles (org_id, unit_number, status, tank_capacity_gal)
              values ($1,$2,'active',150) returning id`, [ORG, unit])).id;

const MPG_MIN = 1, MPG_MAX = 40;

/**
 * Every truck below is one shape `robustWindowMiles` branches on. The rows are inserted into Postgres
 * AND kept in JS, so the same fixture drives both sides — SQL produces the aggregate, and the imported
 * `aggregateWindowOdo` produces what it should be.
 */
const TRUCKS = [
  { unit: "OBD-ADVANCES", rows: [
    { entered: 1000, samsara: 1000, source: "obd", mpg: 6, gallons: 10 },
    { entered: 1100, samsara: 1100, source: "obd", mpg: 8, gallons: 10 },
  ] },
  { unit: "OBD-FLAT", rows: [
    { entered: 1000, samsara: 500, source: "obd", mpg: 7, gallons: 20 },
    { entered: 1500, samsara: 500, source: "obd", mpg: 7, gallons: 20 },
  ] },
  { unit: "ENTERED-CLEAN", rows: [
    { entered: 2000, samsara: null, source: null, mpg: 5, gallons: 30 },
    { entered: 2100, samsara: null, source: null, mpg: 5, gallons: 30 },
    { entered: 2300, samsara: null, source: null, mpg: 5, gallons: 30 },
  ] },
  { unit: "ENTERED-REGRESSES", rows: [
    { entered: 3000, samsara: null, source: null, mpg: 6, gallons: 15 },
    { entered: 2900, samsara: null, source: null, mpg: 6, gallons: 15 },
    { entered: 3400, samsara: null, source: null, mpg: 6, gallons: 15 },
  ] },
  { unit: "ENTERED-TINY-DIP", rows: [
    { entered: 4000, samsara: null, source: null, mpg: 6, gallons: 12 },
    { entered: 3999.5, samsara: null, source: null, mpg: 6, gallons: 12 },
    { entered: 4400, samsara: null, source: null, mpg: 6, gallons: 12 },
  ] },
  { unit: "ENTERED-WITH-NULLS", rows: [
    { entered: 5000, samsara: null, source: null, mpg: 9, gallons: 11 },
    { entered: null, samsara: null, source: null, mpg: 9, gallons: 11 },
    { entered: 5200, samsara: null, source: null, mpg: 9, gallons: 11 },
  ] },
  { unit: "GPS-NOT-OBD", rows: [
    { entered: 6000, samsara: 6000, source: "gps", mpg: 6, gallons: 14 },
    { entered: 6300, samsara: 6300, source: "gps", mpg: 6, gallons: 14 },
  ] },
  { unit: "OUT-OF-BAND-MPG", rows: [
    { entered: 7000, samsara: null, source: null, mpg: 64, gallons: 100 },
    { entered: 7500, samsara: null, source: null, mpg: 6, gallons: 10 },
  ] },
  { unit: "SINGLE-FILL", rows: [
    { entered: 8000, samsara: 8000, source: "obd", mpg: 6, gallons: 9 },
  ] },
];

const idFor = {};
for (const t of TRUCKS) idFor[t.unit] = await mkVeh(t.unit);

let minute = 0;
const insert = async (vehId, r) => {
  const when = new Date(Date.UTC(2026, 7, 10, 0, minute++, 0)).toISOString();
  await db.query(
    `insert into fuel_transactions (org_id, vehicle_id, fueled_at, business_date, state, gallons,
       odometer, samsara_odometer, samsara_odometer_source, computed_mpg, is_canonical)
     values ($1,$2,$3,'2026-08-10','TX',$4,$5,$6,$7,$8,true)`,
    [ORG, vehId, when, r.gallons, r.entered, r.samsara, r.source, r.mpg],
  );
};
for (const t of TRUCKS) for (const r of t.rows) await insert(idFor[t.unit], r);

// A fill attributed to NO truck. It must still reach fleet MPG.
await db.query(
  `insert into fuel_transactions (org_id, vehicle_id, fueled_at, business_date, state, gallons,
     computed_mpg, is_canonical)
   values ($1,null,'2026-08-10T23:00:00Z','2026-08-10','TX',50,6,true)`, [ORG]);

const call = async (org = ORG) =>
  all(`select * from fuel_range_miles_inputs(
         p_mpg_min => $2, p_mpg_max => $3, p_from => '2026-08-01', p_to => '2026-08-31', p_org => $1)`,
      [org, MPG_MIN, MPG_MAX]);

const rows = await call();
const byVehicle = new Map(rows.map((r) => [r.vehicle_id, r]));
const num = (v) => (v == null ? null : Number(v));

// ── 1. every aggregate matches the imported specification, truck by truck ───────────────────────
let mismatches = [];
for (const t of TRUCKS) {
  const sql = byVehicle.get(idFor[t.unit]);
  const spec = aggregateWindowOdo(
    t.rows.map((r) => ({ enteredOdometer: r.entered, samsaraOdometer: r.samsara, samsaraSource: r.source })),
  );
  const got = {
    obdCount: Number(sql.obd_count), obdMin: num(sql.obd_min), obdMax: num(sql.obd_max),
    enteredCount: Number(sql.entered_count), enteredMin: num(sql.entered_min), enteredMax: num(sql.entered_max),
    enteredWorstStep: num(sql.entered_worst_step),
  };
  if (JSON.stringify(got) !== JSON.stringify(spec)) mismatches.push(`${t.unit}: sql=${JSON.stringify(got)} spec=${JSON.stringify(spec)}`);
}
ok(
  `the SQL aggregate equals aggregateWindowOdo for all ${TRUCKS.length} branch shapes — asserted against the imported function, not a restatement of it`,
  mismatches.length === 0,
  mismatches.join(" | "),
);

// ── 2. and therefore the VERDICT matches too, end to end ────────────────────────────────────────
const milesMismatch = [];
for (const t of TRUCKS) {
  const sql = byVehicle.get(idFor[t.unit]);
  const fromSql = windowMilesFromAggregate({
    obdCount: Number(sql.obd_count), obdMin: num(sql.obd_min), obdMax: num(sql.obd_max),
    enteredCount: Number(sql.entered_count), enteredMin: num(sql.entered_min), enteredMax: num(sql.entered_max),
    enteredWorstStep: num(sql.entered_worst_step),
  });
  const fromRows = windowMilesFromAggregate(aggregateWindowOdo(
    t.rows.map((r) => ({ enteredOdometer: r.entered, samsaraOdometer: r.samsara, samsaraSource: r.source })),
  ));
  if (JSON.stringify(fromSql) !== JSON.stringify(fromRows)) milesMismatch.push(`${t.unit}: ${JSON.stringify(fromSql)} vs ${JSON.stringify(fromRows)}`);
}
ok("…and the miles verdict is identical whichever side produced the aggregate", milesMismatch.length === 0, milesMismatch.join(" | "));

// Spot-check the two that matter most, so a total rewrite of both sides cannot pass silently.
const flat = byVehicle.get(idFor["OBD-FLAT"]);
ok("a flat OBD span measures 0 and is left for TypeScript to suppress — the SQL does not decide it",
  num(flat.obd_max) - num(flat.obd_min) === 0 && Number(flat.obd_count) === 2);
const regress = byVehicle.get(idFor["ENTERED-REGRESSES"]);
ok("a 100-mile backward entry is REPORTED as -100, not judged here",
  num(regress.entered_worst_step) === -100, `${regress.entered_worst_step}`);
const dip = byVehicle.get(idFor["ENTERED-TINY-DIP"]);
ok("a half-mile dip is reported as -0.5, and nothing in the SQL knows that is forgivable",
  num(dip.entered_worst_step) === -0.5, `${dip.entered_worst_step}`);
const clean = byVehicle.get(idFor["ENTERED-CLEAN"]);
ok("a never-decreasing sequence reports 0, not its largest climb",
  num(clean.entered_worst_step) === 0, `${clean.entered_worst_step}`);
const single = byVehicle.get(idFor["SINGLE-FILL"]);
ok("one reading has no step to measure", single.entered_worst_step === null);

// ── 3. the step skips nulls rather than breaking on them ────────────────────────────────────────
const nulls = byVehicle.get(idFor["ENTERED-WITH-NULLS"]);
ok("a fill with no odometer neither manufactures a step nor breaks the chain across itself",
  Number(nulls.entered_count) === 2 && num(nulls.entered_worst_step) === 0 && num(nulls.entered_max) === 5200);

// ── 4. the band excludes from BOTH sides ────────────────────────────────────────────────────────
const band = byVehicle.get(idFor["OUT-OF-BAND-MPG"]);
ok("a 64-mpg fill is excluded from the numerator AND the denominator, so the mean is filtered rather than diluted",
  Number(band.mpg_weighted) === 60 && Number(band.mpg_gallons) === 10);

// ── 5. the null-vehicle row survives, because fleet MPG counts it ───────────────────────────────
const orphan = rows.find((r) => r.vehicle_id === null);
ok("fills attributed to no truck get their own row — dropping them would quietly change fleet MPG",
  orphan != null && Number(orphan.mpg_gallons) === 50 && Number(orphan.mpg_weighted) === 300);
ok("...and that row carries no odometer measurements to mistake for a truck's",
  orphan && Number(orphan.obd_count) === 0 && Number(orphan.entered_count) === 0);

// ── 5b. a SET of trucks (FUEL-P1, migration 0312) ───────────────────────────────────────────────
// Total miles and Avg MPG sit beside four tiles that 0312 also taught to take a truck list. If this
// function had been left behind, those two would have kept answering for the whole fleet under a
// two-truck filter — one card of six describing a different set, which is the shape FUEL-T5 spent a
// migration making visible.
const scoped = async (arg) =>
  all(`select * from fuel_range_miles_inputs(
         p_mpg_min => $2, p_mpg_max => $3, p_from => '2026-08-01', p_to => '2026-08-31',
         p_org => $1, p_vehicles => ${arg})`, [ORG, MPG_MIN, MPG_MAX]);
const pair = await scoped(`array['${idFor[TRUCKS[0].unit]}','${idFor[TRUCKS[1].unit]}']::uuid[]`);
// ⚠ The null-vehicle group is what makes this filter subtle: fleet MPG counts fills that name no
// truck, and this function returns them as their own row for exactly that reason. An implementation
// that kept that row "because MPG needs it" under a truck scope would report gallons from outside the
// selected set — the tile answering for trucks the list is not showing.
ok(
  "a truck list returns only those trucks' rows — and the null-vehicle row is not one of them",
  pair.length === 2 && !pair.some((r) => r.vehicle_id === null),
  `${pair.length} rows`,
);
const justOne = await scoped(`array['${idFor[TRUCKS[0].unit]}']::uuid[]`);
ok(
  "one truck in a list is one truck's row — the same answer the scalar parameter gives",
  justOne.length === 1 && justOne[0].vehicle_id === idFor[TRUCKS[0].unit],
  `${justOne.length} rows`,
);
const noTrucks = await scoped(`'{}'::uuid[]`);
ok(
  "an EMPTY list returns nothing, where an omitted one returns the fleet",
  noTrucks.length === 0 && rows.length > 0,
  `${noTrucks.length} rows`,
);

// ── 6. org scope, including on the call a browser makes ─────────────────────────────────────────
await db.query(
  `insert into fuel_transactions (org_id, fueled_at, business_date, state, gallons, computed_mpg, odometer, is_canonical)
   values ($1,'2026-08-11T12:00:00Z','2026-08-11','TX',900,6,99999,true)`, [OTHER]);
const mine = await call();
ok("another carrier's fills never appear", mine.length === rows.length &&
  !mine.some((r) => Number(r.mpg_gallons) === 900));

const USER = (await one(`insert into auth.users (email) values ('ops@silvicom.test') returning id`)).id;
await db.exec("begin");
await db.exec("set local role authenticated");
await db.query("select set_config('request.jwt.claims', $1, true)", [
  JSON.stringify({ sub: USER, org_id: ORG, user_role: "admin", role: "authenticated" }),
]);
const asBrowser = (await db.query(
  `select * from fuel_range_miles_inputs(p_mpg_min => 1, p_mpg_max => 40,
     p_from => '2026-08-01', p_to => '2026-08-31')`)).rows;
await db.exec("rollback");
ok("a signed-in user gets their own org's rows with p_org omitted — the only call PostgREST can resolve for a browser",
  asBrowser.length === rows.length, `${asBrowser.length} vs ${rows.length}`);

await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
