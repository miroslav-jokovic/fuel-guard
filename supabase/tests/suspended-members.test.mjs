// Silvicom 360 — an office member can be suspended (migration 0393, SP7 of SETTINGS-PERMISSIONS-PLAN §4b,
// Q-SET12 ruled 2026-09-30).
//
// What suspension must do, each pinned below against the real functions:
//  · the next token carries NO org — the hook skips a suspended membership — and reinstating brings
//    the org, the role and the person's own section answers straight back;
//  · the person's per-person answers SURVIVE, which is the whole reason it is not "remove";
//  · a suspended admin never counts as the admin 0392 keeps: suspending the last active one is
//    refused (AM010), and so is demoting the last active one while another sits suspended;
//  · the browser cannot suspend or reinstate anybody (0392 left memberships no client write policy);
//  · the Users page's directory reports the state.
//
// Run:  node supabase/tests/suspended-members.test.mjs
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
const errOf = (p) => p.then(() => null, (e) => e);

// Supabase-managed schemas, shimmed identically to rls.test.mjs.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false, file_size_limit bigint,
    allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);
// Supabase's real default privileges, installed before the migrations as the platform does. Without
// them `authenticated` holds no DML at all, and every refusal below would be "permission denied" —
// a refusal for the wrong reason, proving nothing about the policies.
await db.exec(
  "grant usage on schema public to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const authUser = async (email) => (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
const org = async (name) => (await one(`insert into organizations (id,name) values (gen_random_uuid(),$1) returning id`, [name])).id;
const member = (o, u, role) => db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,$3)`, [o, u, role]);
const roleOf = async (o, u) => (await one(`select role::text r from memberships where org_id=$1 and user_id=$2`, [o, u]))?.r ?? null;

const ORG = await org("Silvicom");
const ADMIN = await authUser("miki@silvicominc.com");
const ADMIN2 = await authUser("second@silvicominc.com");
const DISPATCH = await authUser("dispatch@silvicominc.com");
await member(ORG, ADMIN, "admin");
await member(ORG, ADMIN2, "admin");
await member(ORG, DISPATCH, "dispatcher");
// The per-person answer suspension must not lose.
await db.query(`insert into user_section_access (org_id, user_id, section, access, updated_by) values ($1,$2,'fuel','manage',$3)`, [ORG, DISPATCH, ADMIN]);

const claims = async (uid) =>
  (await one(`select public.custom_access_token_hook(jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb)) as e`, [uid])).e.claims;
const suspend = (uid, by = ADMIN) => db.query(`update memberships set suspended_at = now(), suspended_by = $3 where org_id=$1 and user_id=$2`, [ORG, uid, by]);
const reinstate = (uid) => db.query(`update memberships set suspended_at = null, suspended_by = null where org_id=$1 and user_id=$2`, [ORG, uid]);

console.log("\n── 1. the token");
let c = await claims(DISPATCH);
ok("an active dispatcher's token carries the org, the role and their own fuel answer", c.org_id === ORG && c.user_role === "dispatcher" && c.sections?.fuel === "manage", JSON.stringify(c));
await suspend(DISPATCH);
c = await claims(DISPATCH);
ok("a suspended dispatcher's next token carries no org, no role, no sections", c.org_id === undefined && c.user_role === undefined && c.sections === undefined, JSON.stringify(c));
ok("…and their per-person answer is still stored", Number((await one(`select count(*) n from user_section_access where org_id=$1 and user_id=$2`, [ORG, DISPATCH])).n) === 1);
const dir = (await db.query(`select user_id, suspended_at from public.org_member_directory($1)`, [ORG])).rows;
ok("the directory reports the suspension", dir.find((r) => r.user_id === DISPATCH)?.suspended_at != null && dir.find((r) => r.user_id === ADMIN)?.suspended_at == null);
await reinstate(DISPATCH);
c = await claims(DISPATCH);
ok("reinstating brings the org, the role and the person's own answer back unchanged", c.org_id === ORG && c.user_role === "dispatcher" && c.sections?.fuel === "manage", JSON.stringify(c));

console.log("\n── 2. the record");
let e = await errOf(db.query(`update memberships set suspended_by = $3 where org_id=$1 and user_id=$2`, [ORG, DISPATCH, ADMIN]));
ok("a 'suspended by' with no 'when' is refused (23514)", e?.code === "23514", e?.message);

console.log("\n── 3. the last active admin");
ok("suspending one of two admins is allowed", (await errOf(suspend(ADMIN2))) === null);
e = await errOf(suspend(ADMIN, ADMIN));
ok("suspending the last ACTIVE admin raises AM010", e?.code === "AM010", e?.message);
e = await errOf(db.query(`update memberships set role='dispatcher' where org_id=$1 and user_id=$2`, [ORG, ADMIN]));
ok("demoting the last active admin raises AM010 even though a suspended admin exists", e?.code === "AM010", e?.message);
e = await errOf(db.query(`delete from memberships where org_id=$1 and user_id=$2`, [ORG, ADMIN]));
ok("deleting the last active admin raises AM010 likewise", e?.code === "AM010", e?.message);
ok("reinstating the suspended admin is allowed", (await errOf(reinstate(ADMIN2))) === null);
ok("…after which the first admin may be suspended", (await errOf(suspend(ADMIN, ADMIN2))) === null);
ok("a suspended admin's membership deletes freely — it was not the one keeping the org administrable", (await errOf(db.query(`delete from memberships where org_id=$1 and user_id=$2`, [ORG, ADMIN]))) === null);

console.log("\n── 4. the browser");
await db.exec("begin");
await db.exec("set local role authenticated");
await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "authenticated", sub: ADMIN2, org_id: ORG, user_role: "admin" })]);
const r = await db.query(`update memberships set suspended_at = now() where org_id=$1 and user_id=$2`, [ORG, DISPATCH]);
await db.exec("rollback");
ok("an admin's browser token suspends nobody (0 rows)", (r.affectedRows ?? 0) === 0);
ok("…and the dispatcher is still active", (await one(`select suspended_at from memberships where org_id=$1 and user_id=$2`, [ORG, DISPATCH])).suspended_at === null);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
