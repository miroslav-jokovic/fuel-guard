// FuelGuard — merge_driver evidence-preservation matrix (migration 0203).
//
// The RLS matrix proves who may read and write; this file proves that folding a duplicate driver
// into the canonical one NEVER destroys or strands §391.51 evidence. Before 0203, the merge
// cascade-deleted the source driver's qualification_records (FK `on delete cascade`, 0129) and left
// documents.subject_id pointing at the deleted row (polymorphic, no FK, 0146). A dedup pass over a
// duplicated roster would have quietly erased MVRs, drug tests and clearinghouse queries.
//
// Applies EVERY migration, same as rls.test.mjs, so the function under test is the one production
// runs — a hand-picked migration list is exactly how a stale merge_driver escaped notice before.
//
// Run:  node supabase/tests/merge-driver-dqf.test.mjs
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

// The canonical driver and their EFS-provisioned duplicate.
const CANON = (
  await one(`insert into drivers (org_id,full_name) values ($1,'Angel Cora') returning id`, [ORG])
).id;
const DUPE = (
  await one(`insert into drivers (org_id,full_name) values ($1,'ANGEL CORA COMP') returning id`, [ORG])
).id;
// A bystander in another org whose evidence must not move.
const STRANGER = (
  await one(`insert into drivers (org_id,full_name) values ($1,'Angel Cora') returning id`, [OTHER_ORG])
).id;

// §391.51 events on the DUPLICATE — exactly what the cascade used to destroy.
await db.query(
  `insert into qualification_records (org_id, driver_id, kind, occurred_on) values
     ($1, $2, 'mvr', '2026-01-10'),
     ($1, $2, 'drug_test', '2026-02-01')`,
  [ORG, DUPE],
);
await db.query(
  `insert into qualification_records (org_id, driver_id, kind, occurred_on) values ($1, $2, 'mvr', '2026-03-01')`,
  [OTHER_ORG, STRANGER],
);

// Filed scans on the duplicate — what used to be stranded on a deleted id.
const DOC = (
  await one(
    `insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, bytes, sha256, uploaded_by)
     values (gen_random_uuid(), $1, 'driver', $2, 'mvr', $3, 'application/pdf', 100, repeat('a', 64), null)
     returning id`,
    [ORG, DUPE, `${ORG}/driver/${DUPE}/doc.pdf`],
  )
).id;
const STRANGER_DOC = (
  await one(
    `insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, bytes, sha256, uploaded_by)
     values (gen_random_uuid(), $1, 'driver', $2, 'mvr', $3, 'application/pdf', 100, repeat('b', 64), null)
     returning id`,
    [OTHER_ORG, STRANGER, `${OTHER_ORG}/driver/${STRANGER}/doc.pdf`],
  )
).id;

// A current certification on BOTH rows for the same kind — exercises the collision-safe move too.
await db.query(
  `insert into certifications (org_id, subject_type, subject_id, kind, effective_from, expires_at) values
     ($1, 'driver', $2, 'medical_card', '2026-06-01', '2027-06-01')`,
  [ORG, CANON],
);
await db.query(
  `insert into certifications (org_id, subject_type, subject_id, kind, effective_from, expires_at) values
     ($1, 'driver', $2, 'medical_card', '2026-01-01', '2026-12-01')`,
  [ORG, DUPE],
);

await db.query(`select merge_driver($1, $2, $3)`, [ORG, DUPE, CANON]);

ok(
  "duplicate driver row is gone",
  (await count(`select count(*)::int as n from drivers where id = $1`, [DUPE])) === 0,
);
ok(
  "qualification_records were reassigned, not cascade-deleted",
  (await count(`select count(*)::int as n from qualification_records where driver_id = $1`, [CANON])) === 2,
);
ok(
  "no qualification_records left on the deleted id",
  (await count(`select count(*)::int as n from qualification_records where driver_id = $1`, [DUPE])) === 0,
);
ok(
  "documents follow the driver instead of stranding",
  (await one(`select subject_id from documents where id = $1`, [DOC])).subject_id === CANON,
);
ok(
  "certifications all belong to the canonical driver",
  (await count(
    `select count(*)::int as n from certifications where subject_type='driver' and subject_id = $1`,
    [CANON],
  )) === 2,
);
ok(
  "colliding current certification was superseded, not duplicated",
  (await count(
    `select count(*)::int as n from certifications
      where subject_type='driver' and subject_id = $1 and kind='medical_card' and superseded_by is null`,
    [CANON],
  )) === 1,
);
ok(
  "another org's records did not move",
  (await count(`select count(*)::int as n from qualification_records where driver_id = $1`, [STRANGER])) === 1 &&
    (await one(`select subject_id from documents where id = $1`, [STRANGER_DOC])).subject_id === STRANGER,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
