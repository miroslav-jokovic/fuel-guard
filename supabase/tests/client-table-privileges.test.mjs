// Silvicom 360 — the browser's roles cannot run the table statements RLS does not govern (migration 0413,
// database audit 2026-10-03, finding C).
//
// What can be wrong is that the exposure survives in a form nobody looks at:
//
//   · TRUNCATE IGNORES ROW-LEVEL SECURITY. A policy matrix proves every SELECT, INSERT, UPDATE and
//     DELETE is fenced and says nothing about this statement, so `rls.test.mjs` (612 assertions) passes
//     on a database where `anon` can empty any table. The first case below RUNS the statement as
//     `anon` and `authenticated` against a populated table, so it fails before 0413 and passes after.
//   · MAINTAIN HAS NO CLEAN STATEMENT PROBE. A non-owner's ANALYZE without it WARNS instead of failing, and
//     LOCK TABLE stays reachable through the UPDATE/DELETE grants this migration keeps on purpose, so
//     MAINTAIN is asserted from the ACL (`has_table_privilege`, and the catalog case), not by a statement.
//   · THE CLEANUP ROTS WITHOUT A DEFAULT. Revoking on the 198 relations that exist leaves the next table
//     born with all eight privileges, because Supabase's default ACL for postgres in `public` grants
//     them. The sentinel case CREATES a table after every migration and reads its ACL.
//   · A REVOKE MUST NOT TAKE THE WORKING PATH WITH IT. SELECT, INSERT, UPDATE and DELETE stay (RLS governs
//     them, and `anon` needing none of them is a separate review), and `service_role` keeps all eight.
//     Both are asserted, or a too-wide revoke would pass as "even safer".
//   · THE CLASS, NOT THE TABLE. The catalog case lists every public relation that gives a client role a
//     privilege outside the four it may hold, so a later migration that grants one back fails here.
//
// Run:  node supabase/tests/client-table-privileges.test.mjs
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
`);

for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}


const CLIENT = ["anon", "authenticated"];
const FORBIDDEN = ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];
const ALLOWED = ["DELETE", "INSERT", "SELECT", "UPDATE"];

// ── The statement itself, on a populated table, as each client role ─────────────────────────────
await db.exec(`create table public.zz_probe (id int primary key, v text);
               insert into public.zz_probe values (1, 'kept'), (2, 'kept');
               alter table public.zz_probe enable row level security;`);
const probeRows = async () => Number((await one(`select count(*)::int n from public.zz_probe`)).n);
for (const role of CLIENT) {
  await db.exec(`begin; set local role ${role}`);
  const e = await throws(`truncate table public.zz_probe`);
  await db.exec("commit");
  ok(`${role} cannot TRUNCATE a table (a statement row-level security does not govern)`,
    /permission denied for table/i.test(e ?? ""), String(e));
  ok(`the rows survive a refused TRUNCATE by ${role}`, (await probeRows()) === 2, String(await probeRows()));
}
// MAINTAIN is proven by its ACL entry (the class case below), not by running a statement: a non-owner's
// ANALYZE without the privilege raises a WARNING ("skipping it"), not an error, and LOCK TABLE stays
// reachable through the UPDATE/DELETE grants that are kept on purpose — a statement probe would pass
// or fail for reasons that have nothing to do with MAINTAIN.
for (const role of CLIENT) {
  const m = await one(`select has_table_privilege('${role}', 'public.zz_probe', 'MAINTAIN') m`);
  ok(`${role} does not hold MAINTAIN`, m.m === false, JSON.stringify(m));
}
await db.exec("begin; set local role service_role");
const svc = await one(`select count(*)::int n from public.zz_probe`);
const svcTruncate = await throws("truncate table public.zz_probe");
await db.exec("commit");
ok("service_role can still read and TRUNCATE (the API's role is not locked out)",
  svc.n === 2 && svcTruncate === null && (await probeRows()) === 0, `${JSON.stringify(svc)} ${svcTruncate}`);

// ── The privileges that are meant to stay ───────────────────────────────────────────────────────
const held = async (role, rel) => (await all(
  `select a.privilege_type p from pg_class c, aclexplode(c.relacl) a
    where c.oid = $2::regclass and a.grantee = $1::regrole order by 1`, [role, rel])).map((r) => r.p);
for (const role of CLIENT) {
  const p = await held(role, "public.zz_probe");
  ok(`${role} keeps exactly SELECT, INSERT, UPDATE and DELETE on an existing table`,
    JSON.stringify(p) === JSON.stringify(ALLOWED), JSON.stringify(p));
}
const svcAcl = await held("service_role", "public.zz_probe");
ok("service_role keeps all eight privileges", svcAcl.length === 8, JSON.stringify(svcAcl));

// ── A table created NOW is born the same way (the default, not just the revoke) ─────────────────
await db.exec(`create table public.zz_born (id int)`);
for (const role of CLIENT) {
  const p = await held(role, "public.zz_born");
  ok(`${role} is not granted a destructive privilege on a table created after 0413`,
    FORBIDDEN.every((f) => !p.includes(f)) && JSON.stringify(p) === JSON.stringify(ALLOWED), JSON.stringify(p));
}
const bornSvc = await held("service_role", "public.zz_born");
ok("service_role still gets all eight on a table created after 0413", bornSvc.length === 8, JSON.stringify(bornSvc));

// ── The class: no public relation lets a client role past the four it may hold ──────────────────
const stray = await all(
  `select c.relname || ':' || pg_get_userbyid(a.grantee) || ':' || a.privilege_type s
     from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
      and (a.grantee in ('anon'::regrole, 'authenticated'::regrole) or a.grantee = 0)
      and a.privilege_type = any ($1) order by 1`, [FORBIDDEN]);
ok("no public table or view grants TRUNCATE, REFERENCES, TRIGGER or MAINTAIN to a client role or PUBLIC",
  stray.length === 0, `first: ${JSON.stringify(stray.slice(0, 5).map((r) => r.s))} (${stray.length})`);
// The revoke on the relations that EXISTED when 0413 ran must not have taken the working four with it.
// `zz_probe` above is created after the migration and so exercises the default, not the revoke; this
// case reads the production-shaped tables the migrations built.
const short = await all(
  `select c.relname, pg_get_userbyid(r.oid) role, array_agg(a.privilege_type order by a.privilege_type) have
     from pg_class c
     cross join (select oid from pg_roles where rolname in ('anon', 'authenticated')) r
     left join lateral (select (aclexplode(c.relacl)).* ) a on a.grantee = r.oid
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v')
      and c.relname not like 'zz\\_%'
    group by 1, 2
   having array_agg(a.privilege_type order by a.privilege_type) <> $1::text[] order by 1, 2`, [ALLOWED]);
ok("every pre-existing public relation still gives anon and authenticated exactly SELECT, INSERT, UPDATE, DELETE",
  short.length === 0, `first: ${JSON.stringify(short.slice(0, 3))} (${short.length})`);
const svcShort = await all(
  `select c.relname, count(a.privilege_type)::int n
     from pg_class c
     left join lateral (select (aclexplode(c.relacl)).* ) a on a.grantee = 'service_role'::regrole
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v') and c.relname not like 'zz\\_%'
    group by 1 having count(a.privilege_type) <> 8 order by 1`);
ok("every pre-existing public relation still gives service_role all eight privileges (the API is not locked out)",
  svcShort.length === 0, `first: ${JSON.stringify(svcShort.slice(0, 3))} (${svcShort.length})`);
const total = Number((await one(
  `select count(*)::int n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v')`)).n);
ok("the catalog case is not vacuous: the schema has relations to inspect", total > 150, String(total));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
