// Silvicom 360 — mcleod staging company_id matrix (migration 0303, D-FIN8).
//
//   1. THE COLUMN EXISTS on all seven staging tables and accepts NULL (a row written by the
//      previous build during the deploy window carries no company).
//   2. THE BACKFILL IS MEASURED, NOT DEFAULTED — a row that predates 0303 reads 'TMS' after it
//      applies; a row inserted afterwards without a company stays NULL.
//   3. THE KEY IS UNCHANGED for now — two movements with the same external_id still collide on
//      (org_id, external_id); the movements-only key change is a later migration.
//
// Run:  node supabase/tests/mcleod-company-column.test.mjs
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
    bucket_id text, name text, owner uuid, created_at timestamptz default now()
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

const apply = async (files) => {
  for (const f of files) {
    try { await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, "")); }
    catch (e) { console.error(`migration ${f} failed: ${e.message}`); process.exit(1); }
  }
};
await apply(MIGRATIONS.filter((f) => f < "0303"));

const ORG = "11111111-1111-1111-1111-111111111111";
await db.query(`insert into organizations (id, name) values ($1,'Carrier A')`, [ORG]);
// Rows that predate the column, on two of the seven tables.
await db.query(
  `insert into mcleod_settlements (org_id, external_id, payee_type, total_pay, posted_pay) values ($1, 'S-OLD', 'company_driver', 100, 100)`,
  [ORG],
);
await db.query(`insert into mcleod_movements (org_id, external_id) values ($1, 'M-OLD')`, [ORG]);

await apply(MIGRATIONS.filter((f) => f >= "0303"));

console.log("\n---- Matrix: mcleod-company-column -------------------------------");

const TABLES = ["mcleod_settlements", "mcleod_deductions", "mcleod_ap_vouchers", "mcleod_movements", "mcleod_billing", "mcleod_gl_totals", "mcleod_office_lines"];
const cols = await db.query(
  `select table_name, is_nullable from information_schema.columns where column_name='company_id' and table_name = any($1)`,
  [TABLES],
);
ok("company_id exists on all seven staging tables", cols.rows.length === TABLES.length, cols.rows.map((r) => r.table_name).join(","));
ok("  and is nullable — a deploy-window row may not say", cols.rows.every((r) => r.is_nullable === "YES"));

const old = await db.query(`select external_id, company_id from mcleod_settlements where org_id=$1 union all select external_id, company_id from mcleod_movements where org_id=$1`, [ORG]);
ok("rows that predate 0303 read the measured backfill, TMS", old.rows.length === 2 && old.rows.every((r) => r.company_id === "TMS"), JSON.stringify(old.rows));

await db.query(`insert into mcleod_movements (org_id, external_id) values ($1, 'M-NEW')`, [ORG]);
const fresh = await db.query(`select company_id from mcleod_movements where org_id=$1 and external_id='M-NEW'`, [ORG]);
ok("a row inserted after 0303 without a company stays NULL — no default invents one", fresh.rows[0]?.company_id === null);

let collided = false;
try { await db.query(`insert into mcleod_movements (org_id, external_id, company_id) values ($1, 'M-OLD', 'TMS2')`, [ORG]); }
catch { collided = true; }
ok("the movement key is still (org_id, external_id) — the company-aware key is a later migration", collided);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
