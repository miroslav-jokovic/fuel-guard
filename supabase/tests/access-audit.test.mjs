// Silvicom 360 — access changes are audited in one transaction, and the log is append-only
// (migration 0395, SP8 of SETTINGS-PERMISSIONS-PLAN §4b; Q-SET7 (a) and Q-SET9 (a), ruled 2026-09-30).
//
// Pinned against the real functions:
//  · every write function records `from` and `to` — the one thing the old audit rows could not say;
//  · when the audit row cannot be written the change does not happen (a deliberately broken actor
//    makes the audit insert fail, and the cell must be unchanged afterwards);
//  · a change the database refuses (the last admin, AM010) leaves no audit row behind either;
//  · only the service role can call them;
//  · nobody but the schema owner, inside a declared retention transaction, can UPDATE, DELETE or
//    TRUNCATE audit_logs — not the service role, not the owner by accident.
//
// Run:  node supabase/tests/access-audit.test.mjs
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
    id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now()
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
const DISPATCH = await authUser("dispatch@silvicominc.com");
await member(ORG, ADMIN, "admin");
await member(ORG, DISPATCH, "dispatcher");
const NOBODY = "00000000-0000-4000-8000-0000000000ff"; // not in auth.users: an audit insert naming it fails its FK

// Newest by transaction id, not by `created_at`: each call here is its own transaction, and two can
// share a timestamp at PGlite's clock resolution — which made an earlier draft of this file flaky.
const lastAudit = async () => one(`select action, entity, entity_id, meta, actor_id from audit_logs order by xmin::text::bigint desc limit 1`);
const auditCount = async () => Number((await one(`select count(*) n from audit_logs`)).n);
const cell = async (t, col, where, params) => (await one(`select ${col}::text v from ${t} where ${where}`, params))?.v ?? null;
const w = (t, role, uid, key, val, actor = ADMIN, action = "permissions.changed", meta = {}) =>
  db.query(`select public.write_access_cell($1,$2,$3,$4,$5,$6,$7,$8,$9) r`, [t, ORG, role, uid, key, val, actor, action, JSON.stringify(meta)]);

console.log("\n── 1. one access cell, with before and after");
await w("org_section_access", "dispatcher", null, "fuel", "manage", ADMIN, "permissions.changed", { default: "view" });
let a = await lastAudit();
ok("role × section: set records from null to manage, keeping the API's meta", a.action === "permissions.changed" && a.meta.from === null && a.meta.to === "manage" && a.meta.default === "view", JSON.stringify(a));
await w("org_section_access", "dispatcher", null, "fuel", "none");
a = await lastAudit();
ok("…a change records the value it replaced (manage → none)", a.meta.from === "manage" && a.meta.to === "none", JSON.stringify(a.meta));
ok("…and the cell holds the new value", (await cell("org_section_access", "access", "org_id=$1 and role='dispatcher' and section='fuel'", [ORG])) === "none");
await w("org_section_access", "dispatcher", null, "fuel", null);
a = await lastAudit();
ok("…a reset removes the row and records none → null", a.meta.from === "none" && a.meta.to === null && (await cell("org_section_access", "access", "org_id=$1 and role='dispatcher' and section='fuel'", [ORG])) === null);

await w("user_section_access", null, DISPATCH, "safety", "view", ADMIN, "permissions.changed_user");
a = await lastAudit();
ok("person × section: from null to view, the person as entity_id", a.meta.to === "view" && a.entity_id === DISPATCH && a.entity === "user_section_access", JSON.stringify(a));
await w("org_role_surface_access", "dispatcher", null, "fuel.log", "false", ADMIN, "permissions.screen_changed");
a = await lastAudit();
ok("role × screen: a boolean answer is recorded as a boolean (false), not the word", a.meta.to === false && a.meta.from === null, JSON.stringify(a.meta));
await w("user_surface_access", null, DISPATCH, "fuel.log", "true", ADMIN, "permissions.screen_changed_user");
await w("user_surface_access", null, DISPATCH, "fuel.log", "false", ADMIN, "permissions.screen_changed_user");
a = await lastAudit();
ok("person × screen: true → false", a.meta.from === true && a.meta.to === false, JSON.stringify(a.meta));

let e = await errOf(w("memberships", "admin", null, "x", "y"));
ok("a table that is not an access table is refused (22023)", e?.code === "22023", e?.message);

console.log("\n── 2. no audit row, no change");
let before = await auditCount();
e = await errOf(w("org_section_access", "dispatcher", null, "safety", "manage", NOBODY));
ok("an audit insert that fails raises…", e !== null, "no error");
ok("…the cell was NOT written", (await cell("org_section_access", "access", "org_id=$1 and role='dispatcher' and section='safety'", [ORG])) === null);
ok("…and no audit row exists for it", (await auditCount()) === before);

console.log("\n── 3. members");
const r1 = await one(`select public.member_change_role($1,$2,'fleet_manager',$3) r`, [ORG, DISPATCH, ADMIN]);
a = await lastAudit();
ok("role change returns and records dispatcher → fleet_manager", r1.r === "dispatcher" && a.action === "member.role_changed" && a.meta.from === "dispatcher" && a.meta.to === "fleet_manager");
before = await auditCount();
ok("changing to the same role records nothing", (await one(`select public.member_change_role($1,$2,'fleet_manager',$3) r`, [ORG, DISPATCH, ADMIN])).r === "fleet_manager" && (await auditCount()) === before);
ok("a stranger is null, with nothing recorded", (await one(`select public.member_change_role($1,$2,'admin',$3) r`, [ORG, NOBODY, ADMIN])).r === null && (await auditCount()) === before);
e = await errOf(db.query(`select public.member_change_role($1,$2,'dispatcher',$3)`, [ORG, ADMIN, ADMIN]));
ok("demoting the last admin raises AM010 at commit…", e?.code === "AM010", e?.message);
ok("…and leaves no audit row for the change that did not happen", (await auditCount()) === before);

await one(`select public.member_set_suspended($1,$2,true,$3) r`, [ORG, DISPATCH, ADMIN]);
a = await lastAudit();
ok("suspending records member.suspended with the role", a.action === "member.suspended" && a.meta.role === "fleet_manager");
before = await auditCount();
await one(`select public.member_set_suspended($1,$2,true,$3) r`, [ORG, DISPATCH, ADMIN]);
ok("suspending the already-suspended records nothing", (await auditCount()) === before);
await one(`select public.member_set_suspended($1,$2,false,$3) r`, [ORG, DISPATCH, ADMIN]);
a = await lastAudit();
ok("reinstating records member.reinstated and when they had been suspended", a.action === "member.reinstated" && a.meta.suspendedAt != null);

e = await errOf(db.query(`select public.member_remove($1,$2,$3,'member.renamed')`, [ORG, DISPATCH, ADMIN]));
ok("member_remove refuses an action that is not a removal (22023)", e?.code === "22023");
ok("member_remove returns and records the role held", (await one(`select public.member_remove($1,$2,$3,'member.removed') r`, [ORG, DISPATCH, ADMIN])).r === "fleet_manager" && (await lastAudit()).meta.role === "fleet_manager");

console.log("\n── 4. invites");
const inv = (await one(`select public.invite_create($1,'new@silvicominc.com','dispatcher','New Person','h1', now() + interval '7 days', $2) id`, [ORG, ADMIN])).id;
a = await lastAudit();
ok("invite_create writes the invite and invite.created together", inv && a.action === "invite.created" && a.entity_id === inv && a.meta.role === "dispatcher");
before = await auditCount();
e = await errOf(db.query(`select public.invite_create($1,'new@silvicominc.com','admin',null,'h2', now(), $2)`, [ORG, ADMIN]));
ok("a duplicate email raises 23505 and records nothing", e?.code === "23505" && (await auditCount()) === before);
e = await errOf(db.query(`select public.invite_delete($1,$2,$3)`, [ORG, inv, ADMIN]));
ok("a pending invite cannot be deleted (AM020)", e?.code === "AM020", e?.message);
ok("invite_revoke returns and records pending → revoked", (await one(`select public.invite_revoke($1,$2,$3) r`, [ORG, inv, ADMIN])).r === "pending" && (await lastAudit()).meta.from === "pending");
ok("invite_reissue returns and records revoked → pending", (await one(`select public.invite_reissue($1,$2,'h3', now() + interval '7 days', $3) r`, [ORG, inv, ADMIN])).r === "revoked" && (await one(`select token from invites where id=$1`, [inv])).token === "h3");
await one(`select public.invite_revoke($1,$2,$3) r`, [ORG, inv, ADMIN]);
ok("invite_delete removes a revoked invite and keeps the whole invite in the audit row", (await one(`select public.invite_delete($1,$2,$3) r`, [ORG, inv, ADMIN])).r === "revoked" && (await lastAudit()).meta.email === "new@silvicominc.com" && Number((await one(`select count(*) n from invites where id=$1`, [inv])).n) === 0);

console.log("\n── 5. who can call them");
for (const f of ["write_access_cell(text,uuid,text,uuid,text,text,uuid,text,jsonb)", "member_change_role(uuid,uuid,user_role,uuid)", "member_remove(uuid,uuid,uuid,text)", "member_set_suspended(uuid,uuid,boolean,uuid)", "invite_create(uuid,text,user_role,text,text,timestamptz,uuid)", "invite_revoke(uuid,uuid,uuid)", "invite_delete(uuid,uuid,uuid)", "invite_reissue(uuid,uuid,text,timestamptz,uuid)"]) {
  const p = await one(`select has_function_privilege('authenticated', 'public.${f}', 'execute') a, has_function_privilege('service_role', 'public.${f}', 'execute') s`);
  ok(`${f.split("(")[0]}: service role only`, p.a === false && p.s === true, JSON.stringify(p));
}

console.log("\n── 6. append-only");
const asRole = async (role, sql, guc = null) => {
  await db.exec("begin");
  try {
    if (guc) await db.query(`select set_config('silvicom.audit_retention', $1, true)`, [guc]);
    if (role) await db.exec(`set local role ${role}`);
    await db.exec(sql);
    await db.exec("rollback");
    return null;
  } catch (err) {
    await db.exec("rollback");
    return err;
  }
};
const n = await auditCount();
for (const [label, sql] of [["UPDATE", "update audit_logs set action = 'x'"], ["DELETE", "delete from audit_logs"], ["TRUNCATE", "truncate audit_logs"]]) {
  e = await asRole("service_role", sql);
  ok(`the service role cannot ${label} audit_logs (AU010)`, e?.code === "AU010", e?.message);
}
e = await asRole("service_role", "delete from audit_logs", "L7");
ok("…not even after declaring retention itself — the exception is the owner's", e?.code === "AU010", e?.message);
e = await asRole(null, "delete from audit_logs");
ok("the owner is refused too without a declared retention transaction", e?.code === "AU010", e?.message);
e = await asRole(null, "delete from audit_logs where action = 'invite.deleted'", "L7");
ok("the owner inside a declared retention transaction may delete (then rolled back)", e === null, e?.message);
ok("…and every row is still there", (await auditCount()) === n);
e = await asRole("service_role", `insert into audit_logs (org_id, action) values ('${ORG}', 'still.appends')`);
ok("the service role still APPENDS", e === null, e?.message);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
