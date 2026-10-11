// Silvicom 360 — McLeod's hand-keyed IFTA fuel receipts (migration 0434, mcleod_fuel_tax_receipts).
//
// The nightly sweep re-reads two years of receipts every night and upserts them, so the table must
// converge on a re-sweep (one row per McLeod id), refuse a receipt with no truck or state (the IFTA
// read could not place it), and refuse negative gallons (a credit that pays the carrier for nothing).
//
// Run: node supabase/tests/mcleod-fuel-tax-receipts.test.mjs
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
// The ingest's own statement: a full row, upserted on (org_id, external_id).
const upsert = (id, gallons, isVoid = false, unit = "512", st = "UT") =>
  sqlstate(
    `insert into mcleod_fuel_tax_receipts (org_id, external_id, company_id, tractor_unit, jurisdiction, receipt_date, gallons, is_void)
     values ($1,$2,'TMS',$3,$4,'2026-06-15',$5,$6)
     on conflict (org_id, external_id) do update set gallons = excluded.gallons, is_void = excluded.is_void,
       tractor_unit = excluded.tractor_unit, jurisdiction = excluded.jurisdiction`,
    [ORG, id, unit, st, gallons, isVoid],
  );

ok("a receipt lands", (await upsert("zz1jss345nt04m8NQIG5TK", 109.084)) === null);
ok("the nightly re-sweep of the same receipt converges, it does not duplicate",
  (await upsert("zz1jss345nt04m8NQIG5TK", 109.084)) === null &&
  (await one(`select count(*)::int n from mcleod_fuel_tax_receipts where external_id = 'zz1jss345nt04m8NQIG5TK'`)).n === 1);
ok("a receipt the office later voids flips to void in place",
  (await upsert("zz1jss345nt04m8NQIG5TK", 109.084, true)) === null &&
  (await one(`select is_void from mcleod_fuel_tax_receipts where external_id = 'zz1jss345nt04m8NQIG5TK'`)).is_void === true);
ok("gallons keep McLeod's third decimal",
  Number((await one(`select gallons from mcleod_fuel_tax_receipts where external_id = 'zz1jss345nt04m8NQIG5TK'`)).gallons) === 109.084);
ok("negative gallons are refused", (await upsert("neg", -5)) === "23514");
ok("a receipt with no truck is refused", (await upsert("nounit", 10, false, null)) === "23502");
ok("a receipt with no state is refused", (await upsert("nostate", 10, false, "512", null)) === "23502");
ok("row level security is on, with no client policy (service-role only, like every McLeod staging table)",
  (await one(`select relrowsecurity r from pg_class where relname = 'mcleod_fuel_tax_receipts'`)).r === true &&
  (await one(`select count(*)::int n from pg_policies where tablename = 'mcleod_fuel_tax_receipts'`)).n === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
