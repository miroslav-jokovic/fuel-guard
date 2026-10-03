// Silvicom 360 — a service-role-only SECURITY DEFINER function is service-role-only (migration 0411),
// and a function created from now on is closed to clients by default (migration 0412). Security audit
// 2026-10-02.
//
// What can be wrong is that the intent was written and never took effect:
//
//   · `revoke … from public` DOES NOTHING ON SUPABASE. The platform's default privileges grant EXECUTE
//     on every new function in `public` straight to `anon`, `authenticated` and `service_role`
//     (`pg_default_acl`: `postgres=X, anon=X, authenticated=X, service_role=X`), so there is no PUBLIC
//     entry left to revoke. 0178, 0250, 0253 and 0320 each wrote `revoke all … from public; grant
//     execute … to service_role;` and left both RPCs callable at /rest/v1/rpc/ by anyone holding the
//     anon key, with the org a body parameter and no caller check inside.
//   · A PGlite database without those default privileges hides it. Roles there start with nothing, so
//     "anon cannot execute" passes before the fix as well. This matrix reproduces the platform's
//     function default ACL FIRST, then applies every migration, so the assertions can fail.
//   · THE DOCUMENTED DEFAULT-PRIVILEGE RECIPE IS A NO-OP FOR PUBLIC. Supabase's "Securing your API" page
//     scopes `revoke execute on functions from public` to `in schema public`; PostgreSQL's built-in
//     function default is not stored per schema, so that statement removes nothing (tested on PGlite
//     2026-10-02: a new function came out `acl = null` and anon could still run it). 0412 uses the
//     GLOBAL form. The sentinel cases below CREATE a function after every migration and read the
//     catalog, so a regression to the schema-scoped form fails here instead of passing silently.
//   · A GLOBAL REVOKE REACHES EVERY SCHEMA. `extensions` and `partman` must keep PUBLIC execute or the
//     next `create extension` run by postgres yields functions nobody can call.
//   · ONE FIXED FUNCTION IS NOT A FIXED CLASS. The catalog case lists every SECURITY DEFINER,
//     non-trigger function a client role can execute and compares it to a named allowlist: the RLS
//     helpers, which policies call as the requesting role and which therefore MUST stay executable.
//     The next definer function that forgets the `anon` revoke fails here, in CI, instead of in a
//     review a year later.
//
// Run:  node supabase/tests/definer-rpc-grants.test.mjs
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
const all = async (q, p = []) => (await db.query(q, p)).rows;
const throws = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.message; }
};

// The platform's default privileges, as `select * from pg_default_acl` shows them on production —
// functions included, which is the half the other matrices leave out.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text,
    name text, owner uuid, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
  create schema if not exists extensions; create schema if not exists partman;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);

for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

// ── Both RPCs: by NAME, so an overload added later is covered too ───────────────────────────────
const RPCS = ["sync_fuel_exceptions", "bump_card_write_counter"];
for (const name of RPCS) {
  const sigs = await all(
    `select p.oid::regprocedure::text sig,
            has_function_privilege('anon', p.oid, 'execute') anon,
            has_function_privilege('authenticated', p.oid, 'execute') auth,
            has_function_privilege('service_role', p.oid, 'execute') svc
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`, [name]);
  ok(`${name} exists, so the grant checks below are not vacuous`, sigs.length >= 1, JSON.stringify(sigs));
  ok(`${name}: anon cannot execute any overload`, sigs.every((s) => s.anon === false), JSON.stringify(sigs));
  ok(`${name}: authenticated cannot execute any overload`, sigs.every((s) => s.auth === false), JSON.stringify(sigs));
  ok(`${name}: service_role can execute every overload`, sigs.every((s) => s.svc === true), JSON.stringify(sigs));
}

// ── The attempt itself, as the role PostgREST would run it ──────────────────────────────────────
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier A') returning id`)).id;
const USER = (await one(`insert into auth.users (email) values ('a@carrier.test') returning id`)).id;
const counters = async () => Number((await one(`select count(*)::int n from card_write_counters`)).n);

for (const role of ["anon", "authenticated"]) {
  await db.exec(`begin; set local role ${role}`);
  const e = await throws(
    `select * from public.bump_card_write_counter($1, $2, 'card_override', 25)`, [ORG, USER]);
  // COMMIT, not ROLLBACK: a refused call has aborted the transaction, so COMMIT rolls it back anyway —
  // but a call that WAS allowed would keep its row, which is what the zero-rows case below needs to see.
  await db.exec("commit");
  ok(`${role} calling bump_card_write_counter is refused with a permission error`,
    /permission denied for function/i.test(e ?? ""), String(e));
}
ok("a refused bump_card_write_counter wrote no counter row", (await counters()) === 0, String(await counters()));

for (const role of ["anon", "authenticated"]) {
  await db.exec(`begin; set local role ${role}`);
  const e = await throws(
    `select * from public.sync_fuel_exceptions($1, null, '[]'::jsonb, null, array['x'], '2026-09-01', '2026-09-30')`, [ORG]);
  await db.exec("rollback");
  ok(`${role} calling sync_fuel_exceptions is refused with a permission error`,
    /permission denied for function/i.test(e ?? ""), String(e));
}

// ── The API's own path still works: the revoke must not have taken the service role with it ─────
await db.exec("begin; set local role service_role");
const bump = await one(`select * from public.bump_card_write_counter($1, $2, 'card_override', 25)`, [ORG, USER]);
const sync = await one(
  `select * from public.sync_fuel_exceptions($1, null, '[]'::jsonb, null, array['x'], '2026-09-01', '2026-09-30')`, [ORG]);
await db.exec("commit");
ok("service_role still gets a counter slot from bump_card_write_counter",
  bump?.allowed === true && bump?.used === 1 && (await counters()) === 1, JSON.stringify(bump));
ok("service_role still runs sync_fuel_exceptions end to end",
  sync != null && sync.inserted === 0 && sync.refreshed === 0 && sync.closed === 0, JSON.stringify(sync));

// ── The class: every client-executable definer function is on the allowlist, and only those ─────
// The RLS helpers. Policies evaluate them as the requesting role, so revoking EXECUTE would deny every
// row on every table that uses them. Each one reads the caller's own JWT claims and takes no org
// argument, which is the property that makes it safe to leave callable.
const RLS_HELPERS = ["auth_dispatched_load_ids", "auth_driver_id", "auth_in_thread", "auth_module_enabled"];
const exposed = (await all(
  `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' sig, p.proname
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
    order by 1`));
const stray = exposed.filter((r) => !RLS_HELPERS.includes(r.proname)).map((r) => r.sig);
ok("no SECURITY DEFINER function outside the RLS helpers is executable by anon or authenticated",
  stray.length === 0, `stray: ${JSON.stringify(stray)}`);
const missing = RLS_HELPERS.filter((h) => !exposed.some((r) => r.proname === h));
ok("every allowlisted RLS helper still exists and is executable (the allowlist is not stale)",
  missing.length === 0, `gone or revoked: ${JSON.stringify(missing)}`);

// ── Default-deny (0412): a function created NOW is born closed ──────────────────────────────────
// Created as the migration role, after every migration, in the three schemas production has. The
// platform's explicit `in schema public` grants to anon/authenticated/service_role are in place from
// the harness setup above, exactly as on production, so only 0412 can account for the difference.
const born = {};
for (const sch of ["public", "extensions", "partman"]) {
  await db.exec(`create function ${sch}.born_sentinel() returns int language sql as $$ select 1 $$`);
  born[sch] = await one(
    `select has_function_privilege('anon', $1::regprocedure, 'execute') anon,
            has_function_privilege('authenticated', $1::regprocedure, 'execute') auth,
            has_function_privilege('service_role', $1::regprocedure, 'execute') svc,
            exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') pub`,
    [`${sch}.born_sentinel()`]);
}
ok("a new function in public is not executable by anon", born.public.anon === false, JSON.stringify(born.public));
ok("a new function in public is not executable by authenticated", born.public.auth === false, JSON.stringify(born.public));
ok("a new function in public carries no PUBLIC execute entry (the global revoke took effect)",
  born.public.pub === false, JSON.stringify(born.public));
ok("a new function in public is still executable by service_role (the API's role is not locked out)",
  born.public.svc === true, JSON.stringify(born.public));
ok("a new function in extensions keeps PUBLIC execute (create extension keeps working)",
  born.extensions.pub === true && born.extensions.anon === true, JSON.stringify(born.extensions));
ok("a new function in partman keeps PUBLIC execute", born.partman.pub === true, JSON.stringify(born.partman));

// An explicit grant is the one way a function becomes client-callable — and it works.
await db.exec(`grant execute on function public.born_sentinel() to authenticated`);
const granted = await one(
  `select has_function_privilege('authenticated', 'public.born_sentinel()', 'execute') auth,
          has_function_privilege('anon', 'public.born_sentinel()', 'execute') anon`);
ok("an explicit grant to authenticated opens exactly authenticated, not anon",
  granted.auth === true && granted.anon === false, JSON.stringify(granted));

// The unguarded form: migrations must still apply where the extra schemas do not exist. The other
// ~70 matrices apply every migration without `extensions`/`partman`, so a guard that raised would fail
// them all; this case states the property where a reader will look for it.
const m0412 = MIGRATIONS.find((f) => f.startsWith("0412_"));
ok("0412 guards its in-schema grants on the schema existing",
  m0412 != null && /if exists \(select 1 from pg_namespace where nspname = s\)/.test(read(join("migrations", m0412))),
  String(m0412));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
