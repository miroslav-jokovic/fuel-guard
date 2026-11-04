// Silvicom 360 — org_role_permissions: named permissions a carrier switches per role (0564).
//
// HIRING-WORKFLOW-AUDIT-2026-10-31 §15.1, D-IDP1..D-IDP4; owner ruling Q-WF4b, 2026-11-04. The plan
// carries the argument; this matrix carries what only the database can answer:
//
//  1. The two role locks (admin, driver) are CHECKs, so no writer stores them.
//  2. The permission key is checked for its SHAPE, never listed — a new permission needs no migration.
//  3. One row per (org, role, permission); a row never moves to another org.
//  4. Nothing in the browser may read or write it: RLS on, no policy.
//
// Run:  node supabase/tests/org-role-permissions.test.mjs
//
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
const sqlstate = async (q, p = []) => {
  try {
    await db.query(q, p);
    return null;
  } catch (e) {
    return e.code ?? String(e.message);
  }
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
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const KEY = "recruitment.identity_number_images";
const put = (org, role, permission, allowed) =>
  sqlstate(`insert into org_role_permissions (org_id, role, permission, allowed) values ($1, $2, $3, $4)`, [
    org,
    role,
    permission,
    allowed,
  ]);

ok("a recruiter switched on is stored", (await put(ORG, "recruiter", KEY, true)) === null);
ok("a dispatcher switched off is stored", (await put(ORG, "dispatcher", KEY, false)) === null);
ok("the admin role is never stored (23514, D-PERM7)", (await put(ORG, "admin", KEY, false)) === "23514");
ok("the driver role is never stored (23514, D-PERM8)", (await put(ORG, "driver", KEY, true)) === "23514");
ok("an unknown role is refused (23514)", (await put(ORG, "owner", KEY, true)) === "23514");
ok("a new permission of the right shape needs no migration", (await put(ORG, "recruiter", "safety.medical_images", true)) === null);
ok("a key without its area is refused (23514)", (await put(ORG, "recruiter", "identity_number_images", true)) === "23514");
ok("a key in capitals is refused (23514)", (await put(ORG, "recruiter", "Recruitment.Images", true)) === "23514");
ok("a role has one answer per permission (23505)", (await put(ORG, "recruiter", KEY, false)) === "23505");
ok("another carrier keeps its own answer", (await put(OTHER, "recruiter", KEY, false)) === null);
ok("the answer is changed in place", (await sqlstate(
  `update org_role_permissions set allowed = false where org_id = $1 and role = 'recruiter' and permission = $2`,
  [ORG, KEY],
)) === null);
ok("a row never moves to another carrier", (await sqlstate(
  `update org_role_permissions set org_id = $1 where org_id = $2 and role = 'dispatcher'`,
  [OTHER, ORG],
)) !== null);
ok("allowed is never null (23502)", (await sqlstate(
  `insert into org_role_permissions (org_id, role, permission, allowed) values ($1, 'auditor', $2, null)`,
  [ORG, KEY],
)) === "23502");

// The one write path (0395's write_access_cell, given a fifth case by 0564): the cell and its audit row
// land together, a null removes the row (back to the shipped default), and the four old tables still resolve.
const ACTOR = (await one(`insert into auth.users (email) values ('admin@example.com') returning id`)).id;
const cell = (value, role = "safety_manager") =>
  db.query(`select public.write_access_cell('org_role_permissions', $1, $2, null, $3, $4, $5, 'permissions.named_changed', '{}'::jsonb) r`,
    [ORG, role, KEY, value, ACTOR]);
const stored = async (role = "safety_manager") =>
  (await one(`select allowed from org_role_permissions where org_id = $1 and role = $2 and permission = $3`, [ORG, role, KEY]))?.allowed;
const first = (await cell("false")).rows[0].r;
ok("write_access_cell switches a role off for a named permission", (await stored()) === false && first.from === null && first.to === false);
const audit = await one(`select entity, meta from audit_logs where org_id = $1 and action = 'permissions.named_changed' order by created_at desc limit 1`, [ORG]);
ok("…and writes its audit row in the same call, naming the table and from/to", audit?.entity === "org_role_permissions" && audit.meta.to === false && audit.meta.from === null);
const second = (await cell("true")).rows[0].r;
ok("a second write reads the value it replaced", (await stored()) === true && second.from === false && second.to === true);
await cell(null);
ok("a null removes the row — back to the shipped default", (await stored()) === undefined);
ok("write_access_cell still refuses a table it does not know (22023)", (await sqlstate(
  `select public.write_access_cell('drivers', $1, 'recruiter', null, $2, 'true', $3, 'x', '{}'::jsonb)`, [ORG, KEY, ACTOR])) === "22023");
ok("…and still writes the role × screen table it knew before", (await sqlstate(
  `select public.write_access_cell('org_role_surface_access', $1, 'recruiter', null, 'fuel', 'false', $2, 'x', '{}'::jsonb)`, [ORG, ACTOR])) === null);
ok("write_access_cell keeps the admin role out through the table's CHECK (23514)", (await sqlstate(
  `select public.write_access_cell('org_role_permissions', $1, 'admin', null, $2, 'false', $3, 'x', '{}'::jsonb)`, [ORG, KEY, ACTOR])) === "23514");

await db.query(`delete from organizations where id = $1`, [OTHER]);
ok("rows go with their organization", Number((await one(
  `select count(*)::int n from org_role_permissions where org_id = $1`, [OTHER])).n) === 0);

const policies = Number((await one(`select count(*)::int n from pg_policies where tablename = 'org_role_permissions'`)).n);
const rls = (await one(`select relrowsecurity r from pg_class where relname = 'org_role_permissions'`)).r;
ok("RLS is on with no client policy — deny-all from the browser", policies === 0 && rls === true);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
