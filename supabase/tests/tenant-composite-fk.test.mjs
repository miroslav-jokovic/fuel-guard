// Silvicom 360 — tenant-composite foreign keys matrix (migration 0434, DATABASE-AUDIT Q-DA5).
//
// A fuel transaction must point at a truck and a driver of its OWN organisation. The single-column
// keys (`vehicle_id → vehicles.id`, `driver_id → drivers.id`) only prove the row exists somewhere.
// The API writes with the service role, which bypasses RLS, so before 0434 nothing in the database
// stopped a fill of org A naming org B's truck. Measured on production 2026-10-05: 0 such rows today
// (all 180 smaller tenant FKs scanned in full, the two largest sampled at 1%); this is prevention.
//
//   1. SAME-ORG LINKS STILL WORK — a fill naming its own org's truck and driver inserts.
//   2. A CROSS-ORG TRUCK IS REFUSED — 23503, whoever writes it.
//   3. A CROSS-ORG DRIVER IS REFUSED — the same.
//   4. NULL STAYS ALLOWED — an unattributed fill (no truck, no driver) still inserts.
//   5. A TRUCK CANNOT MOVE ORGS UNDER ITS FILLS — updating a referenced vehicle's org_id is refused.
//
// Run:  node supabase/tests/tenant-composite-fk.test.mjs
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
    bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now()
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

for (const f of MIGRATIONS) {
  try { await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, "")); }
  catch (e) { console.error(`migration ${f} failed: ${e.message}`); process.exit(1); }
}

console.log("\n---- Matrix: mcleod-gl-day-replace -------------------------------");

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
await db.query(`insert into organizations (id, name) values ($1,'Carrier A'), ($2,'Carrier B')`, [ORG_A, ORG_B]);
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const vA = (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,'A1',150) returning id`, [ORG_A])).id;
const vB = (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,'B1',150) returning id`, [ORG_B])).id;
const dA = (await one(`insert into drivers (org_id, full_name) values ($1,'Ann A') returning id`, [ORG_A])).id;
const dB = (await one(`insert into drivers (org_id, full_name) values ($1,'Bob B') returning id`, [ORG_B])).id;

const fill = (org, vehicle, driver) =>
  db.query(
    `insert into fuel_transactions (org_id, fueled_at, gallons, vehicle_id, driver_id) values ($1, now(), 100, $2, $3)`,
    [org, vehicle, driver],
  ).then(() => "ok", (e) => e.code ?? e.message);

console.log("\n---- Matrix: tenant-composite-fk ----------------------------------");
ok("a fill naming its own org's truck and driver inserts", (await fill(ORG_A, vA, dA)) === "ok");
const crossTruck = await fill(ORG_A, vB, dA);
ok("a fill naming another org's truck is refused (23503)", crossTruck === "23503", crossTruck);
const crossDriver = await fill(ORG_A, vA, dB);
ok("a fill naming another org's driver is refused (23503)", crossDriver === "23503", crossDriver);
ok("an unattributed fill still inserts", (await fill(ORG_A, null, null)) === "ok");
const moved = await db.query(`update vehicles set org_id = $1 where id = $2`, [ORG_B, vA]).then(() => "ok", (e) => e.code ?? e.message);
ok("a referenced truck cannot move to another org under its fills (an existing trigger already refuses it)", moved !== "ok", moved);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
