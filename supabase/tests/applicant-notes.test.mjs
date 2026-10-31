// §9 P7 (HIRING-WORKFLOW-AUDIT-2026-10-31), migration 0535: the office's notes on an applicant —
// append-only, one pinned, kept in the carrier, moved by a roster merge, removed by the purge (that half
// is `purge-applicant.test.mjs`).
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
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
// Subjects are polymorphic (no FK), so any uuid stands in for a tractor, a trailer or a driver.
const UNIT = (await one(`select gen_random_uuid() id`)).id;


const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const driver = async (org, name) => (await one(`insert into drivers (org_id, full_name) values ($1, $2) returning id`, [org, name])).id;
const A = await driver(ORG, "Applicant A");
const A2 = await driver(ORG, "Applicant A (duplicate)");
const X = await driver(OTHER, "Someone else's applicant");
const INV = (await one(
  `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
   values ($1, $2, md5(random()::text), now() + interval '10 days') returning id`, [ORG, A])).id;

const note = (org, d, body = "Called 10/30, sends the SSN card Monday", inv = null) =>
  sqlstate(`insert into applicant_notes (org_id, driver_id, invitation_id, body, author_name) values ($1, $2, $3, $4, 'Dana')`,
    [org, d, inv, body]);
const idOf = async (body) => (await one(`select id from applicant_notes where body = $1`, [body])).id;

// ── writing ───────────────────────────────────────────────────────────────────────────────────
ok("a note on this carrier's applicant is written", (await note(ORG, A)) === null);
ok("a note during the live application is written", (await note(ORG, A, "Second note", INV)) === null);
ok("a note on another carrier's driver is refused (AN012)", (await note(ORG, X, "cross")) === "AN012");
ok("a note naming another applicant's invitation is refused (AN013)", (await note(ORG, A2, "wrong inv", INV)) === "AN013");
ok("an empty note is refused (23514)", (await note(ORG, A, "   ")) === "23514");

// ── append-only ───────────────────────────────────────────────────────────────────────────────
const N1 = await idOf("Called 10/30, sends the SSN card Monday");
const N2 = await idOf("Second note");
ok("a note's words are never edited (AN011)", (await sqlstate(`update applicant_notes set body = 'changed' where id = $1`, [N1])) === "AN011");
ok("its author is never edited (AN011)", (await sqlstate(`update applicant_notes set author_name = 'Eve' where id = $1`, [N1])) === "AN011");
ok("a note is never deleted (AN010)", (await sqlstate(`delete from applicant_notes where id = $1`, [N1])) === "AN010");

// ── pinning: one at the top ───────────────────────────────────────────────────────────────────
await db.query(`select public.set_applicant_note_pinned($1, $2, true)`, [ORG, N1]);
await db.query(`select public.set_applicant_note_pinned($1, $2, true)`, [ORG, N2]);
const pinned = (await db.query(`select id from applicant_notes where driver_id = $1 and pinned`, [A])).rows.map((r) => r.id);
ok("pinning a second note unpins the first — one at the top", pinned.length === 1 && pinned[0] === N2, JSON.stringify(pinned));
ok("another carrier cannot pin this note (AN020)",
  (await sqlstate(`select public.set_applicant_note_pinned($1, $2, true)`, [OTHER, N1])) === "AN020");
ok("a second pinned row is refused by the index too (23505)",
  (await sqlstate(`update applicant_notes set pinned = true where id = $1`, [N1])) === "23505");

// ── the roster merge moves notes, inside the carrier ──────────────────────────────────────────
ok("the merge's move to the canonical driver in this carrier is allowed",
  (await sqlstate(`update applicant_notes set driver_id = $1 where driver_id = $2`, [A2, A])) === null);
ok("a move to another carrier's driver is refused (AN012)",
  (await sqlstate(`update applicant_notes set driver_id = $1 where driver_id = $2`, [X, A2])) === "AN012");
ok("a driver with notes cannot be deleted out from under them (restrict, 23503)",
  (await sqlstate(`delete from drivers where id = $1`, [A2])) !== null);

// ── the API's only door ───────────────────────────────────────────────────────────────────────
const grants = (await db.query(
  `select privilege_type from information_schema.role_table_grants
    where table_name = 'applicant_notes' and grantee in ('anon','authenticated') and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')`)).rows;
const policies = Number((await one(`select count(*)::int n from pg_policies where tablename = 'applicant_notes'`)).n);
ok("RLS is on with no client policy — deny-all from a browser",
  policies === 0 && (await one(`select relrowsecurity r from pg_class where relname = 'applicant_notes'`)).r === true,
  JSON.stringify({ policies, grants }));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
