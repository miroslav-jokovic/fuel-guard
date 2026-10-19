// Silvicom 360 — what the safety office did about a roadside ticket's court result (migration 0489,
// INSPECTION-CHALLENGE-PLAN IC4, R-ADJ1). Pins the row's promises: a request carries its day to follow up and
// "not contested" none, the action is one of two, the ticket belongs to the inspection's org, a person is named,
// and the record is append-only with no client policy.
//
// Run: node supabase/tests/inspection-citation-actions.test.mjs

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
const inspectionOf = async (org) =>
  (await one(
    `with r as (insert into fmcsa_fetch_runs (org_id, dataset, dot_number, started_at, outcome, complete)
       values ($1, 'fx4q-ay7w', '1', now(), 'succeeded', true) returning id),
     raw as (insert into fmcsa_raw_rows (org_id, fetch_run_id, dataset, natural_key, version, kind, payload, sha256)
       select $1, id, 'fx4q-ay7w', gen_random_uuid()::text, 1, 'present', '{}'::jsonb, repeat('a', 64) from r returning id)
     insert into roadside_inspections (org_id, fmcsa_inspection_id, raw_row_id)
       select $1, (random() * 1e12)::bigint, id from raw returning id`,
    [org],
  )).id;
const INSP = await inspectionOf(ORG);
const FOREIGN_INSP = await inspectionOf(OTHER);
const violationOf = async (org, insp) =>
  (await one(
    `insert into roadside_violations (org_id, inspection_id, fmcsa_violation_id, raw_row_id, citation_number)
     select $1, $2, (random() * 1e12)::bigint, raw_row_id, 'E061' from roadside_inspections where id = $2 returning id`,
    [org, insp],
  )).id;
const VIOL = await violationOf(ORG, INSP);
const FOREIGN_VIOL = await violationOf(OTHER, FOREIGN_INSP);
const USER = crypto.randomUUID();

const act = (o = {}) => {
  const cols = { org_id: ORG, inspection_id: INSP, violation_id: VIOL, action: "requested_from_court", follow_up_on: "2026-11-18", note: "Will County court", acted_by: USER, ...o };
  const keys = Object.keys(cols);
  return sqlstate(`insert into inspection_citation_actions (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(cols));
};

ok("a request to the court, with its day to follow up, is recorded", (await act()) === null);
ok("a ticket not contested is recorded, with no day to follow up", (await act({ action: "not_contested", follow_up_on: null })) === null);
ok("⚠ a request without a day to follow up is refused", (await act({ follow_up_on: null })) === "23514");
ok("⚠ 'not contested' with a day to follow up is refused", (await act({ action: "not_contested" })) === "23514");
ok("an action outside the two is refused", (await act({ action: "dismissed" })) === "23514");
ok("an act with nobody behind it is refused", (await act({ acted_by: null })) === "23502");
ok("a note past 1,000 characters is refused", (await act({ note: "x".repeat(1001) })) === "23514");
ok("another org's ticket under our inspection is refused", (await act({ violation_id: FOREIGN_VIOL })) === "23503");
ok("our ticket under another org's inspection is refused", (await act({ inspection_id: FOREIGN_INSP })) === "23503");
ok("an act is never rewritten", (await sqlstate(`update inspection_citation_actions set note = 'x' where violation_id = $1`, [VIOL])) === "IA010");
ok("an act is never deleted", (await sqlstate(`delete from inspection_citation_actions where violation_id = $1`, [VIOL])) === "IA010");
ok("RLS is on, with no client policy", (await one(`select relrowsecurity r from pg_class where oid = 'public.inspection_citation_actions'::regclass`)).r === true
  && (await one(`select count(*)::int n from pg_policies where tablename = 'inspection_citation_actions'`)).n === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
