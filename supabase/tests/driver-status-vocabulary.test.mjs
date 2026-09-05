// FuelGuard — drivers.status vocabulary (migration 0240).
//
// The column carried no constraint until 0240, so the vocabulary was enforced only by whichever code
// paths imported DRIVER_STATUSES. That becomes dangerous the moment a SYNC writes the column from a
// mapped vendor vocabulary: a bad mapping writes a value nothing rejects, and every `status='active'`
// query in the product silently stops returning those drivers.
//
// Run:  node supabase/tests/driver-status-vocabulary.test.mjs
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
    name text, owner uuid, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;

for (const s of ["applicant", "active", "inactive", "on_leave", "terminated"]) {
  ok(
    `'${s}' is admitted`,
    (await sqlstate(`insert into drivers (org_id, full_name, status) values ($1,'A B',$2)`, [ORG, s])) === null,
  );
}

// The reason the constraint exists: a vendor vocabulary leaking through a bad mapping.
for (const bad of ["Y", "N", "ACTIVE", "deactivated", "termianted"]) {
  ok(
    `'${bad}' is rejected — a mapped vendor value must not become a new category`,
    (await sqlstate(`insert into drivers (org_id, full_name, status) values ($1,'A B',$2)`, [ORG, bad])) === "23514",
  );
}

// The default has to remain legal, or every insert that omits status breaks.
ok(
  "a driver inserted without a status still gets a legal default",
  (await sqlstate(`insert into drivers (org_id, full_name) values ($1,'No Status Given')`, [ORG])) === null,
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
