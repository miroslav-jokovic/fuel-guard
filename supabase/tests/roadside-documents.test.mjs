// Silvicom 360 — an inspection's paper in `documents` (migration 0476, INSPECTION-CHALLENGE-PLAN IC2).
//
// 0476 rewrites two CHECK constraints. As with 0373 (orientation-kinds.test.mjs), the risk in a
// rewrite is a word DROPPED from the old list — a refused production write of some unrelated kind
// weeks later — so §3 re-reads 0376's kind list and 0146's subject list and proves every word still
// passes, and §2 proves both lists are still closed.
//
// Run:  node supabase/tests/roadside-documents.test.mjs
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
const DRIVER = (await one(`insert into drivers (org_id, full_name) values ($1, 'Jovana Petrović-Szczepańska') returning id`, [ORG])).id;
// The subject is polymorphic (no FK), so any uuid stands in for a `roadside_inspections.id`.
const INSPECTION = (await one(`select gen_random_uuid() id`)).id;

const doc = (kind, subjectType, subjectId) =>
  sqlstate(`insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, sha256)
            values (gen_random_uuid(), $1, $2, $3, $4, $5, 'application/pdf', 'ab')`,
    [ORG, subjectType, subjectId, kind, `${ORG}/${subjectType}/${subjectId}/${kind}-${Math.random()}.pdf`]);

// ── 1. The new subject and the five new kinds ───────────────────────────────────────────────────
const NEW_KINDS = ["roadside_inspection_report", "citation", "court_disposition", "dataqs_packet", "dataqs_correspondence"];
for (const k of NEW_KINDS) {
  ok(`\`${k}\` files against a roadside inspection`, (await doc(k, "roadside_inspection", INSPECTION)) === null);
}
ok("an inspection may also hold `other` (a photo the officer's copy does not cover)",
  (await doc("other", "roadside_inspection", INSPECTION)) === null);

// ── 2. Still closed lists: the widening added words, not a hole ─────────────────────────────────
ok("an unknown document kind is still refused (23514)", (await doc("ticket", "roadside_inspection", INSPECTION)) === "23514");
ok("an unknown subject is still refused (23514)", (await doc("citation", "inspection", INSPECTION)) === "23514");

// ── 3. Nothing that was valid stopped being valid ───────────────────────────────────────────────
// Read from the constraints as 0376 (kinds) and 0146 (subjects) wrote them, so a word dropped in the
// rewrite goes red here rather than on the first production write of that kind.
const m0376 = read("migrations/0376_applicant_flow_v2.sql");
const kindsBefore = [...(/add constraint documents_kind_check check \(kind in \(([^;]*?)\)\);/s.exec(m0376)[1]
  .matchAll(/'([a-z_]+)'/g))].map((x) => x[1]);
const m0146 = read("migrations/0146_compliance_documents.sql");
const subjectsBefore = [...(/subject_type in \(([^)]*)\)/.exec(m0146)[1].matchAll(/'([a-z_]+)'/g))].map((x) => x[1]);
ok("0376's kind list and 0146's subject list were read (36 kinds, 5 subjects)",
  kindsBefore.length === 36 && subjectsBefore.length === 5, `${kindsBefore.length}/${subjectsBefore.length}`);
const kindRefused = [];
for (const k of kindsBefore) if ((await doc(k, "driver", DRIVER)) !== null) kindRefused.push(k);
ok("every document kind valid before 0476 is still valid", kindRefused.length === 0, kindRefused.join(","));
const subjectRefused = [];
for (const s of subjectsBefore) if ((await doc("other", s, s === "driver" ? DRIVER : ORG)) !== null) subjectRefused.push(s);
ok("every subject valid before 0476 is still valid", subjectRefused.length === 0, subjectRefused.join(","));

// ── 4. None of the five is restricted: the restrictive policies name testing and investigation only ──
const restrictive = (await db.query(
  `select qual from pg_policies where tablename = 'documents' and permissive = 'RESTRICTIVE'`,
)).rows.map((r) => r.qual).join(" ");
ok("no restrictive policy on documents names an inspection kind or subject",
  !NEW_KINDS.some((k) => restrictive.includes(`'${k}'`)) && !restrictive.includes("'roadside_inspection'")
    && restrictive.includes("drug_test"));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
