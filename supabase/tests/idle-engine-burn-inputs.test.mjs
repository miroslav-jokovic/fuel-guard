// FuelGuard — migration 0409, `idle_engine_burn_inputs`: what an idling engine burns, per truck and
// ambient band (IE4, D-IE5).
//
// What must hold:
//   1. Each reading lands in the band `idleBurnBand` (packages/shared, the learner's own definition)
//      gives it — checked on and one milli-degree either side of every edge, against the IMPORTED
//      helper, so SQL and TypeScript cannot drift apart without this failing. `packages/shared/dist`
//      is built by `.github/actions/setup` before the matrices job runs.
//   2. Per truck and band, the parks, running seconds and millilitres are summed; a park with no
//      ambient reading is band NULL, ordered last.
//   3. A park without a fuel delta or without running seconds is left out WHOLE — neither its
//      gallons nor its hours reach a sum.
//   4. The window is [from, to): a park starting exactly at `from` is in, one at `to` is out.
//   5. Another organisation's parks never appear.
//   6. The edges are a parameter with no default, and different edges band differently.
//   7. Service role only.
//
// Run: node supabase/tests/idle-engine-burn-inputs.test.mjs

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
    owner uuid,
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
// Ids sorted so the expected order is known: A < B.
const [A, B] = [await truck(ORG, "650"), await truck(ORG, "661")].sort();
const X = await truck(OTHER, "650");

let minute = 0;
const park = async (org, vehicle, o = {}) => {
  const p = { started_at: new Date(Date.UTC(2026, 9, 1, 0, minute++)).toISOString(), running_sec: 1000, fuel_ml: 500, ambient_milli_c: 15_000, ...o };
  await db.query(
    `insert into idle_engine_stops (org_id, vehicle_id, started_at, ended_at, start_observed, duration_sec, running_sec,
       off_sec, no_data_sec, engine_starts, longest_run_sec, fuel_ml, ambient_milli_c, classifier_version)
     values ($1, $2, $3, $3::timestamptz + interval '3 hours', true, 10000, $4, 10000 - $4, 0, 1, $4, $5, $6, 'ie3-v1')`,
    [org, vehicle, p.started_at, p.running_sec, p.fuel_ml, p.ambient_milli_c],
  );
};
const FROM = "2026-10-01T00:00:00Z";
const TO = "2026-10-03T00:00:00Z";
const call = (edges = IDLE_BURN_BAND_EDGES_MILLI_C, org = ORG, from = FROM, to = TO) =>
  db.query(`select * from idle_engine_burn_inputs($1, $2, $3, $4::int[])`, [org, from, to, edges]).then((r) =>
    r.rows.map((x) => ({ vehicle: x.vehicle_id, band: x.band, parks: x.parks, running: Number(x.running_sec), fuel: Number(x.fuel_ml) })));

// ── 1. bands, against the imported helper ────────────────────────────────────────────────────────
// One park per reading on truck B, each alone in its band group only when the helper says so.
const readings = [];
for (const e of IDLE_BURN_BAND_EDGES_MILLI_C) readings.push(e - 1, e, e + 1);
readings.push(-30_000, 45_000);
const probe = await truck(ORG, "probe");
for (const r of readings) {
  await db.query(`delete from idle_engine_stops where vehicle_id = $1`, [probe]);
  await park(ORG, probe, { ambient_milli_c: r });
  const got = (await call()).filter((x) => x.vehicle === probe);
  const want = idleBurnBand(r);
  ok(`a reading of ${r} milli-°C is band ${want}, as idleBurnBand says`, got.length === 1 && got[0].band === want, JSON.stringify(got));
}
await db.query(`delete from idle_engine_stops where vehicle_id = $1`, [probe]);

// ── 2–5. sums, exclusions, window, tenant ────────────────────────────────────────────────────────
// A, band 2 (15 °C): 1,000 s / 500 mL + 2,000 s / 1,300 mL. A, band 3 (25 °C): 3,000 s / 2,100 mL.
// A, no reading: 700 s / 900 mL. B, band 2: 4,000 s / 3,700 mL.
await park(ORG, A, { started_at: FROM });
await park(ORG, A, { running_sec: 2000, fuel_ml: 1300 });
await park(ORG, A, { running_sec: 3000, fuel_ml: 2100, ambient_milli_c: 25_000 });
await park(ORG, A, { running_sec: 700, fuel_ml: 900, ambient_milli_c: null });
await park(ORG, B, { running_sec: 4000, fuel_ml: 3700 });
// Left out: no fuel delta, no running, at `to`, another org.
await park(ORG, A, { running_sec: 5000, fuel_ml: null });
await park(ORG, A, { running_sec: 0, fuel_ml: 800 });
await park(ORG, A, { started_at: TO, running_sec: 6000, fuel_ml: 6000 });
await park(OTHER, X, { running_sec: 9000, fuel_ml: 9000 });

const rows = await call();
const key = (r) => `${r.vehicle === A ? "A" : r.vehicle === B ? "B" : "?"}:${r.band}:${r.parks}:${r.running}:${r.fuel}`;
ok("per truck and band: parks, running seconds and millilitres summed; no reading is band NULL, last",
  JSON.stringify(rows.map(key)) === JSON.stringify(["A:2:2:3000:1800", "A:3:1:3000:2100", "A:null:1:700:900", "B:2:1:4000:3700"]),
  JSON.stringify(rows.map(key)));
const aRows = rows.filter((r) => r.vehicle === A);
ok("a park without a fuel delta or without running seconds reaches neither sum (A: 6,700 s, 4,800 mL)",
  aRows.reduce((t, r) => t + r.running, 0) === 6700 && aRows.reduce((t, r) => t + r.fuel, 0) === 4800);
ok("the window is [from, to): the park at `from` is in, the one at `to` is out",
  rows.find((r) => r.vehicle === A && r.band === 2)?.parks === 2 && !rows.some((r) => r.fuel >= 6000));
ok("another organisation's parks never appear", !rows.some((r) => r.vehicle === X)
  && (await call(IDLE_BURN_BAND_EDGES_MILLI_C, OTHER)).length === 1);

// ── 6. edges are a parameter ────────────────────────────────────────────────────────────────────
const shifted = await call([0, 20_000]);
ok("different edges band differently (15 °C is band 1 under [0, 20000])",
  shifted.find((r) => r.vehicle === A && r.band === 1)?.parks === 2, JSON.stringify(shifted.map(key)));
try {
  await db.query(`select * from idle_engine_burn_inputs($1, $2, $3)`, [ORG, FROM, TO]);
  ok("the edges have no default", false, "three-argument call succeeded");
} catch (e) {
  ok("the edges have no default", /does not exist/.test(e.message), e.message);
}

// ── 7. grants ───────────────────────────────────────────────────────────────────────────────────
const can = async (role) => (await one(
  `select has_function_privilege($1, 'public.idle_engine_burn_inputs(uuid, timestamptz, timestamptz, integer[])', 'execute') p`, [role])).p;
ok("the service role's alone",
  (await can("service_role")) === true && (await can("authenticated")) === false && (await can("anon")) === false);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
