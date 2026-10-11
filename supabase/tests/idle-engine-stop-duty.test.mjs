// FuelGuard — migration 0407, a park's running time split by duty status (IE3, D-IE4).
//
// What must hold:
//   1. The writer stores the four duty measurements a stop carries, and a stop without them (an
//      ie2-v1 payload, or old code against this schema) stores all four null — "not measured".
//   2. The parts must add up to the stop's running seconds; a split that does not is refused.
//   3. Some-but-not-all present is refused (half a measurement is not a measurement).
//   4. A negative part is refused.
//   5. The writer's grants are unchanged: service role only.
//
// Run: node supabase/tests/idle-engine-stop-duty.test.mjs

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

const stop = (vehicle_id, started_at, ended_at, o = {}) => ({
  vehicle_id, started_at, ended_at, start_observed: true, duration_sec: 3600, running_sec: 3000, off_sec: 600,
  no_data_sec: 0, engine_starts: 1, longest_run_sec: 3000, fuel_ml: 2000, lat: 41.5, lng: -88.1,
  place: "Joliet, IL", state: "IL", ambient_milli_c: 20000, classifier_version: V, ...o,
});
const SPLIT = { running_rest_sec: 1800, running_on_duty_sec: 900, running_excluded_sec: 100, running_unknown_sec: 200 };
const write = (stops) =>
  one(`select idle_engine_write($1, $2::uuid[], $3, $4, $5, '[]'::jsonb, $6::jsonb) r`, [
    ORG, [A], "2026-10-02T04:00:00Z", "2026-10-02T06:00:00Z", TZ, JSON.stringify(stops),
  ]).then((x) => x.r);
const fails = async (name, fn, pattern) => {
  try {
    await fn();
    ok(name, false, "did not raise");
  } catch (e) {
    ok(name, pattern.test(e.message), e.message);
  }
};
const stored = () => one(`select running_rest_sec, running_on_duty_sec, running_excluded_sec, running_unknown_sec from idle_engine_stops where vehicle_id = $1`, [A]);

// ── 1. stored as given; absent → all null ─────────────────────────────────────────────────────
let r = await write([stop(A, "2026-10-02T04:10:00Z", "2026-10-02T05:10:00Z", SPLIT)]);
const s1 = await stored();
ok("the writer stores the four duty measurements a stop carries", r.stops === 1
  && s1.running_rest_sec === 1800 && s1.running_on_duty_sec === 900 && s1.running_excluded_sec === 100 && s1.running_unknown_sec === 200,
  JSON.stringify(s1));
await write([stop(A, "2026-10-02T04:10:00Z", "2026-10-02T05:10:00Z")]);
const s2 = await stored();
ok("a stop without a split (ie2-v1, or old code) stores all four null — not measured, never zero",
  s2.running_rest_sec === null && s2.running_on_duty_sec === null && s2.running_excluded_sec === null && s2.running_unknown_sec === null,
  JSON.stringify(s2));

// ── 2–4. refusals, and a refusal changes nothing ─────────────────────────────────────────────
await write([stop(A, "2026-10-02T04:10:00Z", "2026-10-02T05:10:00Z", SPLIT)]);
await fails("a split that does not add up to the running seconds is refused",
  () => write([stop(A, "2026-10-02T04:10:00Z", "2026-10-02T05:10:00Z", { ...SPLIT, running_unknown_sec: 201 })]), /idle_engine_stops_duty_parts/);
await fails("half a measurement is refused",
  () => write([stop(A, "2026-10-02T04:10:00Z", "2026-10-02T05:10:00Z", { running_rest_sec: 3000 })]), /idle_engine_stops_duty_all_or_none/);
await fails("a negative part is refused",
  () => write([stop(A, "2026-10-02T04:10:00Z", "2026-10-02T05:10:00Z", { ...SPLIT, running_rest_sec: 2100, running_unknown_sec: -100 })]), /idle_engine_stops_duty_nonneg/);
const s3 = await stored();
ok("a refused write leaves the stored split as it was", s3.running_rest_sec === 1800 && s3.running_unknown_sec === 200, JSON.stringify(s3));

// ── 5. grants ────────────────────────────────────────────────────────────────────────────────
const can = async (role) => (await one(
  `select has_function_privilege($1, 'public.idle_engine_write(uuid, uuid[], timestamptz, timestamptz, text, jsonb, jsonb)', 'execute') p`, [role])).p;
ok("the writer is still the service role's alone",
  (await can("service_role")) === true && (await can("authenticated")) === false && (await can("anon")) === false);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
