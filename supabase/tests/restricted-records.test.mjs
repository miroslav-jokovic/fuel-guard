// FuelGuard — restricted-records matrix (migration 0205, DQF-EXECUTION-PLAN Phase G / D-DQ15).
//
// Proves the RLS layer of the three-layer restriction: a dispatcher or auditor reading
// qualification_records/documents through PostgREST sees no drug/alcohol/clearinghouse/
// previous-employer rows, while admin and safety_manager see everything and non-restricted kinds
// stay visible to all fleet roles. (The service-role API path is enforced separately in
// routes/compliance.ts via filterRestrictedRows — RLS cannot see those reads.)
//
// Run:  node supabase/tests/restricted-records.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations"))
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
    bucket_id text, name text, owner uuid, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text)
  returns text[]
  language sql
  immutable
  as $fn$
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
// Supabase's real default privileges, installed BEFORE the migrations run — same modelling (and the
// same reasoning) as rls.test.mjs: full DML granted, RLS is the gate.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const DRIVER = (
  await one(`insert into drivers (org_id, full_name, samsara_driver_id) values ($1,'A Driver','S1') returning id`, [ORG])
).id;

await db.query(
  `insert into qualification_records (org_id, driver_id, kind, occurred_on) values
     ($1, $2, 'mvr', '2026-01-10'),
     ($1, $2, 'drug_test', '2026-02-01'),
     ($1, $2, 'previous_employer_response', '2026-02-02'),
     ($1, $2, 'clearinghouse_limited', '2026-02-03')`,
  [ORG, DRIVER],
);
await db.query(
  `insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, bytes, sha256, uploaded_by) values
     (gen_random_uuid(), $1, 'driver', $2, 'mvr', $3, 'application/pdf', 10, repeat('a',64), null),
     (gen_random_uuid(), $1, 'driver', $2, 'drug_test', $4, 'application/pdf', 10, repeat('b',64), null)`,
  [ORG, DRIVER, `${ORG}/driver/${DRIVER}/a.pdf`, `${ORG}/driver/${DRIVER}/b.pdf`],
);

/** Read as an org member with the given app role (same JWT shape rls.test.mjs uses). */
async function countAs(role, sql) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: "00000000-0000-4000-8000-000000000001", org_id: ORG, user_role: role, role: "authenticated" }),
    ]);
    const res = await db.query(sql);
    await db.exec("rollback");
    return Number(res.rows[0].n);
  } catch (e) {
    await db.exec("rollback");
    return `ERROR: ${e.message}`;
  }
}

const RECORDS = "select count(*)::int as n from qualification_records";
const DOCS = "select count(*)::int as n from documents";

const expect = async (name, role, sql, want) => {
  const got = await countAs(role, sql);
  ok(name, got === want, `(got ${got})`);
};
await expect("dispatcher sees only the non-restricted record", "dispatcher", RECORDS, 1);
await expect("auditor sees only the non-restricted record", "auditor", RECORDS, 1);
await expect("fleet_manager sees only the non-restricted record", "fleet_manager", RECORDS, 1);
await expect("safety_manager sees all four records", "safety_manager", RECORDS, 4);
await expect("admin sees all four records", "admin", RECORDS, 4);
await expect("dispatcher sees only the non-restricted document", "dispatcher", DOCS, 1);
await expect("safety_manager sees both documents", "safety_manager", DOCS, 2);
ok(
  "dq_exports carries include_restricted, defaulting false",
  (await one(`select column_default from information_schema.columns
               where table_name = 'dq_exports' and column_name = 'include_restricted'`)).column_default === "false",
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
