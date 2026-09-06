// FuelGuard — §40.25(j) return-to-duty matrix (migration 0237).
//
// 49 CFR §40.25(j) makes the employer ASK whether the applicant tested positive or refused a
// pre-employment test for a job they applied for but did not obtain in the preceding two years — and,
// if they admit it, forbids using them for a safety-sensitive function until they document completion
// of the return-to-duty process (§40.305). P8 shipped the question. 0237 is the half that acts on it.
//
// Five rules, and this file is where each is a fact rather than a comment:
//
//   1. The obligation is PROJECTED BY TRIGGER from the certified application onto `drivers`, so
//      there is no write path that can forget it. Only a literal `true` counts: `false` and `null`
//      are different facts, and `null` means the form never asked.
//   2. It is SET-ONLY. A driver who applies twice and answers no the second time has not unsigned
//      the first statement; the obligation attaches to the admission, and only the documentation
//      discharges it.
//   3. `return_to_duty` is a valid qualification-record and document kind.
//   4. It is a §382.401(a) TESTING record — admin and safety_manager, and NOT the recruiter, who is
//      told the block exists (a column on `drivers`) without being able to read the document.
//   5. ⚠ `merge_driver` needs no change, and that is PROVED here rather than assumed. The flag can
//      only be set by an insert into `driver_applications`, and MD010 refuses to merge any source
//      driver holding one — so the flag can never be dropped in silence. 0234's standing lesson.
//
// Run:  node supabase/tests/return-to-duty.test.mjs
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

const ACTOR = "00000000-0000-4000-8000-000000000001";
await db.query(`insert into auth.users (id, email) values ($1, 'admin@test') on conflict do nothing`, [ACTOR]);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const driver = async (name) =>
  (await one(`insert into drivers (org_id,full_name) values ($1,$2) returning id`, [ORG, name])).id;

const flagged = async (id) =>
  (await one(`select return_to_duty_required as f from drivers where id = $1`, [id])).f;

/** File a certified application carrying one answer to §40.25(j)'s question. */
const apply = async (driverId, answer) =>
  db.query(
    `insert into driver_applications (org_id, driver_id, payload, signed_name)
     values ($1, $2, $3::jsonb, 'Susan Godfrey')`,
    [ORG, driverId, JSON.stringify({ first_name: "Susan", prior_failed_pre_employment_test: answer })],
  );

const attempt = async (sql, params = []) => {
  try { await db.query(sql, params); return "OK"; } catch (e) { return e.code ?? `ERROR: ${e.message}`; }
};

// ── 1. The projection ─────────────────────────────────────────────────────────────────────────
const ADMITTED = await driver("Admitted Applicant");
ok("a driver starts with no obligation", (await flagged(ADMITTED)) === false);
await apply(ADMITTED, true);
ok("an application admitting a prior failed test raises the obligation", (await flagged(ADMITTED)) === true);

const DENIED = await driver("Denied Applicant");
await apply(DENIED, false);
ok("an application answering NO raises nothing", (await flagged(DENIED)) === false);

// ⚠ The case that made the contract field nullish: every application filed before P8 has no answer,
// and `driver_applications` is append-only so none of them can ever be back-filled. "The form never
// asked" is a different fact from "they said no", and neither is an admission.
const UNASKED = await driver("Applied Before The Question Existed");
await db.query(
  `insert into driver_applications (org_id, driver_id, payload, signed_name)
   values ($1, $2, '{"first_name":"Old"}'::jsonb, 'Old Application')`,
  [ORG, UNASKED],
);
ok("an application filed before the question existed raises nothing", (await flagged(UNASKED)) === false);

const NULLED = await driver("Explicit Null");
await apply(NULLED, null);
ok("an explicit null raises nothing either", (await flagged(NULLED)) === false);

// ── 2. Set-only ───────────────────────────────────────────────────────────────────────────────
await apply(ADMITTED, false);
ok(
  "a second application answering NO does not clear the obligation the first one created",
  (await flagged(ADMITTED)) === true,
);

// ── 3. The discharge is a filed record ────────────────────────────────────────────────────────
ok(
  "return_to_duty is a qualification-record kind",
  (await attempt(
    `insert into qualification_records (org_id, driver_id, kind, occurred_on)
     values ($1, $2, 'return_to_duty', '2026-08-23')`,
    [ORG, ADMITTED],
  )) === "OK",
);
ok(
  "and a document kind, so the SAP's paperwork can be attached to it",
  (await attempt(
    `insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, bytes, sha256)
     values (gen_random_uuid(), $1, 'driver', $2, 'return_to_duty', $3, 'application/pdf', 10, repeat('c',64))`,
    [ORG, ADMITTED, `${ORG}/driver/${ADMITTED}/rtd.pdf`],
  )) === "OK",
);

// ── 4. §382.401(a) custody ────────────────────────────────────────────────────────────────────
/** Read as an org member with the given app role (the JWT shape rls.test.mjs uses). */
async function countAs(role, sql) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ACTOR, org_id: ORG, user_role: role, role: "authenticated" }),
    ]);
    const res = await db.query(sql);
    await db.exec("rollback");
    return Number(res.rows[0].n);
  } catch (e) {
    await db.exec("rollback");
    return `ERROR: ${e.message}`;
  }
}
const RTD_RECORDS = "select count(*)::int as n from qualification_records where kind = 'return_to_duty'";
const RTD_DOCS = "select count(*)::int as n from documents where kind = 'return_to_duty'";

for (const [role, want] of [["admin", 1], ["safety_manager", 1], ["recruiter", 0], ["dispatcher", 0], ["fleet_manager", 0]]) {
  ok(`${role} ${want ? "reads" : "cannot read"} the return-to-duty record`, (await countAs(role, RTD_RECORDS)) === want);
  ok(`${role} ${want ? "reads" : "cannot read"} the return-to-duty document`, (await countAs(role, RTD_DOCS)) === want);
}

// ⚠ The recruiter's asymmetry, stated as a fact: they are told the driver is blocked, because the
// flag is a column on `drivers` and not a testing record, and they cannot open what lifts it.
ok(
  "the recruiter can still see THAT the driver is blocked",
  (await countAs("recruiter", `select count(*)::int as n from drivers where return_to_duty_required`)) === 1,
);

// ── 5. Merge (0234's lesson) ──────────────────────────────────────────────────────────────────
// Nothing was added to `merge_driver` and nothing needs to be — but the reason is a behaviour, so it
// is asserted. A flagged driver necessarily holds a `driver_applications` row, and MD010 refuses to
// move signed evidence: the duplicate is ARCHIVED (0235), never merged away.
const CANON = await driver("Canonical");
const merge = await attempt(`select merge_driver($1,$2,$3)`, [ORG, ADMITTED, CANON]);
ok("merging a flagged driver away is refused, so the obligation cannot be lost", merge === "MD010");
ok("and the flagged driver is still there, still flagged", (await flagged(ADMITTED)) === true);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
