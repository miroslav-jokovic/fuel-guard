// Silvicom 360 — questions the carrier writes itself, stamped on each invitation at its first Send (0567).
//
// HIRING-WORKFLOW-AUDIT-2026-10-31 §15.3, D-CQ1..D-CQ5; owner's ruling on Q-RS2. What only the database can answer:
//
//  1. A question is retired, never deleted (CQ010); what it asks — wording, kind, choices — never changes
//     (CQ011); retiring is one-way (CQ012); the hint, `required` and the place stay editable.
//  2. At most 20 live per carrier (CQ013), and a retired one frees its place; another carrier's do not count.
//  3. Only a one-of-a-list question has choices, 2..20 of 1..80 characters (D-CQ5).
//  4. `send_application_invitation` stamps the set on the FIRST Send only; the 5-argument call still resolves
//     and stamps nothing; the stamp is an array of at most 20; the function is the service role's only.
//
// Run:  node supabase/tests/recruiting-carrier-questions.test.mjs
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
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const drv = (await one(`insert into drivers (org_id, full_name, status) values ($1, 'Applicant', 'applicant') returning id`, [ORG])).id;

const add = (org, wording, kind = "text", choices = null) => sqlstate(
  `insert into recruiting_carrier_questions (org_id, wording, kind, choices) values ($1, $2, $3, $4)`, [org, wording, kind, choices]);
const addId = async (org, wording, kind = "text", choices = null) => (await one(
  `insert into recruiting_carrier_questions (org_id, wording, kind, choices) values ($1, $2, $3, $4) returning id`,
  [org, wording, kind, choices])).id;

// ── 1. frozen, retired never deleted ──────────────────────────────────────────────────────────
const Q = await addId(ORG, "Which terminal would you report to?", "select", ["Melrose Park", "Joliet"]);
ok("a question is never deleted (CQ010)", (await sqlstate(`delete from recruiting_carrier_questions where id = $1`, [Q])) === "CQ010");
ok("its wording never changes (CQ011)", (await sqlstate(`update recruiting_carrier_questions set wording = 'Where?' where id = $1`, [Q])) === "CQ011");
ok("its kind never changes (CQ011)", (await sqlstate(`update recruiting_carrier_questions set kind = 'text', choices = null where id = $1`, [Q])) === "CQ011");
const SHORT = await addId(OTHER, "Your CB handle?");
ok("…even between two kinds that both take no choices (CQ011)",
  (await sqlstate(`update recruiting_carrier_questions set kind = 'longtext' where id = $1`, [SHORT])) === "CQ011");
ok("its choices never change (CQ011)", (await sqlstate(`update recruiting_carrier_questions set choices = array['Melrose Park','Gary'] where id = $1`, [Q])) === "CQ011");
ok("its hint, whether it is required and its place stay editable",
  (await sqlstate(`update recruiting_carrier_questions set hint = 'Closest to home', required = true, position = 3 where id = $1`, [Q])) === null);
ok("it can be retired", (await sqlstate(`update recruiting_carrier_questions set retired_at = now() where id = $1`, [Q])) === null);
ok("retiring is one-way (CQ012)", (await sqlstate(`update recruiting_carrier_questions set retired_at = null where id = $1`, [Q])) === "CQ012");

// ── 2. at most 20 live ────────────────────────────────────────────────────────────────────────
for (let i = 1; i <= 19; i++) await addId(ORG, `Question ${i}`);
const twentieth = await addId(ORG, "Question 20");
ok("the twenty-first live question is refused (CQ013)", (await add(ORG, "Question 21")) === "CQ013");
ok("another carrier's twenty do not count against this one", (await add(OTHER, "Theirs")) === null);
await db.query(`update recruiting_carrier_questions set retired_at = now() where id = $1`, [twentieth]);
ok("retiring one frees its place", (await add(ORG, "Question 21")) === null);

// ── 3. choices ────────────────────────────────────────────────────────────────────────────────
ok("a one-of-a-list question needs at least two choices (23514)", (await add(OTHER, "Pick", "select", ["Only"])) === "23514");
ok("…and has no more than twenty", (await add(OTHER, "Pick", "select", Array.from({ length: 21 }, (_, i) => `c${i}`))) === "23514");
ok("…none blank", (await add(OTHER, "Pick", "select", ["Yes", "  "])) === "23514");
ok("…none longer than 80", (await add(OTHER, "Pick", "select", ["Yes", "x".repeat(81)])) === "23514");
ok("…and twenty is allowed", (await add(OTHER, "Pick", "select", Array.from({ length: 20 }, (_, i) => `c${i}`))) === null);
ok("any other kind has no choices", (await add(OTHER, "Name", "text", ["a", "b"])) === "23514");
ok("a kind outside the six is refused", (await add(OTHER, "Upload", "file")) === "23514");
ok("…and so is the questionnaire's grid, which no settings box can describe", (await add(OTHER, "References", "table")) === "23514");
ok("wording longer than 300 is refused", (await add(OTHER, "x".repeat(301))) === "23514");
ok("blank wording is refused", (await add(OTHER, "   ")) === "23514");

// ── 4. the stamp at first Send ────────────────────────────────────────────────────────────────
const inv = (await one(`insert into application_invitations (org_id, driver_id, token_hash, expires_at)
  values ($1, $2, md5(random()::text), now() + interval '14 days') returning id`, [ORG, drv])).id;
const STAMP = JSON.stringify([{ id: Q, wording: "Which terminal would you report to?", hint: null, kind: "select", choices: ["Melrose Park", "Joliet"], required: true }]);
const stampOf = async () => (await one(`select carrier_questions c from application_invitations where id = $1`, [inv])).c;
ok("the first Send stamps the set", (await sqlstate(
  `select public.send_application_invitation($1, $2, 'h1', 14, null, $3::jsonb)`, [ORG, inv, STAMP])) === null
  && (await stampOf())?.[0]?.id === Q);
ok("a resend never restamps", (await sqlstate(
  `select public.send_application_invitation($1, $2, 'h2', 14, null, '[]'::jsonb)`, [ORG, inv])) === null
  && (await stampOf())?.length === 1);
const inv2 = (await one(`insert into application_invitations (org_id, driver_id, token_hash, expires_at)
  values ($1, $2, md5(random()::text), now() + interval '14 days') returning id`, [ORG, drv])).id;
ok("the 5-argument call served before CQ2 still resolves and stamps nothing", (await sqlstate(
  `select public.send_application_invitation($1, $2, 'h3', 14, array['q1'])`, [ORG, inv2])) === null
  && (await one(`select carrier_questions c from application_invitations where id = $1`, [inv2])).c === null);
ok("a stamp that is not an array is refused (23514)", (await sqlstate(
  `update application_invitations set carrier_questions = '{}'::jsonb where id = $1`, [inv2])) === "23514");
ok("a stamp of more than 20 is refused (23514)", (await sqlstate(
  `update application_invitations set carrier_questions = (select jsonb_agg(i) from generate_series(1, 21) i) where id = $1`, [inv2])) === "23514");

const SIG = "public.send_application_invitation(uuid,uuid,text,int,text[],jsonb)";
const g = await one(`select has_function_privilege('anon', '${SIG}', 'execute') a,
  has_function_privilege('authenticated', '${SIG}', 'execute') u, has_function_privilege('service_role', '${SIG}', 'execute') s`);
ok("the widened function is the service role's only", !g.a && !g.u && g.s);
ok("the 5-argument function is gone, so a call cannot be ambiguous",
  (await one(`select count(*)::int n from pg_proc where proname = 'send_application_invitation'`)).n === 1);
ok("the table is under row-level security", (await one(
  `select relrowsecurity r from pg_class where relname = 'recruiting_carrier_questions'`)).r === true);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
