// Silvicom 360 — when a truck was left out of fuel tax (migration 0433, vehicle_fuel_tax_exclusions).
//
// The roster sweep mirrors McLeod's `tractor.exclude_fueltax` into dated periods, and an IFTA quarter
// will one day be computed over them. A second open period for one truck would double-exclude it; a
// period that ends before it starts would exclude nothing while looking like it excluded something.
// Both are refused here, in the database, not only by `recordFuelTaxExclusion`.
//
// Run: node supabase/tests/vehicle-fuel-tax-exclusions.test.mjs
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
const sqlstate = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
};

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text,
    name text, owner uuid, owner_id text, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const truck = async (unit) =>
  (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,$2,240) returning id`, [ORG, unit])).id;
const T512 = await truck("512");
const T718 = await truck("718");
const open = (v, from, source = "mcleod") =>
  sqlstate(`insert into vehicle_fuel_tax_exclusions (org_id, vehicle_id, excluded_from, source) values ($1,$2,$3,$4)`, [ORG, v, from, source]);

ok("an exclusion period opens", (await open(T512, "2026-08-01")) === null);
ok("a second OPEN period for the same truck is refused — it would exclude the truck twice",
  (await open(T512, "2026-09-01")) === "23505");
ok("another truck may be excluded at the same time", (await open(T718, "2026-08-01")) === null);

ok("a period may not end on or before the day it starts",
  (await sqlstate(`update vehicle_fuel_tax_exclusions set excluded_to = '2026-08-01' where vehicle_id = $1`, [T512])) === "23514");
ok("a period closes on a later day",
  (await sqlstate(`update vehicle_fuel_tax_exclusions set excluded_to = '2026-09-15', closed_at = now() where vehicle_id = $1`, [T512])) === null);
ok("once closed, the truck can be excluded again from a later day", (await open(T512, "2026-11-01")) === null);
ok("its history is two periods, not one overwritten",
  (await one(`select count(*)::int n from vehicle_fuel_tax_exclusions where vehicle_id = $1`, [T512])).n === 2);

ok("only 'mcleod' and 'manual' are sources", (await open(await truck("999"), "2026-08-01", "samsara")) === "23514");
ok("deleting a truck takes its periods with it (the truck owns them)",
  (await sqlstate(`delete from vehicles where id = $1`, [T718])) === null &&
  (await one(`select count(*)::int n from vehicle_fuel_tax_exclusions where vehicle_id = $1`, [T718])).n === 0);
ok("row level security is on",
  (await one(`select relrowsecurity r from pg_class where relname = 'vehicle_fuel_tax_exclusions'`)).r === true);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
