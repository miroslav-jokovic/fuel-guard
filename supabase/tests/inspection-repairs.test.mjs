// Silvicom 360 — the repair record of a roadside inspection's vehicle violations (migration 0482, INSPECTION-CHALLENGE-
// PLAN IC11, D-IC14; Q-IC13, Q-IC14). Pins the row's promises: the engine proposes and only a person accepts, an
// accepted repair names its work order, "outside FleetPal" says where, the unit belongs to the inspection's org, append-only.
//
// Run: node supabase/tests/inspection-repairs.test.mjs
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
const unitOf = async (org, insp) =>
  (await one(
    `insert into roadside_inspection_units (org_id, inspection_id, fmcsa_unit_id, raw_row_id, match_method)
       select $1, $2, (random() * 1e12)::bigint, raw_row_id, 'none' from roadside_inspections where id = $2 returning id`,
    [org, insp],
  )).id;
const UNIT = await unitOf(ORG, INSP);
const FOREIGN_UNIT = await unitOf(OTHER, FOREIGN_INSP);
const HASH = "a".repeat(64);
const USER = crypto.randomUUID();

const repair = (o = {}) => {
  const cols = { org_id: ORG, inspection_id: INSP, inspection_unit_id: UNIT, source: "engine", engine_version: "ic11.1",
    outcome: "one_candidate", due_on: "2026-10-28", candidates: JSON.stringify([{ workOrderId: "wo1" }]), candidates_sha256: HASH, ...o };
  const keys = Object.keys(cols);
  return sqlstate(`insert into inspection_repairs (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(cols));
};
const person = (o = {}) => repair({ source: "person", decided_by: USER, candidates_sha256: null, candidates: "[]", ...o });

ok("an engine proposal writes", (await repair()) === null);
ok("a person accepts a named work order", (await person({ outcome: "accepted", work_order_fleetpal_id: "wo1" })) === null);
ok("a person says the repair was outside FleetPal, and where", (await person({ outcome: "repaired_outside_fleetpal", note: "Loves #512, tyre" })) === null);
ok("⚠ the engine may not accept", (await repair({ outcome: "accepted", work_order_fleetpal_id: "wo1" })) === "23514");
ok("⚠ a person's row names who decided", (await repair({ source: "person", candidates_sha256: null, outcome: "accepted", work_order_fleetpal_id: "wo1" })) === "23514");
ok("⚠ an engine row names nobody", (await repair({ decided_by: USER })) === "23514");
ok("⚠ an acceptance without its work order is refused", (await person({ outcome: "accepted" })) === "23514");
ok("⚠ a work order on anything but an acceptance is refused", (await person({ outcome: "repaired_outside_fleetpal", note: "x", work_order_fleetpal_id: "wo1" })) === "23514");
ok("⚠ 'outside FleetPal' without saying where is refused", (await person({ outcome: "repaired_outside_fleetpal", note: "  " })) === "23514");
ok("⚠ an engine row without its hash is refused", (await repair({ candidates_sha256: null })) === "23514");
ok("a person's row carries no engine hash", (await person({ outcome: "accepted", work_order_fleetpal_id: "wo1", candidates_sha256: HASH })) === "23514");
ok("candidates are a list", (await repair({ candidates: JSON.stringify({ workOrderId: "wo1" }) })) === "23514");
ok("an outcome nobody named is refused", (await repair({ outcome: "probably" })) === "23514");
ok("a unit of another org's inspection is refused", (await repair({ inspection_unit_id: FOREIGN_UNIT })) === "23503");
ok("another org's inspection is refused", (await repair({ inspection_id: FOREIGN_INSP })) === "23503");
ok("a reading is never rewritten", (await sqlstate(`update inspection_repairs set outcome = 'no_candidate' where inspection_unit_id = $1`, [UNIT])) === "IA010");
ok("a reading is never deleted", (await sqlstate(`delete from inspection_repairs where inspection_unit_id = $1`, [UNIT])) === "IA010");
ok("RLS is on, with no client policy", (await one(`select relrowsecurity r from pg_class where oid = 'public.inspection_repairs'::regclass`)).r === true
  && (await one(`select count(*)::int n from pg_policies where tablename = 'inspection_repairs'`)).n === 0);

// The contract's outcome list and the CHECK move together (packages/shared/src/roadsideRepairContract.ts).
const { REPAIR_OUTCOMES } = await import("../../packages/shared/dist/index.js");
const allowed = (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'inspection_repairs_outcome_check'`)).d.match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1)).sort();
ok("the CHECK allows exactly the contract's outcomes", JSON.stringify(allowed) === JSON.stringify([...REPAIR_OUTCOMES].sort()), JSON.stringify(allowed));

// 0485 — safety's certification (IC11 B2, Q-IC13): who, title, date, what was certified and its rendered record.
const certify = (o = {}) => {
  const cols = { org_id: ORG, inspection_id: INSP, certified_by: USER, signer_name: "Dana Reyes", signer_title: "Safety Director",
    signed_on: "2026-10-16", repairs: JSON.stringify([{ unitId: UNIT, repairId: crypto.randomUUID() }]), document_id: crypto.randomUUID(), ...o };
  const keys = Object.keys(cols);
  return sqlstate(`insert into inspection_repair_certifications (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(cols));
};
ok("a certification writes", (await certify()) === null);
ok("⚠ a certification without a title is refused", (await certify({ signer_title: "  " })) === "23514");
ok("⚠ a certification without the signer's name is refused", (await certify({ signer_name: "" })) === "23514");
ok("⚠ a certification over no repairs is refused", (await certify({ repairs: "[]" })) === "23514");
ok("⚠ a certification without its rendered record is refused", (await certify({ document_id: null })) === "23502");
ok("a certification of another org's inspection is refused", (await certify({ inspection_id: FOREIGN_INSP })) === "23503");
ok("a certification is never rewritten", (await sqlstate(`update inspection_repair_certifications set signer_title = 'x' where inspection_id = $1`, [INSP])) === "IA010");
ok("a certification is never deleted", (await sqlstate(`delete from inspection_repair_certifications where inspection_id = $1`, [INSP])) === "IA010");
ok("certifications: RLS is on, with no client policy", (await one(`select relrowsecurity r from pg_class where oid = 'public.inspection_repair_certifications'::regclass`)).r === true
  && (await one(`select count(*)::int n from pg_policies where tablename = 'inspection_repair_certifications'`)).n === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
