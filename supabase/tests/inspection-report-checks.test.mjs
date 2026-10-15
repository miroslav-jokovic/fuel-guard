// Silvicom 360 — what an officer's report said against the record (migration 0480, INSPECTION-CHALLENGE-PLAN
// IC10, D-IC13, Q-IC11 (a)). Pins the row's own promises: a `confirmed` check names the attribution it wrote
// and nothing else does, agreement always names a driver, one check per report per version, append-only.
//
// Run: node supabase/tests/inspection-report-checks.test.mjs
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

const check = (o = {}) => {
  const cols = { org_id: ORG, inspection_id: INSP, document_id: crypto.randomUUID(), read_id: crypto.randomUUID(), check_version: "ic10.1",
    outcome: "needs_review", reasons: ["licence_not_on_roster"], ...o };
  const keys = Object.keys(cols);
  return sqlstate(`insert into inspection_report_checks (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(cols));
};
const DRIVER = crypto.randomUUID();
const ATTR = crypto.randomUUID();

ok("a check that needs a person writes", (await check()) === null);
ok("a confirmation writes with its attribution and driver", (await check({ outcome: "confirmed", driver_id: DRIVER, attribution_id: ATTR, reasons: [] })) === null);
ok("⚠ a confirmation without the attribution it wrote is refused", (await check({ outcome: "confirmed", driver_id: DRIVER, reasons: [] })) === "23514");
ok("⚠ an attribution on a check that did not confirm is refused", (await check({ outcome: "agrees", driver_id: DRIVER, attribution_id: ATTR })) === "23514");
ok("⚠ agreement without a driver to agree on is refused", (await check({ outcome: "agrees", reasons: [] })) === "23514");
ok("an outcome nobody named is refused", (await check({ outcome: "maybe" })) === "23514");
ok("a whole licence number does not fit where its last four go", (await check({ licence_last4: "P12345678901" })) === "23514");
const DOC = crypto.randomUUID();
ok("one check per report per version", (await check({ document_id: DOC })) === null && (await check({ document_id: DOC })) === "23505");
ok("a new version checks the same report again, beside the old", (await check({ document_id: DOC, check_version: "ic10.2" })) === null);
ok("a check of another org's inspection is refused", (await check({ inspection_id: FOREIGN_INSP })) === "23503");
ok("a check is never rewritten", (await sqlstate(`update inspection_report_checks set outcome = 'agrees' where document_id = $1`, [DOC])) === "IA010");
ok("a check is never deleted", (await sqlstate(`delete from inspection_report_checks where document_id = $1`, [DOC])) === "IA010");
ok("RLS is on, with no client policy", (await one(`select relrowsecurity r from pg_class where oid = 'public.inspection_report_checks'::regclass`)).r === true
  && (await one(`select count(*)::int n from pg_policies where tablename = 'inspection_report_checks'`)).n === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
