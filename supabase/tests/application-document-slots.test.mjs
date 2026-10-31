// §9 P6 (HIRING-WORKFLOW-AUDIT-2026-10-31), migration 0534: every document an applicant may send, as a
// photo or a PDF, several of the ones that come in several — and "a re-shoot replaces" kept for the rest.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DOCUMENT_KINDS } from "../../packages/shared/dist/index.js";

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


const DRIVER = (await one(`insert into drivers (org_id, full_name) values ($1, 'Applicant One') returning id`, [ORG])).id;
const INV = (await one(
  `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
   values ($1, $2, md5(random()::text), now() + interval '10 days') returning id`, [ORG, DRIVER])).id;

const stage = (slot, ordinal = null, contentType = "image/jpeg") => {
  const args = [ORG, INV, DRIVER, slot, `${ORG}/applications/${INV}/${slot}-${Math.random()}`, contentType];
  return ordinal === null
    ? sqlstate(`select public.stage_application_capture($1, $2, $3, gen_random_uuid(), $4, $5, $6, 100, 'ab')`, args)
    : sqlstate(`select public.stage_application_capture($1, $2, $3, gen_random_uuid(), $4, $5, $6, 100, 'ab', $7::smallint)`, [...args, ordinal]);
};
const count = async (slot) =>
  Number((await one(`select count(*)::int n from application_captures where invitation_id = $1 and slot = $2`, [INV, slot])).n);

// ── 1. The new slots ──────────────────────────────────────────────────────────────────────────
for (const slot of ["twic", "passport", "work_authorization", "hazmat_endorsement", "road_test_certificate", "training_certificate"]) {
  ok(`0534: the ${slot} slot takes a capture`, (await stage(slot)) === null);
}
ok("an unknown slot is still refused (23514)", (await stage("library_card")) === "23514");

// ── 2. PDFs, except for the three pictures ────────────────────────────────────────────────────
ok("0534: a PDF medical certificate is accepted", (await stage("medical_card", null, "application/pdf")) === null);
ok("a PDF selfie is refused (23514)", (await stage("selfie", null, "application/pdf")) === "23514");
ok("a PDF signature mark is refused (23514)", (await stage("signature_mark", null, "application/pdf")) === "23514");
ok("a Word file is refused anywhere (23514)", (await stage("other", null, "application/msword")) === "23514");

// ── 3. Several, up to five, only where several make sense ─────────────────────────────────────
for (const n of [1, 2, 3, 4]) ok(`0534: training certificate #${n + 1} sits beside the first`, (await stage("training_certificate", n)) === null);
ok("0534: five training certificates coexist", (await count("training_certificate")) === 5);
ok("0534: a sixth (ordinal 5) is refused (23514)", (await stage("training_certificate", 5)) === "23514");
ok("0534: a second CDL front (ordinal 1) is refused — single-document slots stay single (23514)", (await stage("cdl_front", 1)) === "23514");

// A re-shoot replaces its own place, and only it.
await stage("training_certificate", 2);
ok("0534: re-staging ordinal 2 replaces it — still five", (await count("training_certificate")) === 5);
await stage("cdl_front");
await stage("cdl_front");
ok("the old 9-argument stage still replaces the whole slot (one CDL front)", (await count("cdl_front")) === 1);
ok("old rows keep ordinal 0",
  Number((await one(`select ordinal from application_captures where invitation_id = $1 and slot = 'cdl_front'`, [INV])).ordinal) === 0);

// ── 4. documents.kind ─────────────────────────────────────────────────────────────────────────
for (const kind of ["passport", "ssn_card", "work_authorization", "training_certificate", "road_test_certificate"]) {
  ok(`0534: documents takes kind ${kind}`, (await sqlstate(
    `insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, sha256)
     values (gen_random_uuid(), $1, 'driver', $2, $3, $4, 'application/pdf', 'ab')`,
    [ORG, DRIVER, kind, `${ORG}/driver/${DRIVER}/${kind}-${Math.random()}.pdf`])) === null);
}
const d = (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'documents_kind_check'`)).d;
const sqlKinds = [...d.matchAll(/'([^']*)'::text/g)].map((m) => m[1]).sort();
ok("documents.kind's CHECK equals DOCUMENT_KINDS", JSON.stringify(sqlKinds) === JSON.stringify([...DOCUMENT_KINDS].sort()));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
