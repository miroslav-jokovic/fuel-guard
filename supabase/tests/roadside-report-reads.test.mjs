// Silvicom 360 — the officer's report is read, and can confirm the driver (migrations 0478 and 0479,
// INSPECTION-CHALLENGE-PLAN IC10, D-IC13, Q-IC11 (a)).
//
// 0478 and 0479 rewrite two CHECKs and add one table. A rewritten CHECK's risk is a word DROPPED from the old
// list, refused weeks later on an unrelated write — so §1 proves every old word still passes, beside the
// new one. §2 pins what a `report` attribution may and may not carry; §3 the link table's shape.
//
// Run: node supabase/tests/roadside-report-reads.test.mjs
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

// ── 1. The rewritten CHECKs keep every old word and take the new one ─────────────────────────────────
const SOURCE = (await one(`insert into document_sources (org_id, origin, storage_path, sha256, mime, byte_size, page_count)
  values ($1, 'upload', $2, repeat('b', 64), 'application/pdf', 10, 1) returning id`, [ORG, `${ORG}/s/source`])).id;
const readUnder = (profile) =>
  sqlstate(`insert into document_reads (org_id, source_id, profile, profile_version) values ($1, $2, $3, 'v')`, [ORG, SOURCE, profile]);
ok("document_reads takes the shipping document still", (await readUnder("shipping_document")) === null);
ok("document_reads takes the officer's report", (await readUnder("roadside_inspection_report")) === null);
ok("document_reads refuses a profile nobody registered", (await readUnder("fuel_receipt")) === "23514");

const attribution = (source, extra = {}) => {
  const cols = { org_id: ORG, inspection_id: INSP, source, engine_version: "ia-1", zone_method: "gps", location_check: "confirmed",
    outcome: "one_driver", samsara_driver_id: "s-1", samsara_driver_name: "MARKO PETROVIC", basis: "covering", confidence: "high", ...extra };
  const keys = Object.keys(cols);
  return sqlstate(`insert into inspection_attributions (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(cols));
};
const USER = (await one(`insert into auth.users (email) values ('safety@example.test') returning id`)).id;
ok("an engine reading still writes", (await attribution("engine")) === null);
ok("a person's decision still writes", (await attribution("person", { decided_by: USER })) === null);
ok("a report confirmation writes, naming our driver and no decider", (await attribution("report", { driver_id: USER })) === null);
ok("an attribution source nobody named is refused", (await attribution("guess")) === "23514");

// ── 2. A `report` row is nobody's decision ───────────────────────────────────────────────────────────
// Q-IC11 (a): the engine confirms when two readers and Samsara agree. A decider on it would say a person
// looked, and the page would show their name over a confirmation nobody made.
ok("a report confirmation carrying a decider is refused", (await attribution("report", { decided_by: USER })) === "23514");

// ── 3. The link: once per document, append-only, and only to the org's own inspection ────────────────
const DOC = (await one(`select gen_random_uuid() id`)).id;
const link = (org, insp, doc, sha = "c".repeat(64)) =>
  sqlstate(`insert into inspection_report_reads (org_id, inspection_id, document_id, sha256) values ($1, $2, $3, $4)`, [org, insp, doc, sha]);
ok("a report's link writes", (await link(ORG, INSP, DOC)) === null);
ok("the same document is linked once", (await link(ORG, INSP, DOC)) === "23505");
ok("a link to another org's inspection is refused", (await link(ORG, FOREIGN_INSP, (await one(`select gen_random_uuid() id`)).id)) === "23503");
ok("a sha256 that is not one is refused", (await link(ORG, INSP, (await one(`select gen_random_uuid() id`)).id, "nope")) === "23514");
ok("a link is never rewritten", (await sqlstate(`update inspection_report_reads set sha256 = repeat('d', 64) where document_id = $1`, [DOC])) === "IA010");
ok("a link is never deleted", (await sqlstate(`delete from inspection_report_reads where document_id = $1`, [DOC])) === "IA010");
ok("RLS is on, with no client policy", (await one(`select relrowsecurity r from pg_class where oid = 'public.inspection_report_reads'::regclass`)).r === true
  && (await one(`select count(*)::int n from pg_policies where tablename = 'inspection_report_reads'`)).n === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
