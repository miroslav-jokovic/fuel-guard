// Silvicom 360 — the truck and trailer files' paper kinds (migration 0490, UNIT-FILES-PLAN UF1).
//
// 0490 rewrites two CHECK constraints whole. The risk in a rewrite is a word DROPPED from the old
// list — a refused production write of some unrelated kind weeks later — so §2 re-reads the lists as
// 0127 (certifications) and 0484 (documents) left them and proves every word still passes; §0 proves
// the shared vocabulary IS the applied constraint; §3 proves both lists are still closed.
//
// Run:  node supabase/tests/unit-file-kinds.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CERTIFICATION_KINDS, DOCUMENT_KINDS } from "../../packages/shared/dist/index.js";

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

const doc = (kind, subjectType = "tractor", subjectId = UNIT) =>
  sqlstate(`insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, sha256)
            values (gen_random_uuid(), $1, $2, $3, $4, $5, 'application/pdf', 'ab')`,
    [ORG, subjectType, subjectId, kind, `${ORG}/${subjectType}/${subjectId}/${kind}-${Math.random()}.pdf`]);
// A fresh subject per certification: the current-row unique index allows one per subject + kind.
const cert = async (kind, subjectType = "tractor") =>
  sqlstate(`insert into certifications (org_id, subject_type, subject_id, kind, effective_from, expires_at)
            values ($1, $2, gen_random_uuid(), $3, '2026-01-01', '2027-01-01')`, [ORG, subjectType, kind]);

// ── 0. One vocabulary: the shared lists ARE the applied constraints ─────────────────────────────
const checkValues = async (table, column) => {
  const c = await one(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = $1::regclass and conname = $2`,
    [`public.${table}`, `${table}_${column}_check`]);
  return [...c.d.matchAll(/'([^']*)'::text/g)].map((m) => m[1]).sort();
};
ok("certifications.kind's CHECK equals CERTIFICATION_KINDS",
  JSON.stringify(await checkValues("certifications", "kind")) === JSON.stringify([...CERTIFICATION_KINDS].sort()));
ok("documents.kind's CHECK equals DOCUMENT_KINDS",
  JSON.stringify(await checkValues("documents", "kind")) === JSON.stringify([...DOCUMENT_KINDS].sort()));

// ── 1. The three new papers ─────────────────────────────────────────────────────────────────────
ok("a lease is recorded as a dated certification on a tractor", (await cert("lease")) === null);
ok("a permit is recorded as a dated certification on a trailer", (await cert("permit", "trailer")) === null);
for (const k of ["title", "lease", "permit"]) {
  ok(`a \`${k}\` scan files against a trailer`, (await doc(k, "trailer")) === null);
}
ok("a title is paper only — it is refused as a certification (23514)", (await cert("title")) === "23514");

// ── 2. Nothing that was valid stopped being valid ───────────────────────────────────────────────
// Read from the constraints as their last writers left them, so a word dropped in the rewrite goes
// red here rather than on the first production write of that kind.
const m0127 = read("migrations/0127_hazmat_certifications.sql");
const certsBefore = [...(/kind\s+text not null check \(kind in \(([^)]*)\)\)/s.exec(m0127)[1]
  .matchAll(/'([a-z_]+)'/g))].map((x) => x[1]);
const m0484 = read("migrations/0484_roadside_repair_record_document_kind.sql");
const docsBefore = [...(/add constraint documents_kind_check check \(kind in \(([^;]*?)\)\);/s.exec(m0484)[1]
  .matchAll(/'([a-z_]+)'/g))].map((x) => x[1]);
ok("0127's and 0484's lists were read (15 certification kinds, 42 document kinds)",
  certsBefore.length === 15 && docsBefore.length === 42, `${certsBefore.length}/${docsBefore.length}`);
const certRefused = [];
for (const k of certsBefore) {
  // hazmat training carries its own §172.704(d) fields (cert_training_fields); the kind is what is tested.
  const r = k === "hazmat_training"
    ? await sqlstate(`insert into certifications (org_id, subject_type, subject_id, kind, effective_from,
        training_type, training_provider_name, training_certified)
        values ($1, 'driver', gen_random_uuid(), 'hazmat_training', '2026-01-01', 'safety', 'Provider', true)`, [ORG])
    : await cert(k, ["phmsa_registration", "hazmat_safety_permit", "security_plan", "financial_responsibility", "operating_authority"].includes(k) ? "organization" : "driver");
  if (r !== null) certRefused.push(`${k}:${r}`);
}
ok("every certification kind valid before 0490 is still valid", certRefused.length === 0, certRefused.join(","));
const docRefused = [];
for (const k of docsBefore) if ((await doc(k, "driver")) !== null) docRefused.push(k);
ok("every document kind valid before 0490 is still valid", docRefused.length === 0, docRefused.join(","));

// ── 3. Still closed lists: the widening added words, not a hole ─────────────────────────────────
ok("an unknown certification kind is still refused (23514)", (await cert("cab_card")) === "23514");
ok("an unknown document kind is still refused (23514)", (await doc("bill_of_sale")) === "23514");

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
