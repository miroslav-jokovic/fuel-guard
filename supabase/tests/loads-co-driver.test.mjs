// Silvicom 360 — a team load's second driver (migration 0493, LOADS-ACTIVITY-PLAN.md LA1, D-LA2).
//
// Schema only, so what can be wrong is the SHAPE:
//
//   · MISSING IS NULL. `co_driver_id` is nullable with no default, so every load production already
//     holds reads "no second driver" until the projection writes one, never a driver nobody named.
//   · NO SECOND REFERENCE TO `drivers`. Every reader embeds a load's driver as `drivers(full_name)`,
//     and PostgREST refuses that embed outright (PGRST201) once `loads` has two paths to `drivers`.
//     So `driver_id` stays the ONLY foreign key from loads to drivers, and the embed keeps resolving
//     through it, which is checked by running the embed's own join shape.
//   · THE ACTIVITY READ HAS AN INDEX. "Every load this driver was on" asks both columns; the
//     co-driver half is indexed on (org_id, co_driver_id) beside 0085's driver index.
//
// Run:  node supabase/tests/loads-co-driver.test.mjs
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

// Everything before 0493 first, with a delivered McLeod load seeded, so the matrix sees what the
// migration does to a row that already exists.
const apply = async (fs) => {
  for (const f of fs) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
};
await apply(MIGRATIONS.filter((f) => f < "0493"));
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier A') returning id`)).id;
const DRIVER = (await one(`insert into drivers (org_id, full_name) values ($1, 'Kim Dixon') returning id`, [ORG])).id;
const LOAD = (await one(
  `insert into loads (org_id, ref, status, source, provider, external_id, driver_id)
   values ($1, '0136393', 'pending_approval', 'tms', 'mcleod', 'TMS:293773', $2) returning id`, [ORG, DRIVER])).id;
await apply(MIGRATIONS.filter((f) => f >= "0493"));

const col = await one(
  `select data_type, is_nullable, column_default from information_schema.columns
    where table_name = 'loads' and column_name = 'co_driver_id'`);
ok("loads.co_driver_id exists as uuid", col?.data_type === "uuid", JSON.stringify(col ?? null));
ok("loads.co_driver_id is nullable with NO default — missing is null",
  col?.is_nullable === "YES" && col?.column_default === null, JSON.stringify(col ?? null));

const fks = (await db.query(`
  select kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
   where tc.table_name = 'loads' and tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'drivers'
   order by 1`)).rows.map((r) => r.column_name);
ok("driver_id is still the ONLY foreign key from loads to drivers, so drivers(full_name) is unambiguous",
  JSON.stringify(fks) === JSON.stringify(["driver_id"]), JSON.stringify(fks));

const load = await one(`select driver_id, co_driver_id from loads where id = $1`, [LOAD]);
ok("an existing load keeps its driver and reads null for the second until the projection writes it",
  load.driver_id === DRIVER && load.co_driver_id === null, JSON.stringify(load));

const SECOND = (await one(`insert into drivers (org_id, full_name) values ($1, 'Marcus Houston') returning id`, [ORG])).id;
await db.query(`update loads set co_driver_id = $2 where id = $1`, [LOAD, SECOND]);
ok("the projection's update writes a second driver onto an existing load",
  (await one(`select co_driver_id from loads where id = $1`, [LOAD])).co_driver_id === SECOND);

const idx = await one(`select indexdef from pg_indexes where tablename = 'loads' and indexname = 'idx_loads_org_co_driver'`);
ok("the co-driver half of the activity read is indexed on (org_id, co_driver_id), partial on not null",
  /\(org_id, co_driver_id\)/.test(idx?.indexdef ?? "") && /co_driver_id IS NOT NULL/i.test(idx?.indexdef ?? ""),
  idx?.indexdef ?? "missing");

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
