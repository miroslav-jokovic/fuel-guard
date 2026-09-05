// FuelGuard — fuel_spend_by_period matrix (migration 0252).
//
// This function exists so the browser stops fetching 13,095 truck-day rows to display 13 weekly
// figures. It is therefore a SECOND place the same sums are computed, and the only thing that makes
// that safe is proving it agrees with the first: `sumSpendDays` in `@fuelguard/shared`, which the
// pure tests already cover and which `periodTotalsFromSums` still derives everything from.
//
// That equivalence is asserted in `packages/shared/src/fuelSpend/spendByPeriodParity.test.ts`, which
// runs BOTH implementations over the same rows and compares them field for field — it lives there
// because a matrix runs under plain `node` and cannot import the TypeScript fold. What this matrix
// covers is the SQL's own contract, four properties of which fail quietly:
//   1. `active_trucks` counts trucks that FUELLED OR DROVE, distinct across the period — not rows.
//      Counting rows moved the real fleet 172 → 166 while it was growing (D-AG2).
//   2. Edges are CLAMPED to the window and flagged `partial`, or a report ending on the 24th prints a
//      row labelled to the 30th (D-AG3).
//   3. `truck_days` excludes the unattributed row, which is fuel with no truck and no engine time.
//   4. Org scope fails closed (D-AG4).
//
// Run:  node supabase/tests/fuel-spend-by-period.test.mjs
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
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;
const V = [];
for (let i = 0; i < 4; i++) {
  V.push((await one(
    `insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,$2,150) returning id`, [ORG, `70${i}`])).id);
}

/** One truck-day, in the shape the rollup writes and the shared fold reads. */
const DAYS = [];
const day = async (org, d, vehicle, o = {}) => {
  const row = {
    fills: 1, gallons_tractor: 100, gallons_reefer: 0, gallons_def: 0,
    spend_tractor: 500, spend_reefer: 0, spend_def: 0,
    miles: 700, mpg_gallons: 100, miles_rejected: 0,
    drive_sec: 28800, idle_sec: 3600, off_sec: 0, coverage_sec: 86400, ...o,
  };
  await db.query(
    `insert into fuel_spend_days (org_id, day, vehicle_id, fills, gallons_tractor, gallons_reefer,
       gallons_def, spend_tractor, spend_reefer, spend_def, miles, mpg_gallons, miles_rejected,
       drive_sec, idle_sec, off_sec, coverage_sec)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [org, d, vehicle, row.fills, row.gallons_tractor, row.gallons_reefer, row.gallons_def,
     row.spend_tractor, row.spend_reefer, row.spend_def, row.miles, row.mpg_gallons,
     row.miles_rejected, row.drive_sec, row.idle_sec, row.off_sec, row.coverage_sec],
  );
  if (org === ORG) {
    DAYS.push({
      day: d, vehicleId: vehicle, fills: row.fills,
      gallonsTractor: row.gallons_tractor, gallonsReefer: row.gallons_reefer, gallonsDef: row.gallons_def,
      spendTractor: row.spend_tractor, spendReefer: row.spend_reefer, spendDef: row.spend_def,
      miles: row.miles, mpgGallons: row.mpg_gallons, milesRejected: row.miles_rejected,
      driveSec: row.drive_sec, idleSec: row.idle_sec, offSec: row.off_sec, coverageSec: row.coverage_sec,
    });
  }
};

// Two full Monday-start weeks. 2026-08-17 is a Monday.
for (const d of ["2026-08-17","2026-08-18","2026-08-19","2026-08-20","2026-08-21","2026-08-22","2026-08-23"]) {
  for (const v of V.slice(0, 3)) await day(ORG, d, v);
}
for (const d of ["2026-08-24","2026-08-25","2026-08-26","2026-08-27","2026-08-28","2026-08-29","2026-08-30"]) {
  for (const v of V.slice(0, 3)) await day(ORG, d, v, { spend_tractor: 600 });
}
// A truck the feed emitted a row for and which did nothing — it must NOT count as active (D-AG2).
await day(ORG, "2026-08-18", V[3], { fills: 0, gallons_tractor: 0, spend_tractor: 0, miles: 0, mpg_gallons: 0, drive_sec: 0 });
// The unattributed row: fuel with no truck behind it, and no engine time to observe.
await day(ORG, "2026-08-19", null, { drive_sec: 0, coverage_sec: 0 });
// Another carrier's week, which must never appear.
await day(OTHER, "2026-08-18", null);

const rows = async (from, to, grain = "week") =>
  await all(`select * from fuel_spend_by_period($1::date,$2::date,$3,null,$4)`, [from, to, grain, ORG]);

// ── 1. it sums what it was given ────────────────────────────────────────────────────────────────
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));
const weeks = await rows("2026-08-17", "2026-08-30");
ok("buckets a fortnight into two Monday-start weeks", weeks.length === 2, JSON.stringify(weeks.map((w) => ymd(w.period_from))));
ok("the first week starts on the Monday", ymd(weeks[0].period_from) === "2026-08-17");

// 3 trucks x 7 days x 100 gal, plus the unattributed row's 100.
ok("sums the gallons over the bucket", Number(weeks[0].gallons_tractor) === 2200, `got ${weeks[0].gallons_tractor}`);
ok("sums the spend", Number(weeks[0].spend_tractor) === 11000, `got ${weeks[0].spend_tractor}`);
ok("counts the days it covered", Number(weeks[0].days) === 7);
ok("the second week carries its own rate", Number(weeks[1].spend_tractor) === 12600, `got ${weeks[1].spend_tractor}`);

// ── 2. active trucks (D-AG2) ────────────────────────────────────────────────────────────────────
ok("a truck that only had a row — no fuel, no driving — is not active",
  Number(weeks[0].active_trucks) === 3, `got ${weeks[0].active_trucks}`);
ok("and it is still counted as an observable truck-day", Number(weeks[0].truck_days) === 22,
  `got ${weeks[0].truck_days}`);
ok("the unattributed row is not a truck-day — no truck, nothing to observe",
  Number(weeks[0].truck_days) === DAYS.filter((d) => d.day >= "2026-08-17" && d.day <= "2026-08-23" && d.vehicleId).length);

// ── 3. clamped edges (D-AG3) ────────────────────────────────────────────────────────────────────
const cut = await rows("2026-08-19", "2026-08-26");
ok("a window opening mid-week reports the days it holds, not the calendar week",
  ymd(cut[0].period_from) === "2026-08-19" && ymd(cut[0].period_to) === "2026-08-23", JSON.stringify(cut[0]));
ok("and says the bucket was cut", cut[0].partial === true);
ok("the closing bucket is clamped too", ymd(cut[1].period_to) === "2026-08-26" && cut[1].partial === true);
const whole = await rows("2026-08-17", "2026-08-23");
ok("a bucket that fits the window exactly is not partial", whole[0].partial === false);

// ── 4. grains ───────────────────────────────────────────────────────────────────────────────────
// The whole window as one bucket: what the tiles fall back to when two complete periods do not exist.
const win = await rows("2026-08-17", "2026-08-30", "window");
ok("window grain gives exactly one row spanning the request",
  win.length === 1 && ymd(win[0].period_from) === "2026-08-17" && ymd(win[0].period_to) === "2026-08-30",
  JSON.stringify(win.map((w) => `${ymd(w.period_from)}→${ymd(w.period_to)}`)));
ok("and counts a truck working both weeks ONCE, not once per week",
  Number(win[0].active_trucks) === 3, `got ${win[0].active_trucks}`);
ok("while summing across both", Number(win[0].spend_tractor) === 23600, `got ${win[0].spend_tractor}`);

ok("day grain gives one row per day", (await rows("2026-08-17", "2026-08-19", "day")).length === 3);
const months = await rows("2026-08-01", "2026-09-30", "month");
// One row: all the data is in August. It is labelled from the 1st because that is where the bucket
// starts and the window opens there too — September has no rows, so it produces no bucket at all.
ok("month grain gives one row per month that has data",
  months.length === 1 && ymd(months[0].period_from) === "2026-08-01",
  JSON.stringify(months.map((m) => `${ymd(m.period_from)}→${ymd(m.period_to)}`)));
ok("and clamps its end to the window rather than to the calendar month",
  ymd(months[0].period_to) === "2026-08-31" && months[0].partial === false, JSON.stringify(months[0]));

// ── 5. scope (D-AG4) ────────────────────────────────────────────────────────────────────────────
const theirs = await all(`select * from fuel_spend_by_period('2026-08-17'::date,'2026-08-30'::date,'week',null,$1)`, [OTHER]);
ok("another carrier sees only their own", theirs.length === 1 && Number(theirs[0].fills) === 1);
const nobody = await all(`select * from fuel_spend_by_period('2026-08-17'::date,'2026-08-30'::date,'week',null,null)`);
ok("no org means no rows — it fails closed", nobody.length === 0);
const oneTruck = await all(`select * from fuel_spend_by_period($1::date,$2::date,'week',$3,$4)`,
  ["2026-08-17", "2026-08-23", [V[0]], ORG]);
ok("narrowing to one truck narrows the sums", Number(oneTruck[0].active_trucks) === 1 && Number(oneTruck[0].fills) === 7);

await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
