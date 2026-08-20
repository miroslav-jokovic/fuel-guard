// FuelGuard — apply_driver_dob matrix (migration 0221, PSP-PLAN P0b).
//
// One rule, and it is the reason the function exists rather than a loop of PATCHes: a bulk import
// must NEVER overwrite a date of birth that is already on file. The shared planner also refuses such
// a row, but it decides that from a roster it read a moment earlier — and between that read and the
// write, somebody may have typed one in on the driver's own page. The `date_of_birth is null`
// predicate is what closes that window, and this file is where that claim is tested rather than
// asserted in a comment.
//
// Why it matters more than it sounds: a date of birth selects which human being a PSP or MVR request
// is about. A silent overwrite redirects a screening to a different person, bills for it (§8), and
// can file a record against somebody whose job depends on it.
//
// Applies EVERY migration, same as rls.test.mjs.
//
// Run:  node supabase/tests/driver-dob-import.test.mjs
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

const BLANK = (await one(
  `insert into drivers (org_id, full_name, status) values ($1,'Susan Godfrey','active') returning id`, [ORG],
)).id;
const KNOWN = (await one(
  `insert into drivers (org_id, full_name, status, date_of_birth) values ($1,'Gary Thomas','active','1970-01-05') returning id`, [ORG],
)).id;
const STRANGER = (await one(
  `insert into drivers (org_id, full_name, status) values ($1,'Jose Davis','active') returning id`, [OTHER_ORG],
)).id;

const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null ? null : String(v).slice(0, 10));
const dobOf = async (id) => day((await one(`select date_of_birth from drivers where id = $1`, [id])).date_of_birth);
const apply = (org, rows) =>
  db.query(`select public.apply_driver_dob($1, $2::jsonb) as n`, [org, JSON.stringify(rows)]);

// ── the ordinary case ──────────────────────────────────────────────────────────────────────────
const first = (await apply(ORG, [{ driver_id: BLANK, date_of_birth: "1949-12-11" }])).rows[0].n;
ok("a blank date of birth is filled in", (await dobOf(BLANK)) === "1949-12-11");
ok("and the function reports one row updated", Number(first) === 1);

// ── the rule ───────────────────────────────────────────────────────────────────────────────────
const overwrite = (await apply(ORG, [{ driver_id: KNOWN, date_of_birth: "1949-12-11" }])).rows[0].n;
ok("a date already on file is NOT overwritten", (await dobOf(KNOWN)) === "1970-01-05");
ok("and the caller is told nothing was updated", Number(overwrite) === 0);

// The race the planner cannot see: it matched this driver while the column was empty, and by the
// time the write lands somebody has typed one in on the driver's page.
const stale = (await apply(ORG, [{ driver_id: BLANK, date_of_birth: "1930-02-02" }])).rows[0].n;
ok("a stale plan cannot clobber a value written since it was made", (await dobOf(BLANK)) === "1949-12-11");
ok("and it updates nothing rather than failing", Number(stale) === 0);

// ── the tenant boundary ────────────────────────────────────────────────────────────────────────
const crossOrg = (await apply(ORG, [{ driver_id: STRANGER, date_of_birth: "1949-12-11" }])).rows[0].n;
ok("another org's driver is not touched", (await dobOf(STRANGER)) === null);
ok("and the cross-tenant row updates nothing", Number(crossOrg) === 0);

// ── shape ──────────────────────────────────────────────────────────────────────────────────────
const empty = (await apply(ORG, [])).rows[0].n;
ok("an empty batch is a no-op, not an error", Number(empty) === 0);

const B2 = (await one(
  `insert into drivers (org_id, full_name, status) values ($1,'Ann Blake','active') returning id`, [ORG],
)).id;
const mixed = (await apply(ORG, [
  { driver_id: B2, date_of_birth: "1980-03-04" },
  { driver_id: KNOWN, date_of_birth: "1999-09-09" },
  { driver_id: STRANGER, date_of_birth: "1999-09-09" },
])).rows[0].n;
ok("a mixed batch applies the one row it may and no others", Number(mixed) === 1 && (await dobOf(B2)) === "1980-03-04");
ok("the protected row survived the mixed batch", (await dobOf(KNOWN)) === "1970-01-05");

// A null date in the payload must not blank a column — the planner never sends one, and the
// predicate says so anyway.
const nulled = (await apply(ORG, [{ driver_id: B2, date_of_birth: null }])).rows[0].n;
ok("a null date in the payload changes nothing", Number(nulled) === 0 && (await dobOf(B2)) === "1980-03-04");

ok(
  "execute is granted to service_role only",
  Number(
    (await one(
      `select count(*)::int as n from information_schema.role_routine_grants
        where routine_name = 'apply_driver_dob' and grantee in ('anon','authenticated','PUBLIC')`,
    )).n,
  ) === 0,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
