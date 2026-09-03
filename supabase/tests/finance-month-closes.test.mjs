// Silvicom 360 — finance_month_closes matrix (migration 0306, D-FIN14).
//
//   1. ONE ROW PER (org, company, month) — a second computation replaces, never duplicates.
//   2. STATUS IS A VOCABULARY — only open | hardened.
//   3. DENY-ALL — RLS enabled, zero client policies; the accounting API is the only door.
//
// Run:  node supabase/tests/finance-month-closes.test.mjs
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
for (const f of MIGRATIONS) {
  try { await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, "")); }
  catch (e) { console.error(`migration ${f} failed: ${e.message}`); process.exit(1); }
}

console.log("\n---- Matrix: finance-month-closes --------------------------------");
const ORG = "11111111-1111-1111-1111-111111111111";
await db.query(`insert into organizations (id, name) values ($1,'Carrier A')`, [ORG]);

const ins = (status = "open") =>
  db.query(
    `insert into finance_month_closes (org_id, company_id, period_start, period_end, status, gl_revenue)
     values ($1, 'TMS', '2026-06-01', '2026-07-01', $2, 100)
     on conflict (org_id, company_id, period_start) do update set status = excluded.status, gl_revenue = excluded.gl_revenue + 1`,
    [ORG, status],
  );
await ins("open");
await ins("hardened");
const rows = await db.query(`select status, gl_revenue::text from finance_month_closes where org_id=$1`, [ORG]);
ok("one row per (org, company, month) — the second computation replaced the first", rows.rows.length === 1 && rows.rows[0].status === "hardened" && rows.rows[0].gl_revenue === "101.00");

let refused = false;
try { await db.query(`insert into finance_month_closes (org_id, company_id, period_start, period_end, status) values ($1,'TMS','2026-07-01','2026-08-01','closed')`, [ORG]); }
catch { refused = true; }
ok("status is a vocabulary: 'closed' is refused", refused);

const rls = await db.query(`select relrowsecurity from pg_class where relname='finance_month_closes'`);
const pol = await db.query(`select count(*)::int n from pg_policies where tablename='finance_month_closes'`);
ok("RLS enabled with zero client policies — deny-all on purpose", rls.rows[0].relrowsecurity === true && pol.rows[0].n === 0);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
