// Silvicom 360 — what the court decided on a roadside ticket, and the DataQs request over it (migration 0495,
// INSPECTION-CHALLENGE-PLAN IC4 second merge, R-ADJ2/R-ADJ3). Pins the rows' promises: an outcome is one of FMCSA's
// three codes and a different charge names its charge; the ticket belongs to the inspection's org; a request rests
// on a disposition OF THAT TICKET; filed is the one state with an RDR number, never without its day; a person is
// named on each; both records are append-only with no client policy.
//
// Run: node supabase/tests/inspection-citation-dispositions.test.mjs

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

const VIOL_2 = await violationOf(ORG, INSP);
const PAPER = crypto.randomUUID();

const insert = (table, cols) => {
  const keys = Object.keys(cols);
  return sqlstate(`insert into ${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(cols));
};
const dispose = (o = {}) => insert("inspection_citation_dispositions", {
  org_id: ORG, inspection_id: INSP, violation_id: VIOL, document_id: PAPER, outcome_code: 3, court_name: "Will County Circuit Court",
  decided_on: "2026-09-01", recorded_by: USER, ...o,
});

ok("a dismissal read from the court paper is recorded", (await dispose()) === null);
ok("a conviction of a different charge, naming the charge, is recorded", (await dispose({ outcome_code: 2, amended_charge: "Improper lane use" })) === null);
ok("a conviction of the charge is recorded", (await dispose({ outcome_code: 1 })) === null);
ok("⚠ a different charge that does not name it is refused", (await dispose({ outcome_code: 2 })) === "23514");
ok("⚠ a new charge on a dismissal is refused", (await dispose({ amended_charge: "Improper lane use" })) === "23514");
ok("FMCSA's 'not applicable' (0) is refused: a warning has no court", (await dispose({ outcome_code: 0 })) === "23514");
ok("a disposition with no court is refused", (await dispose({ court_name: "" })) === "23514");
ok("a disposition with no paper is refused", (await dispose({ document_id: null })) === "23502");
ok("a disposition with nobody behind it is refused", (await dispose({ recorded_by: null })) === "23502");
ok("another org's ticket under our inspection is refused", (await dispose({ violation_id: FOREIGN_VIOL })) === "23503");
ok("our ticket under another org's inspection is refused", (await dispose({ inspection_id: FOREIGN_INSP })) === "23503");

const DISP = (await one(`select id from inspection_citation_dispositions where violation_id = $1 and outcome_code = 3 limit 1`, [VIOL])).id;
const request = (o = {}) => insert("dataqs_cases", {
  org_id: ORG, inspection_id: INSP, violation_id: VIOL, disposition_id: DISP, rdr_type: "inspection_citation_with_associated_violation",
  state: "approved", narrative: "The court dismissed citation E061.", attribution_id: crypto.randomUUID(), attested_by: USER,
  attested_at: new Date().toISOString(), acted_by: USER, ...o,
});

ok("an approved request, attested, is recorded", (await request()) === null);
ok("a filed request, with its RDR number and day, is recorded", (await request({ state: "filed", rdr_number: "1234567", filed_on: "2026-10-19" })) === null);
ok("⚠ a request resting on ANOTHER ticket's disposition is refused", (await request({ violation_id: VIOL_2 })) === "23503");
ok("⚠ a filed request with no RDR number is refused", (await request({ state: "filed", filed_on: "2026-10-19" })) === "23514");
ok("⚠ an approved request carrying an RDR number is refused", (await request({ rdr_number: "1234567", filed_on: "2026-10-19" })) === "23514");
ok("⚠ an RDR number without its day is refused", (await request({ state: "filed", rdr_number: "1234567" })) === "23514");
ok("a request type outside the one built is refused", (await request({ rdr_type: "inspection_incorrect_driver" })) === "23514");
ok("a state outside approved and filed is refused", (await request({ state: "draft" })) === "23514");
ok("a request nobody attested to is refused", (await request({ attested_by: null })) === "23502");
ok("a request with no driver decision under it is refused", (await request({ attribution_id: null })) === "23502");
ok("a request with no explanation is refused", (await request({ narrative: "" })) === "23514");

for (const t of ["inspection_citation_dispositions", "dataqs_cases"]) {
  ok(`${t}: a row is never rewritten`, (await sqlstate(`update ${t} set created_at = now() where org_id = $1`, [ORG])) === "IA010");
  ok(`${t}: a row is never deleted`, (await sqlstate(`delete from ${t} where org_id = $1`, [ORG])) === "IA010");
  ok(`${t}: RLS is on, with no client policy`, (await one(`select relrowsecurity r from pg_class where oid = $1::regclass`, [`public.${t}`])).r === true
    && (await one(`select count(*)::int n from pg_policies where tablename = $1`, [t])).n === 0);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
