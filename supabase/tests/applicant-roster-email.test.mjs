// Silvicom 360 — an office email correction moves the roster's email, through the roster's own function
// (migration 0594, APPLICATION-FIX-PLAN Q-AM16 (a)).
//
// The rules worth proving are the refusals: the function must never overwrite an email set on the roster
// since, never touch a hired driver, a filed application or another org's row. Each "no" answers false.
//
// Run:  node supabase/tests/applicant-roster-email.test.mjs
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
const code = async (q, p = []) => {
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
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const applicant = async (email, status = "applicant", org = ORG) => {
  const driver = (await one(`insert into drivers (org_id, full_name, status, email) values ($1, 'Applicant', $2, $3) returning id`, [org, status, email])).id;
  const inv = (await one(
    `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
       values ($1, $2, md5(random()::text), now() + interval '14 days') returning id`, [org, driver],
  )).id;
  return { driver, inv };
};
const move = async (inv, from, to, org = ORG) =>
  (await one(`select public.move_applicant_roster_email($1, $2, $3, $4) as moved`, [org, inv, from, to])).moved;
const emailOf = async (driver) => (await one(`select email from drivers where id = $1`, [driver])).email;

{
  const { driver, inv } = await applicant("old@example.com");
  ok("moves the roster's email when it still holds the corrected address", (await move(inv, "old@example.com", "new@example.com")) === true
    && (await emailOf(driver)) === "new@example.com");
}
{
  const { driver, inv } = await applicant("  OLD@Example.com ");
  ok("…compared without case or spaces, as the invitation's own move is", (await move(inv, "old@example.com", " new@example.com ")) === true
    && (await emailOf(driver)) === "new@example.com");
}
{
  const { driver, inv } = await applicant(null);
  ok("fills a roster row that had no email", (await move(inv, "old@example.com", "new@example.com")) === true && (await emailOf(driver)) === "new@example.com");
}
{
  const { driver, inv } = await applicant("roster@example.com");
  ok("⚠ never overwrites an email somebody set on the roster since", (await move(inv, "old@example.com", "new@example.com")) === false
    && (await emailOf(driver)) === "roster@example.com");
}
{
  const { driver, inv } = await applicant("old@example.com", "active");
  ok("⚠ never moves a hired driver's email — the roster's own business then", (await move(inv, "old@example.com", "new@example.com")) === false
    && (await emailOf(driver)) === "old@example.com");
}
{
  const { driver, inv } = await applicant("old@example.com");
  await db.query(`update application_invitations set submitted_at = now() where id = $1`, [inv]);
  ok("never moves once the application is filed (Q-AM2)", (await move(inv, "old@example.com", "new@example.com")) === false
    && (await emailOf(driver)) === "old@example.com");
}
{
  const { driver, inv } = await applicant("old@example.com");
  ok("never reaches another org's applicant", (await move(inv, "old@example.com", "new@example.com", OTHER)) === false
    && (await emailOf(driver)) === "old@example.com");
  ok("refuses a blank address (RE001)", (await code(`select public.move_applicant_roster_email($1,$2,$3,$4)`, [ORG, inv, "old@example.com", "  "])) === "RE001");
}
{
  const can = async (role) => (await one(`select has_function_privilege($1, 'public.move_applicant_roster_email(uuid,uuid,text,text)', 'execute') c`, [role])).c;
  ok("the api may call it, a browser may not", (await can("service_role")) === true && (await can("anon")) === false && (await can("authenticated")) === false);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
