// FuelGuard — migrations 0420 (`idle_settings.idle_burn_source`, §4 Q-IE14) and 0421 (0409's
// `idle_engine_burn_inputs` dropped).
//
// What must hold:
//   1. An existing settings row reads 'configured' after 0420 — adding the switch moves no figure.
//   2. A new row with no source named is 'configured'; 'learned' is accepted.
//   3. Anything else is refused, and NULL is refused.
//   4. idleSync's partial upsert (suggestion columns only, no source) still inserts a row and still
//      leaves a stored 'learned' alone on conflict.
//   5. After 0421, `idle_engine_burn_inputs` is gone and 0419's `idle_engine_burn_hours` is not.
//
// Run: node supabase/tests/idle-burn-source.test.mjs
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

// Apply up to 0419, seed a row the way production holds one, then apply the rest: (1) is about a row
// that existed BEFORE the column did.
const BEFORE = ALL.filter((f) => f < "0420");
const AFTER = ALL.filter((f) => f >= "0420");
const apply = async (files) => {
  for (const f of files) {
    await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
  }
};
await apply(BEFORE);
ok("0409's function exists before 0421", (await one(`select to_regprocedure('public.idle_engine_burn_inputs(uuid, timestamptz, timestamptz, integer[])') is not null p`)).p === true);

const ORG = "86d6b3ea-4361-4f71-877f-e8373615769b";
await db.query(`insert into organizations (id, name) values ($1, 'Silvicom')`, [ORG]);
await db.query(`insert into idle_settings (org_id, idle_gal_per_hour) values ($1, 0.80)`, [ORG]);
await apply(AFTER);

// ── 1. the existing row ─────────────────────────────────────────────────────────────────────────
const source = async (org) => (await one(`select idle_burn_source s from idle_settings where org_id = $1`, [org]))?.s;
ok("a row that predates 0420 reads 'configured'", (await source(ORG)) === "configured");

// ── 2. new rows ─────────────────────────────────────────────────────────────────────────────────
const org = async (name) => (await one(`insert into organizations (id, name) values (gen_random_uuid(), $1) returning id`, [name])).id;
const A = await org("A");
await db.query(`insert into idle_settings (org_id) values ($1)`, [A]);
ok("a new row with no source named is 'configured'", (await source(A)) === "configured");
await db.query(`update idle_settings set idle_burn_source = 'learned' where org_id = $1`, [A]);
ok("'learned' is accepted", (await source(A)) === "learned");

// ── 3. refusals ─────────────────────────────────────────────────────────────────────────────────
const refused = async (v) => {
  try {
    await db.query(`update idle_settings set idle_burn_source = $2 where org_id = $1`, [ORG, v]);
    return false;
  } catch {
    return true;
  }
};
ok("any other value is refused", (await refused("measured")) && (await refused("Learned")) && (await refused("")));
ok("NULL is refused", await refused(null));
ok("a refused write leaves the row as it was", (await source(ORG)) === "configured");

// ── 4. idleSync's partial upsert ────────────────────────────────────────────────────────────────
const upsert = (o) =>
  db.query(
    `insert into idle_settings (org_id, suggested_low_f, suggested_high_f, updated_at) values ($1, 25, 80, now())
     on conflict (org_id) do update set suggested_low_f = excluded.suggested_low_f,
       suggested_high_f = excluded.suggested_high_f, updated_at = excluded.updated_at`,
    [o],
  );
const B = await org("B");
await upsert(B);
ok("the suggestion upsert still inserts a row, as 'configured'", (await source(B)) === "configured");
await upsert(A);
ok("the suggestion upsert leaves a stored 'learned' alone", (await source(A)) === "learned");

// ── 5. 0421 ─────────────────────────────────────────────────────────────────────────────────────
const fn = async (sig) => (await one(`select to_regprocedure($1) is not null p`, [sig])).p;
ok("0409's idle_engine_burn_inputs is gone", (await fn("public.idle_engine_burn_inputs(uuid, timestamptz, timestamptz, integer[])")) === false);
ok("0419's idle_engine_burn_hours is not", (await fn("public.idle_engine_burn_hours(uuid, timestamptz, timestamptz, integer[])")) === true);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
