// FuelGuard — migration 0419, `idle_engine_burn_hours`: what an idling engine burns, on INTERIOR idle
// hours (Q-IE14 research pass, 2026-10-03; the measurement is in the migration's header).
//
// What must hold:
//   1. Each hour lands in the band `idleBurnBand` (packages/shared, the learner's own definition) gives —
//      checked one milli-degree either side of every edge against the IMPORTED helper.
//   2. Only whole idle hours count: stopped running + brief stops = 3600 s, with a fuel delta.
//   3. Only INTERIOR ones: the hour before and the hour after both exist and hold no driving. An idle
//      hour beside a drive, or beside a missing hour, is left out.
//   4. Neighbours are read past the window's ends: the window's first hour is judged by the hour
//      before `from`, and its last by the hour at `to`, though neither is counted.
//   5. Window [from, to); another organisation's hours never appear.
//   6. Service role only.
//
// Run: node supabase/tests/idle-engine-burn-hours.test.mjs

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { IDLE_BURN_BAND_EDGES_MILLI_C, idleBurnBand } from "../../packages/shared/dist/index.js";

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

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 1, 0);
const FROM = new Date(T0).toISOString();
const TO = new Date(T0 + 24 * H).toISOString();

// One hour row. kind: "idle" (3600 s stopped running), "drive" (3600 s driving), "off" (3600 s engine off).
const hour = async (org, vehicle, i, kind, o = {}) => {
  const p = { fuel_ml: 2500, ambient_milli_c: 15_000, ...o };
  const parts = { idle: [0, 3600, 0, 0], drive: [3600, 0, 0, 0], off: [0, 0, 0, 3600], part: [0, 3000, 0, 600] }[kind];
  await db.query(
    `insert into idle_engine_hours (org_id, vehicle_id, hour_start, driving_sec, stopped_running_sec, brief_stop_sec,
       engine_off_sec, no_data_sec, fuel_ml, engine_sec, engine_starts, ambient_milli_c, classifier_version)
     values ($1, $2, $3, $4, $5, $6, $7, 0, $8, null, 0, $9, 'ie3-v3')`,
    [org, vehicle, new Date(T0 + i * H).toISOString(), ...parts, p.fuel_ml, p.ambient_milli_c],
  );
};
const call = (edges = IDLE_BURN_BAND_EDGES_MILLI_C, org = ORG, from = FROM, to = TO) =>
  db.query(`select * from idle_engine_burn_hours($1, $2, $3, $4::int[])`, [org, from, to, edges]).then((r) =>
    r.rows.map((x) => ({ vehicle: x.vehicle_id, band: x.band, hours: x.hours, fuel: Number(x.fuel_ml) })),
  );

// ── 1. bands, against the learner's own helper ──────────────────────────────────────────────────
{
  const probe = await truck(ORG, "probe");
  const readings = [];
  for (const e of IDLE_BURN_BAND_EDGES_MILLI_C) readings.push(e - 1, e);
  readings.push(-30_000, 40_000);
  let agree = true;
  for (const amb of readings) {
    // off · idle (the probed hour) · off: interior, one row.
    await hour(ORG, probe, 0, "off");
    await hour(ORG, probe, 1, "idle", { ambient_milli_c: amb });
    await hour(ORG, probe, 2, "off");
    const got = await call();
    if (got.length !== 1 || got[0].band !== idleBurnBand(amb)) {
      agree = false;
      console.log(`    band mismatch at ${amb}: ${JSON.stringify(got)} vs ${idleBurnBand(amb)}`);
    }
    await db.query(`delete from idle_engine_hours where vehicle_id = $1`, [probe]);
  }
  ok("each hour lands in the band idleBurnBand gives, one milli-degree either side of every edge", agree);
}

// ── 2–5 ───────────────────────────────────────────────────────────────────────────────────────────
const [A, B, C] = [await truck(ORG, "650"), await truck(ORG, "661"), await truck(ORG, "662")].sort();
const X = await truck(OTHER, "650");

// A, hours 2..9: off · idle · idle · idle · drive · idle · idle · off   (hour 2 is "off")
//   hour 3: prev off, next idle                → interior
//   hour 4: prev idle, next idle               → interior
//   hour 5: prev idle, next DRIVE              → left out (departure)
//   hour 7: prev DRIVE                         → left out (arrival)
//   hour 8: prev idle, next off                → interior, but no ambient → band NULL
await hour(ORG, A, 2, "off");
await hour(ORG, A, 3, "idle", { fuel_ml: 2400 });
await hour(ORG, A, 4, "idle", { fuel_ml: 2600 });
await hour(ORG, A, 5, "idle", { fuel_ml: 9000 });
await hour(ORG, A, 6, "drive", { fuel_ml: 90000 });
await hour(ORG, A, 7, "idle", { fuel_ml: 9000 });
await hour(ORG, A, 8, "idle", { fuel_ml: 2000, ambient_milli_c: null });
await hour(ORG, A, 9, "off");
// A, hours 12..14: idle · idle(no fuel) · idle ; hour 16 alone (no neighbours) ; 18..20 off · part · off
await hour(ORG, A, 12, "off");
await hour(ORG, A, 13, "idle", { fuel_ml: null });
await hour(ORG, A, 14, "off");
await hour(ORG, A, 16, "idle", { fuel_ml: 2500 }); // hour 15 missing: its previous row is 14
await hour(ORG, A, 17, "off");
await hour(ORG, A, 18, "off");
await hour(ORG, A, 19, "part", { fuel_ml: 2000 });
await hour(ORG, A, 20, "off");
// B, the window's edges: hour −1 (before FROM) idle, hour 0 idle, hour 1 idle  → hour 0 interior (its
// neighbour before FROM is read), hour −1 not counted. Hours 22, 23 idle and hour 24 (= TO) DRIVE → 23
// out (its neighbour at TO is read), 22 in; hour 24 itself not counted.
await hour(ORG, B, -1, "idle", { fuel_ml: 7777 });
await hour(ORG, B, 0, "idle", { fuel_ml: 2700 });
await hour(ORG, B, 1, "idle", { fuel_ml: 2700 });
await hour(ORG, B, 2, "off");
await hour(ORG, B, 21, "off");
await hour(ORG, B, 22, "idle", { fuel_ml: 2300 });
await hour(ORG, B, 23, "idle", { fuel_ml: 5555 });
await hour(ORG, B, 24, "drive", { fuel_ml: 80000 });
// C: hour 23 idle between two off hours, the later one AT `to` — counted only because that
// neighbour is read past the window's end.
await hour(ORG, C, 22, "off");
await hour(ORG, C, 23, "idle", { fuel_ml: 1500 });
await hour(ORG, C, 24, "off");
// Another org's truck, interior and in the window.
await hour(OTHER, X, 3, "off");
await hour(OTHER, X, 4, "idle", { fuel_ml: 1234 });
await hour(OTHER, X, 5, "off");

const rows = await call();
const key = (r) => `${r.vehicle === A ? "A" : r.vehicle === B ? "B" : r.vehicle === C ? "C" : "?"}:${r.band}:${r.hours}:${r.fuel}`;
ok(
  "interior whole idle hours with a fuel delta, per truck and band; no reading is band NULL, last",
  JSON.stringify(rows.map(key)) === JSON.stringify(["A:2:2:5000", "A:null:1:2000", "B:2:3:7700", "C:2:1:1500"].sort((x, y) => ({ A, B, C })[x[0]].localeCompare(({ A, B, C })[y[0]]))),
  JSON.stringify(rows.map(key)),
);
ok("an idle hour beside a drive is left out, on either side", !rows.some((r) => r.fuel % 9000 === 0 && r.fuel > 0));
ok("an hour with no neighbour, no fuel delta, or not wholly idle is left out", rows.filter((r) => r.vehicle === A).reduce((t, r) => t + r.hours, 0) === 3);
// B: hours 0 and 1 (2,700 each) and 22 (2,300) — not −1 (7,777, before FROM), not 23 (5,555, beside
// the drive at TO), not 24 itself.
const b = rows.find((r) => r.vehicle === B);
ok("neighbours are read past both ends; the hours outside [from, to) are not counted", b?.hours === 3 && b?.fuel === 7700 && rows.find((r) => r.vehicle === C)?.fuel === 1500, JSON.stringify(rows.map(key)));
ok("another organisation's hours never appear", !rows.some((r) => r.vehicle === X) && (await call(IDLE_BURN_BAND_EDGES_MILLI_C, OTHER)).length === 1);

// ── 6. grants ───────────────────────────────────────────────────────────────────────────────────
const can = async (role) =>
  (await one(`select has_function_privilege($1, 'public.idle_engine_burn_hours(uuid, timestamptz, timestamptz, integer[])', 'execute') p`, [role])).p;
ok("the service role's alone", (await can("service_role")) === true && (await can("authenticated")) === false && (await can("anon")) === false);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
