// Silvicom 360 — a McLeod load's customer name, raw and core (migrations 0383 raw and 0384 core,
// LOADS-MIRROR-PLAN.md Q-LMR5).
//
// Schema only, so what can be wrong is the SHAPE:
//
//   · MISSING IS NULL. Both columns are nullable with no default, so the 303 loads production
//     already holds read null until McLeod is asked, rather than a name nobody stated.
//   · THE CODE STAYS. `customer_code` is the key McLeod joins on; the name sits beside it, and adding
//     it changes nothing about a row that already has a code.
//
// Run:  node supabase/tests/loads-customer-name.test.mjs
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

// Everything before 0383 first, with a load and a raw movement seeded, so the matrix sees what the
// migration does to rows that already exist.
const apply = async (fs) => {
  for (const f of fs) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
};
await apply(MIGRATIONS.filter((f) => f < "0383"));
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier A') returning id`)).id;
const LOAD = (await one(
  `insert into loads (org_id, ref, status, source, provider, customer_code)
   values ($1, 'LD-1', 'pending_approval', 'tms', 'mcleod', 'BATSOLWI') returning id`, [ORG])).id;
await db.query(
  `insert into mcleod_dispatch_movements (org_id, company_id, movement_id, customer_id) values ($1, 'TMS', '291013', 'BATSOLWI')`,
  [ORG]);
await apply(MIGRATIONS.filter((f) => f >= "0383"));

for (const table of ["mcleod_dispatch_movements", "loads"]) {
  const r = await one(
    `select data_type, is_nullable, column_default from information_schema.columns
      where table_name = $1 and column_name = 'customer_name'`, [table]);
  ok(`${table}.customer_name exists as text`, r?.data_type === "text", JSON.stringify(r ?? null));
  ok(`${table}.customer_name is nullable with NO default — missing is null`,
    r?.is_nullable === "YES" && r?.column_default === null, JSON.stringify(r ?? null));
}

const load = await one(`select customer_code, customer_name from loads where id = $1`, [LOAD]);
ok("an existing load keeps its code and reads null for the name until McLeod is asked",
  load.customer_code === "BATSOLWI" && load.customer_name === null, JSON.stringify(load));
const raw = await one(`select customer_id, customer_name from mcleod_dispatch_movements where movement_id = '291013'`);
ok("an existing raw movement keeps McLeod's customer id and reads null for the name",
  raw.customer_id === "BATSOLWI" && raw.customer_name === null, JSON.stringify(raw));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
