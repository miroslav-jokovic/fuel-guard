// FuelGuard — employer_inquiries matrix (migration 0223, EMPLOYER-INQUIRY-PLAN E3).
//
// §391.23(c)(2) requires a written record of "the previous employer's name and address, the date the
// previous employer was contacted, OR THE ATTEMPTS MADE, and the information received". When nobody
// answers, §391.23(c)(1) accepts documentation of good-faith efforts in place of a reply — so the
// attempts ARE the deliverable, and a record that could be edited after the fact would be a record
// of what somebody last claimed rather than of what was done.
//
// Two things are proven here and nowhere else: the append-only trigger refuses every edit to what
// was SENT while still allowing an outcome to be added, and §391.23(k)(2)'s "protect the records
// from disclosure to any person not directly involved in deciding whether to hire" is enforced by
// RLS for a dispatcher and a fleet_manager, not merely by the API.
//
// Applies EVERY migration, same as rls.test.mjs.
//
// Run:  node supabase/tests/employer-inquiries.test.mjs
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
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));



const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;
const DRIVER = (await one(
  `insert into drivers (org_id, full_name, status) values ($1,'Susan Godfrey','applicant') returning id`, [ORG],
)).id;
const EMP = (await one(
  `insert into driver_employment_history (org_id, driver_id, employer_name, employer_address_line1, started_on, ended_on)
   values ($1,$2,'Old Carrier','12 Depot Rd','2023-01-01','2025-06-30') returning id`,
  [ORG, DRIVER],
)).id;

// 0222's column, which §391.23(c)(2) requires and 0220's projection used to drop.
ok(
  "driver_employment_history can hold the employer's street address",
  (await one(`select employer_address_line1 as a from driver_employment_history where id = $1`, [EMP])).a === "12 Depot Rd",
);

const insertAttempt = async (contactedOn, body = 'Please confirm...') =>
  (await one(
    `insert into employer_inquiries
       (org_id, driver_id, employment_id, employer_name, employer_address, method, sent_to,
        contacted_on, wording_version, body_sent)
     values ($1,$2,$3,'Old Carrier','12 Depot Rd, Joliet, IL','post','12 Depot Rd',$4::date,'v1',$5)
     returning id`,
    [ORG, DRIVER, EMP, contactedOn, body],
  )).id;

const A1 = await insertAttempt("2026-08-01");
const A2 = await insertAttempt("2026-09-05");

ok("a second attempt is a second row, not an overwrite",
  Number((await one(`select count(*)::int as n from employer_inquiries where employment_id = $1`, [EMP])).n) === 2);
ok("an attempt starts out awaiting a reply",
  (await one(`select outcome from employer_inquiries where id = $1`, [A1])).outcome === "awaiting");

// ── the append-only rule ───────────────────────────────────────────────────────────────────────
const refuses = async (sql, params) => {
  try {
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  }
};

ok("the wording that was sent cannot be edited",
  await refuses(`update employer_inquiries set body_sent = 'something else' where id = $1`, [A1]));
ok("the address it was sent to cannot be edited",
  await refuses(`update employer_inquiries set employer_address = 'elsewhere' where id = $1`, [A1]));
ok("the date of contact cannot be moved",
  await refuses(`update employer_inquiries set contacted_on = '2026-01-01' where id = $1`, [A1]));
ok("the manner of contact cannot be rewritten",
  await refuses(`update employer_inquiries set method = 'email' where id = $1`, [A1]));

// ...but the outcome is exactly what an UPDATE is for.
await db.query(
  `update employer_inquiries set outcome = 'no_response', outcome_on = '2026-09-20' where id = $1`, [A1],
);
ok("a documented non-response can still be added",
  (await one(`select outcome from employer_inquiries where id = $1`, [A1])).outcome === "no_response");
await db.query(`update employer_inquiries set outcome = 'responded', outcome_on = '2026-09-25' where id = $1`, [A2]);
ok("and so can a real answer, on the attempt that got one",
  (await one(`select outcome from employer_inquiries where id = $1`, [A2])).outcome === "responded");

// ── §391.23(k)(2): who may read it ─────────────────────────────────────────────────────────────
const readAs = async (role, orgId) => {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: "00000000-0000-4000-8000-000000000001", org_id: orgId, user_role: role, role: "authenticated" }),
    ]);
    const n = Number((await one(`select count(*)::int as n from employer_inquiries`)).n);
    await db.exec("rollback");
    return n;
  } catch (e) {
    await db.exec("rollback");
    return `ERROR: ${e.message}`;
  }
};

ok("a recruiter reads the investigation record", (await readAs("recruiter", ORG)) === 2);
ok("a safety manager reads it", (await readAs("safety_manager", ORG)) === 2);
ok("an admin reads it", (await readAs("admin", ORG)) === 2);
// The population §391.23(k)(2) excludes — involved in the fleet, not in this hiring decision.
ok("a fleet manager does not", (await readAs("fleet_manager", ORG)) === 0);
ok("a dispatcher does not", (await readAs("dispatcher", ORG)) === 0);
ok("an auditor does not", (await readAs("auditor", ORG)) === 0);
ok("another org's recruiter sees nothing", (await readAs("recruiter", OTHER_ORG)) === 0);

// No client write policy at all: the API composes the wording and stamps the address.
const writeAs = async (role) => {
  await db.exec("begin");
  let wrote = false;
  await db.exec("set local role authenticated");
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: "00000000-0000-4000-8000-000000000001", org_id: ORG, user_role: role, role: "authenticated" }),
  ]);
  try {
    await db.query(
      `insert into employer_inquiries
         (org_id, driver_id, employment_id, employer_name, method, sent_to, contacted_on, wording_version, body_sent)
       values ($1,$2,$3,'X','post','x','2026-08-01','v1','x')`,
      [ORG, DRIVER, EMP],
    );
    wrote = true;
  } catch {
    wrote = false;
  }
  await db.exec("rollback");
  return wrote;
};
ok("not even a recruiter may write one from the client", !(await writeAs("recruiter")));
ok("nor an admin", !(await writeAs("admin")));


// ── 0224: the information received (§391.23(c)(2)'s third element) ─────────────────────────────
await db.query(
  `update employer_inquiries
      set response = $2::jsonb,
          outcome = 'responded',
          outcome_on = '2026-09-25'
    where id = $1`,
  [A2, JSON.stringify({
    employment_confirmed: true,
    verified_started_on: "2023-01-15",
    reports_no_accidents: false,
    accidents: [{ occurred_on: "2024-03-04", nature: "Rear-ended", fatalities: 0, injuries: 1, hazmat_spill: false }],
  })],
);
ok(
  "the employer's answer is stored on the attempt that asked",
  (await one(`select response -> 'verified_started_on' as d from employer_inquiries where id = $1`, [A2])).d === "2023-01-15",
);
ok(
  "and the §390.15(b)(1) elements survive the round trip",
  Number((await one(
    `select jsonb_array_length(response -> 'accidents') as n from employer_inquiries where id = $1`, [A2],
  )).n) === 1,
);

// The answer may be added and corrected; the QUESTION may not. This is the line 0223's trigger draws
// and 0224 must not have moved.
ok(
  "recording an answer still cannot rewrite the letter that asked",
  await refuses(`update employer_inquiries set body_sent = 'different question' where id = $1`, [A2]),
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
