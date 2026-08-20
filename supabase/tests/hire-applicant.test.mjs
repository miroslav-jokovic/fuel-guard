// FuelGuard — hire_applicant transaction matrix (migration 0218, HIRING-PLAN.md H8).
//
// The RLS matrix proves who may read and write; this file proves that hiring an applicant is ONE
// transaction. Two facts must become true together: the person stops being an applicant, and the
// §391.23(a)(2) inquiry state that `driver_employment_history` carries as mutable columns becomes
// dated, append-only §391.51(b) evidence. A status flip that lands without its records leaves a
// driver whose file is missing evidence the carrier demonstrably holds — the exact gap an audit
// looks for — and records without the flip attach hiring evidence to somebody still called an
// applicant.
//
// What is asserted here and nowhere else: the re-run guard (a retry after a dropped response must
// file nothing), the refusal to hire somebody already hired (SQLSTATE HA010, the race two operators
// pressing Hire produce), and the tenant boundary on the function's own parameters.
//
// The RULES about which employer yields which record live in packages/shared/src/hireHandoff.ts and
// are unit-tested there. This proves the transaction, not the projection.
//
// Applies EVERY migration, same as rls.test.mjs, so the function under test is the one production
// runs.
//
// Run:  node supabase/tests/hire-applicant.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const count = async (q, p = []) => Number((await one(q, p)).n);

// Supabase-managed schemas, shimmed identically to rls.test.mjs.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key,
    name text,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner uuid,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text)
  returns text[]
  language sql
  immutable
  as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (
    version text primary key,
    name text,
    statements text[]
  );
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));


const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;

const APPLICANT = (
  await one(`insert into drivers (org_id, full_name, status) values ($1,'An Applicant','applicant') returning id`, [ORG])
).id;
const HIRED = (
  await one(`insert into drivers (org_id, full_name, status) values ($1,'Already Driving','active') returning id`, [ORG])
).id;
// Same name, another tenant — the row a mis-scoped function would reach.
const STRANGER = (
  await one(`insert into drivers (org_id, full_name, status) values ($1,'An Applicant','applicant') returning id`, [OTHER_ORG])
).id;

const EMP = (
  await one(
    `insert into driver_employment_history (org_id, driver_id, employer_name, usdot_number, started_on, ended_on, inquiry_status, inquiry_sent_on, inquiry_response_on)
     values ($1, $2, 'Old Carrier', '123456', '2023-01-01', '2025-06-30', 'responded', '2026-07-01', '2026-07-14')
     returning id`,
    [ORG, APPLICANT],
  )
).id;

/** The drafts the API composes from `planHireHandoff` — passed in, never derived in SQL. */
const drafts = (employmentId) =>
  JSON.stringify([
    {
      kind: "previous_employer_inquiry",
      occurred_on: "2026-07-01",
      result: null,
      performed_by: "Old Carrier",
      reference: "123456",
      detail: { employment_id: employmentId, employer_name: "Old Carrier", source: "recruitment_handoff" },
    },
    {
      kind: "previous_employer_response",
      occurred_on: "2026-07-14",
      result: "responded",
      performed_by: "Old Carrier",
      reference: "123456",
      detail: { employment_id: employmentId, employer_name: "Old Carrier", source: "recruitment_handoff" },
    },
  ]);

/** PGlite hands `date` columns back as JS Dates; compare the day, never the rendering. */
const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

const hire = (org, driver, date, records) =>
  db.query(`select public.hire_applicant($1, $2, $3::date, null, $4::jsonb) as r`, [org, driver, date, records]);

// ── the hire itself ────────────────────────────────────────────────────────────────────────────
const first = (await hire(ORG, APPLICANT, "2026-09-01", drafts(EMP))).rows[0].r;

ok("the applicant becomes an active driver", (await one(`select status from drivers where id = $1`, [APPLICANT])).status === "active");
ok(
  "the hire date is stamped, because the §391.21(b)(10) window is measured from it",
  day((await one(`select hire_date from drivers where id = $1`, [APPLICANT])).hire_date) === "2026-09-01",
);
ok("the transaction reports what it filed", Number(first.filed) === 2);
ok(
  "both §391.23 records are in the file, dated when they happened",
  (await count(
    `select count(*)::int as n from qualification_records
      where driver_id = $1 and kind in ('previous_employer_inquiry','previous_employer_response')`,
    [APPLICANT],
  )) === 2,
);
ok(
  "the inquiry is dated when it went out, not when the hire happened",
  day((await one(
    `select occurred_on from qualification_records where driver_id = $1 and kind = 'previous_employer_inquiry'`,
    [APPLICANT],
  )).occurred_on) === "2026-07-01",
);
ok(
  "each record names the employment row it came from",
  (await one(
    `select detail ->> 'employment_id' as e from qualification_records
      where driver_id = $1 and kind = 'previous_employer_inquiry'`,
    [APPLICANT],
  )).e === EMP,
);

// ── the re-run guard: a retry after a dropped response must not duplicate one screening ────────
let replayed = null;
try {
  await hire(ORG, APPLICANT, "2026-09-01", drafts(EMP));
} catch (e) {
  replayed = e;
}
ok("hiring somebody already hired raises", replayed !== null);
ok("and it raises the code the API maps to an answer, not a 500", replayed?.code === "HA010", String(replayed?.code));
ok(
  "the second attempt filed nothing",
  (await count(`select count(*)::int as n from qualification_records where driver_id = $1`, [APPLICANT])) === 2,
);

// A replay reaching the insert directly — the case where the API's read happened before the first
// attempt's write. Proven by resetting the status the way only a fleet act could.
await db.query(`update drivers set status = 'applicant' where id = $1`, [APPLICANT]);
const replay = (await hire(ORG, APPLICANT, "2026-09-01", drafts(EMP))).rows[0].r;
ok("a genuine replay files zero records", Number(replay.filed) === 0);
ok(
  "and leaves the file with one copy of each",
  (await count(`select count(*)::int as n from qualification_records where driver_id = $1`, [APPLICANT])) === 2,
);

// ── refusals ───────────────────────────────────────────────────────────────────────────────────
let alreadyHired = null;
try {
  await hire(ORG, HIRED, "2026-09-01", "[]");
} catch (e) {
  alreadyHired = e;
}
ok("an active driver cannot be hired again", alreadyHired?.code === "HA010");
ok(
  "and their hire date was not re-stamped, which would move their §391.51(c) clock",
  (await one(`select hire_date from drivers where id = $1`, [HIRED])).hire_date === null,
);

let crossOrg = null;
try {
  await hire(ORG, STRANGER, "2026-09-01", "[]");
} catch (e) {
  crossOrg = e;
}
ok("another org's applicant is not found, let alone hired", crossOrg !== null);
ok(
  "and they are still an applicant",
  (await one(`select status from drivers where id = $1`, [STRANGER])).status === "applicant",
);

// ── the tenant boundary on the records themselves ──────────────────────────────────────────────
ok(
  "every filed record carries the org it was filed for",
  (await count(`select count(*)::int as n from qualification_records where driver_id = $1 and org_id = $2`, [APPLICANT, ORG])) === 2,
);

// ── the function is not reachable from a browser session ───────────────────────────────────────
ok(
  "execute is granted to service_role only",
  (await count(
    `select count(*)::int as n from information_schema.role_routine_grants
      where routine_name = 'hire_applicant' and grantee in ('anon','authenticated','PUBLIC')`,
  )) === 0,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
