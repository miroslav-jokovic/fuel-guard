// Silvicom 360 — `orientation` and `handbook` kinds matrix (migration 0373, ORIENTATION-PLAN.md OR0).
//
// 0373 rewrites two CHECK constraints to add two words each. The risk in a rewrite is not the words
// added; it is a word DROPPED from the old list, which would surface as a refused production write of
// some unrelated kind weeks later. So §3 re-reads 0237's lists and proves every one of them still
// passes, and §2 proves the list is still closed.
//
// Run:  node supabase/tests/orientation-kinds.test.mjs
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
    name text, owner uuid, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
// Supabase's default privileges, before the migrations, as rls.test.mjs installs them: RLS is the gate.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const org = async (name) => (await one(`insert into organizations (id, name) values (gen_random_uuid(), $1) returning id`, [name])).id;
const ORG = await org("Carrier");
const DRIVER = (await one(`insert into drivers (org_id, full_name) values ($1, 'Jovana Petrović-Szczepańska') returning id`, [ORG])).id;

const doc = (kind, subjectType = "driver", subjectId = DRIVER) =>
  sqlstate(`insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, sha256)
            values (gen_random_uuid(), $1, $2, $3, $4, $5, 'application/pdf', 'ab')`,
    [ORG, subjectType, subjectId, kind, `${ORG}/${subjectType}/${subjectId}/${kind}-${Math.random()}.pdf`]);
const record = (kind) =>
  // `detail.source` because `qualification_records_psp_source_check` (0217) refuses a `psp_report`
  // without one — a different constraint, which this matrix is not about.
  sqlstate(`insert into qualification_records (org_id, driver_id, kind, occurred_on, detail)
            values ($1, $2, $3, '2026-09-25', '{"source":"psp_api"}')`,
    [ORG, DRIVER, kind]);

// ── 1. The two new kinds ─────────────────────────────────────────────────────────────────────────
ok("`orientation` is a qualification-record kind", (await record("orientation")) === null);
ok("`handbook` is a qualification-record kind", (await record("handbook")) === null);
ok("`orientation` is a document kind (the filed page 24)", (await doc("orientation")) === null);
ok("`handbook` is a document kind (the driver's signed copy)", (await doc("handbook")) === null);
ok("…and the carrier's master copy files against the ORGANIZATION", (await doc("handbook", "organization", ORG)) === null);

// ── 2. Still a closed list: the widening added two words, not a hole ────────────────────────────
ok("an unknown record kind is still refused (23514)", (await record("orientation_day")) === "23514");
ok("an unknown document kind is still refused (23514)", (await doc("handbook_receipt")) === "23514");

// ── 3. Nothing that was valid stopped being valid ────────────────────────────────────────────────
// Every kind the constraint admitted before 0373, read from the constraint as 0237 wrote it — so a
// dropped word in the rewrite goes red here rather than on the first production write of that kind.
const before = (sql, name) => {
  const m = new RegExp(`add constraint ${name} check \\(kind in \\(([^;]*?)\\)\\);`, "s").exec(sql);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
};
const m0237 = read("migrations/0237_return_to_duty_gate.sql");
const QR_BEFORE = before(m0237, "qualification_records_kind_check");
const DOC_BEFORE = before(m0237, "documents_kind_check");
ok("0237's lists were read (17 record kinds, 33 document kinds)", QR_BEFORE.length === 17 && DOC_BEFORE.length === 33,
  `${QR_BEFORE.length}/${DOC_BEFORE.length}`);
const qrRefused = [];
for (const k of QR_BEFORE) if ((await record(k)) !== null) qrRefused.push(k);
ok("every record kind valid before 0373 is still valid", qrRefused.length === 0, qrRefused.join(","));
const docRefused = [];
for (const k of DOC_BEFORE) if ((await doc(k)) !== null) docRefused.push(k);
ok("every document kind valid before 0373 is still valid", docRefused.length === 0, docRefused.join(","));

// ── 4. Neither kind is restricted: the restrictive policies name testing and investigation only ──
const restrictive = (await db.query(
  `select qual from pg_policies where tablename in ('qualification_records','documents') and permissive = 'RESTRICTIVE'`,
)).rows.map((r) => r.qual).join(" ");
ok("no restrictive policy names `orientation` or `handbook`",
  !/'orientation'|'handbook'/.test(restrictive) && restrictive.includes("drug_test"));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
