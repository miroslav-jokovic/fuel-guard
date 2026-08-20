// FuelGuard — restricted-records matrix (0205, split by 0211; DQF-EXECUTION-PLAN Phase G / D-DQ15).
//
// Proves the RLS layer of the three-layer restriction: a dispatcher or auditor reading
// qualification_records/documents through PostgREST sees no drug/alcohol/clearinghouse/
// previous-employer rows, while admin and safety_manager see everything and non-restricted kinds
// stay visible to all fleet roles. (The service-role API path is enforced separately in
// routes/compliance.ts via filterRestrictedRows — RLS cannot see those reads.)
//
// 0211 split the one predicate in two, along the two regulations it was conflating: §382.401(a)
// custody of testing records, and §391.53(a)(1)'s investigation history, which belongs to "those who
// are involved in the hiring decision". The `recruiter` cases below are what that split BUYS, and the
// recruiter's drug-test case is what proves the split did not simply widen the old flag.
//
// Run:  node supabase/tests/restricted-records.test.mjs
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
// Supabase's real default privileges, installed BEFORE the migrations run — same modelling (and the
// same reasoning) as rls.test.mjs: full DML granted, RLS is the gate.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const DRIVER = (
  await one(`insert into drivers (org_id, full_name, samsara_driver_id) values ($1,'A Driver','S1') returning id`, [ORG])
).id;

await db.query(
  `insert into qualification_records (org_id, driver_id, kind, occurred_on) values
     ($1, $2, 'mvr', '2026-01-10'),
     ($1, $2, 'drug_test', '2026-02-01'),
     ($1, $2, 'previous_employer_response', '2026-02-02'),
     ($1, $2, 'clearinghouse_limited', '2026-02-03')`,
  [ORG, DRIVER],
);
await db.query(
  `insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, bytes, sha256, uploaded_by) values
     (gen_random_uuid(), $1, 'driver', $2, 'mvr', $3, 'application/pdf', 10, repeat('a',64), null),
     (gen_random_uuid(), $1, 'driver', $2, 'drug_test', $4, 'application/pdf', 10, repeat('b',64), null)`,
  [ORG, DRIVER, `${ORG}/driver/${DRIVER}/a.pdf`, `${ORG}/driver/${DRIVER}/b.pdf`],
);

/** Read as an org member with the given app role (same JWT shape rls.test.mjs uses). */
async function countAs(role, sql) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: "00000000-0000-4000-8000-000000000001", org_id: ORG, user_role: role, role: "authenticated" }),
    ]);
    const res = await db.query(sql);
    await db.exec("rollback");
    return Number(res.rows[0].n);
  } catch (e) {
    await db.exec("rollback");
    return `ERROR: ${e.message}`;
  }
}

const RECORDS = "select count(*)::int as n from qualification_records";
const DOCS = "select count(*)::int as n from documents";

const expect = async (name, role, sql, want) => {
  const got = await countAs(role, sql);
  ok(name, got === want, `(got ${got})`);
};
await expect("dispatcher sees only the non-restricted record", "dispatcher", RECORDS, 1);
await expect("auditor sees only the non-restricted record", "auditor", RECORDS, 1);
await expect("fleet_manager sees only the non-restricted record", "fleet_manager", RECORDS, 1);
await expect("safety_manager sees all four records", "safety_manager", RECORDS, 4);
await expect("admin sees all four records", "admin", RECORDS, 4);
await expect("dispatcher sees only the non-restricted document", "dispatcher", DOCS, 1);
await expect("safety_manager sees both documents", "safety_manager", DOCS, 2);
ok(
  "dq_exports carries include_restricted, defaulting false",
  (await one(`select column_default from information_schema.columns
               where table_name = 'dq_exports' and column_name = 'include_restricted'`)).column_default === "false",
);

// ── driver_employment_history (0208 + 0209) ─────────────────────────────────────────────────────
// The `recruitment` section's whole reason for existing. Gated on `fleet` — how the surface first
// shipped — a dispatcher could read every driver's former employers and their contact details.
// §391.53(a)(1) puts the investigation history with those making the hiring decision, and 0209's
// RESTRICTIVE policy is the PostgREST half of saying so (the API path guards separately, on
// rolesThatCanView('recruitment')).
await db.query(
  `insert into driver_employment_history (org_id, driver_id, employer_name, started_on, ended_on)
     values ($1, $2, 'Old Carrier', '2022-01-01', '2024-06-01')`,
  [ORG, DRIVER],
);
const EMPLOYMENT = "select count(*)::int as n from driver_employment_history";
await expect("dispatcher sees NO employment history, though they can read Fleet", "dispatcher", EMPLOYMENT, 0);
await expect("auditor sees the employment history — a DOT audit asks for it", "auditor", EMPLOYMENT, 1);
await expect("fleet_manager sees it", "fleet_manager", EMPLOYMENT, 1);
await expect("safety_manager sees it", "safety_manager", EMPLOYMENT, 1);
await expect("admin sees it", "admin", EMPLOYMENT, 1);
// Self-view is a separate axis from the section (0129's precedent): a driver whose id does not
// resolve sees nothing, and 0208's driver-scope policy is what limits them to their own row.
await expect("an unlinked driver sees none of it", "driver", EMPLOYMENT, 0);

// ── 0211: the split, and the role that forced it ────────────────────────────────────────────────
const TESTING = "select count(*)::int as n from qualification_records where kind in ('drug_test','clearinghouse_limited')";
const INVESTIGATION = "select count(*)::int as n from qualification_records where kind = 'previous_employer_response'";

// §391.53(a)(1) — the recruiter IS "those who are involved in the hiring decision".
await expect("recruiter reads the previous-employer response", "recruiter", INVESTIGATION, 1);
// §382.401(a) — a custody rule that says nothing about hiring. The split must not have widened it.
await expect("recruiter reads NO testing records", "recruiter", TESTING, 0);
await expect("recruiter still sees the unrestricted record", "recruiter", RECORDS, 2);
// Nothing changed for anyone who already held the old flag, in either direction.
await expect("safety_manager keeps both halves", "safety_manager", RECORDS, 4);
await expect("admin keeps both halves", "admin", RECORDS, 4);
await expect("fleet_manager gained neither half", "fleet_manager", RECORDS, 1);
await expect("dispatcher gained neither half", "dispatcher", RECORDS, 1);
// Documents follow the records, kind for kind.
await expect("recruiter reads no restricted document (only the mvr)", "recruiter", DOCS, 1);

// ── 0212: what a recruiter may write ────────────────────────────────────────────────────────────
await expect("recruiter reads employment history", "recruiter", EMPLOYMENT, 1);
// The write cases below trip the audit trigger on `drivers`, which FKs actor_id to auth.users — so
// the JWT's `sub` has to be a real user or the insert fails for a reason that has nothing to do with
// the policy under test. (Diagnosed 2026-08-19: the first run of this block failed on
// audit_logs_actor_id_fkey while `drivers_write` was already correct.)
await db.query(`insert into auth.users (id, email) values ($1, 'recruiter@example.test')`, [
  "00000000-0000-4000-8000-000000000001",
]);
const writeAs = async (role, sql) => {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: "00000000-0000-4000-8000-000000000001", org_id: ORG, user_role: role, role: "authenticated" }),
    ]);
    await db.query(sql);
    await db.exec("rollback");
    return true;
  } catch {
    await db.exec("rollback");
    return false;
  }
};
ok(
  "recruiter may create a driver — an applicant IS a drivers row",
  await writeAs("recruiter", `insert into drivers (org_id, full_name) values ('${ORG}', 'Applicant')`),
);
ok(
  "recruiter may record an employer",
  await writeAs(
    "recruiter",
    `insert into driver_employment_history (org_id, driver_id, employer_name, started_on)
       values ('${ORG}', '${DRIVER}', 'Another Carrier', '2020-01-01')`,
  ),
);
// The boundary the whole design rests on: the driver write is granted BY NAME, not by widening the
// fleet section, so the equipment tables stay shut.
ok(
  "recruiter may NOT create a vehicle — fleet: view, not manage",
  !(await writeAs("recruiter", `insert into vehicles (org_id, unit_number) values ('${ORG}', 'T-999')`)),
);
ok(
  "recruiter may NOT create a trailer",
  !(await writeAs("recruiter", `insert into trailers (org_id, unit_number) values ('${ORG}', 'TR-999')`)),
);

// ── 0213: the lifecycle guard, on the path the API does not own ─────────────────────────────────
// apps/web's older driver drawer writes `status` through PostgREST directly, so the route guard in
// routes/roster/drivers.ts is not the only door. RLS cannot express "this column may not change" —
// USING sees the OLD row, WITH CHECK the NEW one, and nothing compares them — so this is a trigger.
const APPLICANT = (
  await one(`insert into drivers (org_id, full_name, status) values ($1,'Applicant','active') returning id`, [ORG])
).id;
// Seeded already-terminated rather than terminated by a raw UPDATE: the trigger calls auth_role(),
// and a raw update outside the claims-setting helpers runs with no valid JWT setting.
const GONE = (
  await one(`insert into drivers (org_id, full_name, status) values ($1,'Former Driver','terminated') returning id`, [ORG])
).id;

ok(
  "recruiter may edit an ordinary field on a driver",
  await writeAs("recruiter", `update drivers set date_of_birth = '1980-01-01' where id = '${APPLICANT}'`),
);
ok(
  "recruiter may NOT terminate",
  !(await writeAs("recruiter", `update drivers set status = 'terminated' where id = '${APPLICANT}'`)),
);
// The rule is about the FIELD, so the reverse is closed too — a recruiter cannot resurrect a
// terminated driver either, which a rule about the value 'terminated' would have allowed.
ok(
  "recruiter may NOT un-terminate",
  !(await writeAs("recruiter", `update drivers set status = 'active' where id = '${GONE}'`)),
);
ok(
  "recruiter may NOT reach the retention clock through termination_date alone",
  !(await writeAs("recruiter", `update drivers set termination_date = '2020-01-01' where id = '${APPLICANT}'`)),
);
ok(
  "fleet_manager may still terminate",
  await writeAs("fleet_manager", `update drivers set status = 'terminated' where id = '${APPLICANT}'`),
);
ok(
  "admin may still un-terminate",
  await writeAs("admin", `update drivers set status = 'active' where id = '${GONE}'`),
);

// ── 0215: driver_authorizations — the legal basis, behind the same section boundary ─────────────
const AUTH = (
  await one(
    `insert into driver_authorizations
       (org_id, driver_id, purpose, disclosure_version, disclosure_text, method, signed_name, intent_statement)
     values ($1, $2, 'psp', 'v0-draft', 'text', 'wet_signature', 'A Driver', 'I authorize')
     returning id`,
    [ORG, DRIVER],
  )
).id;
const AUTHS = "select count(*)::int as n from driver_authorizations";
await expect("recruiter reads the authorizations they collect", "recruiter", AUTHS, 1);
await expect("auditor reads them — the basis for a pull is auditable", "auditor", AUTHS, 1);
await expect("dispatcher reads none", "dispatcher", AUTHS, 0);
ok(
  "recruiter may record an authorization",
  await writeAs(
    "recruiter",
    `insert into driver_authorizations
       (org_id, driver_id, purpose, disclosure_version, disclosure_text, method, signed_name, intent_statement)
     values ('${ORG}', '${DRIVER}', 'fcra_disclosure', 'v0-draft', 't', 'esign', 'A Driver', 'i')`,
  ),
);
// Append-only: evidence of consent that can be edited is not evidence (CLAUDE.md). Asserted on the
// ROW rather than on an exception — with RLS and no UPDATE/DELETE policy the statement matches zero
// rows and SUCCEEDS, so "did it throw" would have passed while the row quietly changed.
await writeAs("admin", `update driver_authorizations set signed_name = 'Someone Else' where id = '${AUTH}'`);
ok(
  "an UPDATE changes nothing — append-only by the absence of a policy",
  (await one(`select signed_name from driver_authorizations where id = $1`, [AUTH])).signed_name === "A Driver",
);
await writeAs("admin", `delete from driver_authorizations where id = '${AUTH}'`);
ok(
  "a DELETE removes nothing",
  Number((await one(`select count(*)::int as n from driver_authorizations where id = $1`, [AUTH])).n) === 1,
);

// ── 0216: psp_requests — a purchase, and a person's whole violation history ──────────────────────
// `$2` twice with two different target types makes Postgres refuse to deduce the parameter, so the
// ref is passed separately rather than cast from the uuid.
await db.query(
  `insert into psp_requests (org_id, driver_id, internal_ref_id, idempotency_key, request_body, status, billed)
     values ($1, $2, $3, 'k1', '{}'::jsonb, 'succeeded', true)`,
  [ORG, DRIVER, DRIVER],
);
const PSPREQ = "select count(*)::int as n from psp_requests";
await expect("recruiter reads the PSP requests they order", "recruiter", PSPREQ, 1);
await expect("auditor reads them", "auditor", PSPREQ, 1);
await expect("dispatcher reads none", "dispatcher", PSPREQ, 0);
// No client write policy at all: every row is written by the order path, which is where the budget,
// the step-up and the authorization gate live. A row a browser could insert is an ungated purchase.
ok(
  "nobody may INSERT a psp_request from the client — the order path owns it",
  !(await writeAs(
    "admin",
    `insert into psp_requests (org_id, driver_id, internal_ref_id, idempotency_key, request_body)
       values ('${ORG}', '${DRIVER}', 'x', 'k2', '{}'::jsonb)`,
  )),
);
// One in flight per driver, or two operators clicking at once buy the same report twice.
await db.query(
  `insert into psp_requests (org_id, driver_id, internal_ref_id, idempotency_key, request_body, status)
     values ($1, $2, $3, 'k3', '{}'::jsonb, 'pending')`,
  [ORG, DRIVER, DRIVER],
);
let secondInFlight = true;
try {
  await db.query(
    `insert into psp_requests (org_id, driver_id, internal_ref_id, idempotency_key, request_body, status)
       values ($1, $2, $3, 'k4', '{}'::jsonb, 'pending')`,
    [ORG, DRIVER, DRIVER],
  );
} catch {
  secondInFlight = false;
}
ok("a second in-flight request for the same driver is refused", !secondInFlight);


// ── 0219: provenance is a closed set, and the rate is on the row ───────────────────────────────
// P9 made the source of a PSP record a written field rather than a heuristic, and `pspRecordSource`
// answers `unknown` for anything it does not recognise. That reader stays defensive for rows written
// before this constraint — but there is no reason to keep ACCEPTING new rows that do not say. The
// failure this closes is a typo: `psp-api` in a jsonb blob writes successfully and then reads as
// unknown forever, in the field that decides whether a UI may render inspection counts.
const insertRecord = async (kind, detail) => {
  try {
    await db.query(
      `insert into qualification_records (org_id, driver_id, kind, occurred_on, detail)
         values ($1, $2, $3, '2026-08-01', $4::jsonb)`,
      [ORG, DRIVER, kind, detail],
    );
    return true;
  } catch {
    return false;
  }
};

ok("an ordered PSP record states psp_api", await insertRecord("psp_report", '{"source":"psp_api"}'));
ok("an imported PSP record states portal_import", await insertRecord("psp_report", '{"source":"portal_import"}'));
ok("a PSP record with NO source is refused", !(await insertRecord("psp_report", "{}")));
ok("a typo'd source is refused at the write, not read as unknown forever", !(await insertRecord("psp_report", '{"source":"psp-api"}')));
// Scoped to the one kind: `detail` is shared by every kind and constraining the others would be
// inventing rules for evidence 0219 knows nothing about.
ok("other kinds are untouched by the rule", await insertRecord("mvr", "{}"));

ok(
  "psp_requests records the rate in effect, so an invoice can be reconciled",
  Number(
    (await one(
      `select count(*)::int as n from information_schema.columns
        where table_schema = 'public' and table_name = 'psp_requests' and column_name = 'unit_price_usd'`,
    )).n,
  ) === 1,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
