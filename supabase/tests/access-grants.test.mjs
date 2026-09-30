// Silvicom 360 — access is granted in one place (migration 0392, SP6 of SETTINGS-PERMISSIONS-PLAN §4b).
//
// Two halves, and a matrix is the only place either can be proved:
//
//  1. **The browser cannot write `memberships` or `invites`.** Until 0392 an admin's own token could,
//     through PostgREST: re-role anybody to admin, delete members, mint an invite for any email and
//     role — with no audit row, no last-admin guard and no allowed-domains check, because none of the
//     API's handlers were in that path. RLS refuses an UPDATE or DELETE by matching ZERO rows, not by
//     raising, so every write case below checks the row count, and a companion case proves the row
//     was there to be written. "No error" would prove nothing.
//  2. **The database keeps every organisation an admin**, whatever path the write takes — the service
//     role, the `auth.users` cascade, two demotions racing — and still lets an admin SWAP inside one
//     transaction and an organisation be deleted outright.
//
// Run:  node supabase/tests/access-grants.test.mjs
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
await db.query(`insert into invites (org_id, email, role, token) values ($1,'old@silvicominc.com','dispatcher','t-old')`, [ORG]);

/**
 * One statement as the org admin's browser JWT (`authenticated` + claims, as rls.test.mjs models
 * PostgREST), always rolled back. Returns the affected row count, or the error message.
 */
async function asAdmin(sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "authenticated", sub: ADMIN, org_id: ORG, user_role: "admin" }),
    ]);
    const r = await db.query(sql, params);
    await db.exec("rollback");
    return { rows: r.affectedRows ?? r.rows.length, data: r.rows, error: null };
  } catch (e) {
    await db.exec("rollback");
    return { rows: 0, data: [], error: e.message };
  }
}

// ── 1. The browser writes no membership and no invite ────────────────────────────────────────
console.log("\n── 1. an admin's browser token");
const policies = (await db.query(`select tablename||'.'||policyname p from pg_policies where tablename in ('memberships','invites')`)).rows.map((r) => r.p);
ok("memberships_write is gone", !policies.includes("memberships.memberships_write"));
ok("invites_admin_all is gone, and invites has no policy at all (deny-all)", !policies.some((p) => p.startsWith("invites.")));
ok("the member list's SELECT policies stay", policies.includes("memberships.memberships_select"));

let r = await asAdmin(`select user_id from memberships where org_id = $1`, [ORG]);
ok("the admin can still READ the member list (3 rows)", r.error === null && r.data.length === 3, JSON.stringify(r));

r = await asAdmin(`update memberships set role = 'admin' where org_id = $1 and user_id = $2`, [ORG, DISPATCH]);
ok("cannot promote the dispatcher to admin (0 rows)", r.error === null && r.rows === 0, JSON.stringify(r));
ok("…and the dispatcher is still a dispatcher, so the 0 was the policy", (await roleOf(ORG, DISPATCH)) === "dispatcher");

r = await asAdmin(`delete from memberships where org_id = $1 and user_id = $2`, [ORG, DISPATCH]);
ok("cannot delete a member (0 rows)", r.error === null && r.rows === 0, JSON.stringify(r));

const OUTSIDER = await authUser("friend@gmail.com");
r = await asAdmin(`insert into memberships (org_id, user_id, role) values ($1,$2,'admin')`, [ORG, OUTSIDER]);
ok("cannot insert a membership (row-level security refuses)", /row-level security/i.test(r.error ?? ""), JSON.stringify(r));

r = await asAdmin(`insert into invites (org_id, email, role, token) values ($1,'friend@gmail.com','admin','t-new')`, [ORG]);
ok("cannot mint an invite", /row-level security/i.test(r.error ?? ""), JSON.stringify(r));
r = await asAdmin(`select id from invites where org_id = $1`, [ORG]);
ok("cannot read invites (0 of 1)", r.error === null && r.data.length === 0, JSON.stringify(r));
r = await asAdmin(`delete from invites where org_id = $1`, [ORG]);
ok("cannot delete invites (0 rows)", r.error === null && r.rows === 0, JSON.stringify(r));
ok("…and the invite is still there", Number((await one(`select count(*) n from invites where org_id=$1`, [ORG])).n) === 1);

// ── 2. The database keeps an admin ────────────────────────────────────────────────────────────
// Everything below runs as the table owner — the service role's position (it bypasses RLS) — because
// that is the path the API takes and the one no policy can guard.
console.log("\n── 2. the last admin");
ok("demoting one of two admins is allowed", (await errOf(db.query(`update memberships set role='dispatcher' where org_id=$1 and user_id=$2`, [ORG, ADMIN2]))) === null);

let e = await errOf(db.query(`update memberships set role='dispatcher' where org_id=$1 and user_id=$2`, [ORG, ADMIN]));
ok("demoting the LAST admin raises AM010", e?.code === "AM010", e?.message);
ok("…and they are still admin", (await roleOf(ORG, ADMIN)) === "admin");

e = await errOf(db.query(`delete from memberships where org_id=$1 and user_id=$2`, [ORG, ADMIN]));
ok("deleting the last admin's membership raises AM010", e?.code === "AM010", e?.message);

e = await errOf(db.query(`delete from auth.users where id=$1`, [ADMIN]));
ok("deleting the last admin's auth user (the cascade path) raises AM010", e?.code === "AM010", e?.message);
ok("…and the membership survived the refused cascade", (await roleOf(ORG, ADMIN)) === "admin");

// A swap in one transaction, demotion FIRST: a row-level check would refuse it mid-flight. The
// deferred trigger asks at commit, when the organisation has its new admin.
/** Statements in one transaction; the first error (at a statement or at commit) is returned. */
const inOneTransaction = async (...stmts) => {
  await db.exec("begin");
  try {
    for (const [sql, params] of stmts) await db.query(sql, params);
    await db.exec("commit");
    return null;
  } catch (err) {
    await db.exec("rollback").catch(() => undefined);
    return err;
  }
};
e = await inOneTransaction(
  [`update memberships set role='dispatcher' where org_id=$1 and user_id=$2`, [ORG, ADMIN]],
  [`update memberships set role='admin' where org_id=$1 and user_id=$2`, [ORG, DISPATCH]],
);
ok("an admin swap in one transaction commits, even demotion-first", e === null, e?.message);
ok("…and the admin is now the former dispatcher", (await roleOf(ORG, DISPATCH)) === "admin" && (await roleOf(ORG, ADMIN)) === "dispatcher");

// Two demotions "racing": the API's count saw two admins each time. Serialised here in one
// transaction, which is the worst case the count could not see.
await db.query(`update memberships set role='admin' where org_id=$1 and user_id=$2`, [ORG, ADMIN]);
e = await inOneTransaction(
  [`update memberships set role='dispatcher' where org_id=$1 and user_id=$2`, [ORG, ADMIN]],
  [`update memberships set role='dispatcher' where org_id=$1 and user_id=$2`, [ORG, DISPATCH]],
);
ok("two demotions that together leave no admin are refused (AM010)", e?.code === "AM010", e?.message);
ok("…and both are still admin afterwards", (await roleOf(ORG, ADMIN)) === "admin" && (await roleOf(ORG, DISPATCH)) === "admin");

ok(
  "a non-admin membership deletes freely",
  (await errOf(db.query(`delete from memberships where org_id=$1 and user_id=$2`, [ORG, ADMIN2]))) === null,
);

// Deleting the whole organisation cascades every membership, admins included: nobody is left to lock
// out, so the rule must not stand in the way of a platform support act.
const GONE = await org("Closed Carrier");
const GONE_ADMIN = await authUser("owner@closed.example");
await member(GONE, GONE_ADMIN, "admin");
e = await errOf(db.query(`delete from organizations where id=$1`, [GONE]));
ok("deleting an organisation (cascading its only admin) is allowed", e === null, e?.message);
ok("…and its memberships went with it", Number((await one(`select count(*) n from memberships where org_id=$1`, [GONE])).n) === 0);

// The rule is per organisation: another tenant's admin says nothing about this one.
const OTHER = await org("Other Carrier");
const OTHER_ADMIN = await authUser("boss@other.example");
await member(OTHER, OTHER_ADMIN, "admin");
e = await errOf(db.query(`update memberships set role='dispatcher' where org_id=$1 and user_id=$2`, [OTHER, OTHER_ADMIN]));
ok("another tenant's admins do not count: its only admin cannot be demoted", e?.code === "AM010", e?.message);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
