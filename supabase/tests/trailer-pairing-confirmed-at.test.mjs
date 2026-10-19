// Silvicom 360 — a trailer's pairing says when it was last true (migration 0488, TRAILER-LINK-PLAN TL2).
//
// The Trailers page and reefer coverage read `trailers.assigned_vehicle_id` as "what is hitched", so they
// must show its age (D-TL1). A person's change gets the age from 0488's trigger; a machine writer sets it
// itself, and the trigger must not overwrite what it set. Clearing a pairing clears its age, and an
// unrelated update (a McLeod roster write) leaves the age alone — `updated_at` is the error 0488 replaces.
//
// Run: node supabase/tests/trailer-pairing-confirmed-at.test.mjs
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
const truck = async (unit) => (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,$2,240) returning id`, [ORG, unit])).id;
const T1 = await truck("512");
const T2 = await truck("718");
const at = async (id) => (await one(`select pairing_confirmed_at a from trailers where id = $1`, [id])).a;

const unpaired = (await one(`insert into trailers (org_id, unit_number) values ($1,'R-1') returning id`, [ORG])).id;
ok("an unpaired trailer has no pairing age", (await at(unpaired)) === null);

const born = (await one(`insert into trailers (org_id, unit_number, assigned_vehicle_id) values ($1,'R-2',$2) returning id`, [ORG, T1])).id;
ok("a trailer created paired is dated", (await at(born)) !== null);

await db.query(`update trailers set assigned_vehicle_id = $2 where id = $1`, [unpaired, T1]);
ok("a person pairing a trailer dates the pairing", (await at(unpaired)) !== null);

const set = "2026-08-04T16:06:27Z";
await db.query(`update trailers set assigned_vehicle_id = $2, pairing_confirmed_at = $3 where id = $1`, [unpaired, T2, set]);
ok("a writer's own date is kept, not replaced by now()", new Date(await at(unpaired)).toISOString() === new Date(set).toISOString());

await db.query(`update trailers set make = 'Utility' where id = $1`, [unpaired]);
ok("an unrelated update leaves the pairing's age alone", new Date(await at(unpaired)).toISOString() === new Date(set).toISOString());

await db.query(`update trailers set assigned_vehicle_id = $2 where id = $1`, [unpaired, T2]);
ok("re-saving the same truck does not make the pairing look fresh", new Date(await at(unpaired)).toISOString() === new Date(set).toISOString());

await db.query(`update trailers set assigned_vehicle_id = null where id = $1`, [unpaired]);
ok("clearing the pairing clears its age", (await at(unpaired)) === null);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
