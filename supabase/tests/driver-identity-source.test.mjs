// FuelGuard — identity_source provenance matrix (migration 0204, DQF-EXECUTION-PLAN A6 / D-DQ12).
//
// Proves the third provenance value and — the part a normal matrix cannot see — the BACKFILL:
// migrations up to 0203 apply first, rows are seeded in the pre-0204 world (where an EFS stub is
// forced to claim 'samsara'), and THEN 0204 applies. That is the only way to assert the backfill
// predicate against the exact shape of data it will meet in production, rather than asserting an
// UPDATE over an empty table and calling it tested.
//
// Run:  node supabase/tests/driver-identity-source.test.mjs
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
const CUTOVER = "0204_identity_source_efs.sql";
const before = MIGRATIONS.filter((f) => f < CUTOVER);
const after = MIGRATIONS.filter((f) => f >= CUTOVER);

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
const err = (p) => p.then(() => null, (e) => e.message);

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
for (const f of before)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// The pre-0204 world: one linked telematics driver, one manual driver, one EFS stub that the
// two-value CHECK forces to wear the 'samsara' label (exactly what efsIngest/driverAttribution wrote).
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const LINKED = (
  await one(
    `insert into drivers (org_id, full_name, samsara_driver_id, identity_source) values ($1,'Linked Driver','S1','samsara') returning id`,
    [ORG],
  )
).id;
const MANUAL = (
  await one(
    `insert into drivers (org_id, full_name, identity_source) values ($1,'Manual Person','manual') returning id`,
    [ORG],
  )
).id;
const STUB = (
  await one(`insert into drivers (org_id, full_name) values ($1,'CARD NAME COMP') returning id`, [ORG])
).id;

for (const f of after)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const src = async (id) => (await one(`select identity_source from drivers where id = $1`, [id])).identity_source;

ok("backfill: the link-less samsara-labeled stub becomes 'efs'", (await src(STUB)) === "efs");
ok("backfill: the linked telematics driver keeps 'samsara'", (await src(LINKED)) === "samsara");
ok("backfill: the manual driver keeps 'manual'", (await src(MANUAL)) === "manual");
ok(
  "the CHECK admits 'efs' on insert",
  (await err(
    db.query(`insert into drivers (org_id, full_name, identity_source) values ($1,'New Stub','efs')`, [ORG]),
  )) === null,
);
// ⚠ This assertion used 'mcleod' as its example of an invalid value, which 0239 then made VALID —
// the carrier's TMS became a fourth provenance. The intent is unchanged and still worth pinning: the
// CHECK has to keep CONSTRAINING, or a typo'd provenance silently becomes a new category and the
// surfaces that exclude EFS stubs start leaking. Only the example moved, to a string no migration is
// ever going to adopt.
ok(
  "the CHECK rejects a value outside the enumerated four",
  /check/i.test(
    (await err(
      db.query(`insert into drivers (org_id, full_name, identity_source) values ($1,'Bad','not-a-provenance')`, [ORG]),
    )) ?? "",
  ),
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
