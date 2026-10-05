// Silvicom 360 — every RLS policy calls auth_org_id() / auth_role() wrapped, never bare
// (migration 0435, DATABASE-AUDIT Q-DA4 step 1).
//
// A bare call is evaluated per row; `(select auth_org_id())` once per statement. Measured on production
// 2026-10-05: 210–216 ms bare vs 65 ms wrapped on ~205k idle_events rows. Step 2 adds a membership
// lookup to the helpers, which is only affordable once every call is wrapped — so this matrix fails if
// ANY migration, now or later, leaves or adds a bare call in a public-schema policy.
//
//   1. NO BARE CALL — zero policy expressions call either helper outside a scalar subquery.
//   2. NOTHING DOUBLE-WRAPPED — no "(SELECT (SELECT …" left by a second pass.
//   3. THE POLICIES STILL USE THEM — the wrapped count is not zero (the rewrite did not drop them).
//   4. TENANT ISOLATION STILL HOLDS — as `authenticated` with org A's claims, org B's vehicle is invisible.
//
// Run:  node supabase/tests/rls-wrapped-helpers.test.mjs
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

const exprs = (await db.query(`
  select pol.polname, cls.relname,
         coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') as e
    from pg_policy pol join pg_class cls on cls.oid = pol.polrelid join pg_namespace n on n.oid = cls.relnamespace
   where n.nspname = 'public'`)).rows;
const calls = (e) => (e.match(/auth_(org_id|role)\(\)/g) ?? []).length;
const wrapped = (e) => (e.match(/SELECT (public\.)?auth_(org_id|role)\(\) AS auth_(org_id|role)\)/g) ?? []).length;
const bare = exprs.filter((r) => calls(r.e) > wrapped(r.e));

console.log("\n---- Matrix: rls-wrapped-helpers ----------------------------------");
ok("no public policy calls auth_org_id() or auth_role() bare", bare.length === 0,
  bare.slice(0, 5).map((r) => `${r.relname}.${r.polname}`).join(", "));
ok("nothing is double-wrapped", !exprs.some((r) => /SELECT \( SELECT/i.test(r.e) || /\(SELECT \(SELECT/i.test(r.e)));
const total = exprs.reduce((s, r) => s + wrapped(r.e), 0);
ok("the policies still use the helpers (wrapped)", total > 300, `wrapped=${total}`);

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
await db.query(`insert into organizations (id, name) values ($1,'A'), ($2,'B')`, [ORG_A, ORG_B]);
await db.query(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,'A1',150), ($2,'B1',150)`, [ORG_A, ORG_B]);
await db.exec(`begin; set local role authenticated;`);
await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ org_id: ORG_A, user_role: "owner", sub: "00000000-0000-0000-0000-000000000001" })]);
const seen = (await db.query(`select unit_number from vehicles order by 1`)).rows.map((r) => r.unit_number);
await db.exec(`rollback;`);
ok("as org A, only org A's vehicle is visible", JSON.stringify(seen) === JSON.stringify(["A1"]), JSON.stringify(seen));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
