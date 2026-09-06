// FuelGuard — merge_driver evidence-preservation matrix (migrations 0203, 0234).
//
// The RLS matrix proves who may read and write; this file proves that folding a duplicate driver
// into the canonical one NEVER destroys or strands §391.51 evidence. Before 0203, the merge
// cascade-deleted the source driver's qualification_records (FK `on delete cascade`, 0129) and left
// documents.subject_id pointing at the deleted row (polymorphic, no FK, 0146). A dedup pass over a
// duplicated roster would have quietly erased MVRs, drug tests and clearinghouse queries.
//
// 0234 extends it to the recruiting record, because the same bug happened a second time: nine tables
// referencing drivers(id) on delete cascade shipped AFTER 0203 and none of them was added to its
// list. Measured before the fix — `driver_employment_history`, `driver_authorizations` and
// `psp_requests` were destroyed outright; `driver_applications` and `esign_consents` made the merge
// die inside their own append-only triggers. The assertions below are the ones that were missing.
//
// Applies EVERY migration, same as rls.test.mjs, so the function under test is the one production
// runs — a hand-picked migration list is exactly how a stale merge_driver escaped notice before.
// ⚠ That protection was necessary and not sufficient: applying every migration proves the function
// is current, never that its LIST is complete. Only a row per referencing table can prove that, which
// is why this file now inserts one on the duplicate for every table a merge has to survive.
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

// ── 0234: the recruiting record follows the driver, and immutable evidence refuses the merge ──
//
// A second duplicate, carrying one row in every post-0203 table a merge is able to move. Built fresh
// rather than reusing DUPE above, which no longer exists.
const DUPE2 = (
  await one(`insert into drivers (org_id,full_name) values ($1,'ANGEL CORA DUP2') returning id`, [ORG])
).id;

const EMPLOYMENT = (
  await one(
    `insert into driver_employment_history (org_id, driver_id, employer_name, started_on, dot_regulated)
     values ($1, $2, 'Old Carrier', '2023-01-01', true) returning id`,
    [ORG, DUPE2],
  )
).id;
await db.query(
  `insert into employer_inquiries
     (org_id, driver_id, employment_id, kind, employer_name, method, sent_to, contacted_on, wording_version, body_sent, outcome)
   values ($1, $2, $3, 'safety_performance', 'Old Carrier', 'email', 'hr@old.test', '2026-02-01', 'v0-draft', 'text', 'awaiting')`,
  [ORG, DUPE2, EMPLOYMENT],
);
await db.query(
  `insert into driver_authorizations
     (org_id, driver_id, purpose, disclosure_version, disclosure_text, method, signed_name, intent_statement, accepted_at)
   values ($1, $2, 'psp', 'v0-draft', 'text', 'esign', 'Angel Cora', 'I authorize', now())`,
  [ORG, DUPE2],
);
await db.query(
  `insert into psp_requests (org_id, driver_id, internal_ref_id, idempotency_key, request_body, status)
   values ($1, $2, 'ref-1', 'key-1', '{}'::jsonb, 'pending')`,
  [ORG, DUPE2],
);
const INVITE = (
  await one(
    `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
     values ($1, $2, repeat('c', 64), now() + interval '7 days') returning id`,
    [ORG, DUPE2],
  )
).id;
await db.query(
  `insert into application_drafts (org_id, driver_id, invitation_id, payload) values ($1, $2, $3, '{}'::jsonb)`,
  [ORG, DUPE2, INVITE],
);
await db.query(
  `insert into application_captures (org_id, driver_id, invitation_id, slot, storage_path, content_type, bytes, sha256)
   values ($1, $2, $3, 'cdl_front', 'p/x.jpg', 'image/jpeg', 100, repeat('d', 64))`,
  [ORG, DUPE2, INVITE],
);

await db.query(`select merge_driver($1, $2, $3)`, [ORG, DUPE2, CANON]);

// One assertion per table, naming it, so a failure says which one the next merge_driver forgot.
for (const table of [
  "driver_employment_history",
  "employer_inquiries",
  "driver_authorizations",
  "psp_requests",
  "application_invitations",
  "application_drafts",
  "application_captures",
]) {
  ok(
    `${table} followed the driver instead of being cascade-deleted`,
    (await count(`select count(*)::int as n from ${table} where driver_id = $1`, [CANON])) === 1
      && (await count(`select count(*)::int as n from ${table}`)) === 1,
  );
}

// ── The three that may never move, and therefore stop the merge ───────────────────────────────
// `driver_applications` (DA010) and `esign_consents` (EC010) refuse UPDATE and DELETE outright.
// `sms_consents` (SC010) names `driver_id` in its guarded column list and its trigger covers UPDATE
// only — so before 0234 a cascade took it in silence, which is the worse of the two failure modes.
// Each is asserted on its own duplicate: a single fixture carrying all three would pass on the first
// check and prove nothing about the other two.
const refuses = async (label, seed) => {
  const dupe = (await one(`insert into drivers (org_id,full_name) values ($1,'Dup') returning id`, [ORG])).id;
  await seed(dupe);
  let code = null;
  try {
    await db.query(`select merge_driver($1, $2, $3)`, [ORG, dupe, CANON]);
  } catch (e) {
    code = e.code ?? null;
  }
  ok(`${label} refuses the merge with MD010 rather than destroying it`, code === "MD010");
  ok(
    `${label} survives the refused merge, and so does its driver`,
    (await count(`select count(*)::int as n from drivers where id = $1`, [dupe])) === 1,
  );
};

await refuses("a certified application", async (d) =>
  db.query(
    `insert into driver_applications (org_id, driver_id, payload, signed_name, certified_at)
     values ($1, $2, '{}'::jsonb, 'Angel Cora', now())`,
    [ORG, d],
  ),
);
await refuses("an e-sign consent", async (d) => {
  const i = (
    await one(
      `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
       values ($1, $2, repeat('e', 64), now() + interval '7 days') returning id`,
      [ORG, d],
    )
  ).id;
  await db.query(
    `insert into esign_consents (org_id, driver_id, invitation_id, disclosure_version, disclosure_text, intent_statement, consented_at)
     values ($1, $2, $3, 'v0-draft', 'text', 'I agree', now())`,
    [ORG, d, i],
  );
});
await refuses("an SMS consent", async (d) =>
  db.query(
    `insert into sms_consents (org_id, driver_id, phone, consent_text, consent_version, intent_statement, source)
     values ($1, $2, '+15550100', 'text', 'v0-draft', 'I agree', 'application')`,
    [ORG, d],
  ),
);

// The refusal must land BEFORE anything is written, not roll back after a dozen tables have moved.
// Proved on the visible half: the canonical driver's own recruiting rows are untouched by the three
// refused merges above, which they would not be if the function had run to the delete and unwound.
ok(
  "a refused merge left the canonical driver's recruiting record exactly as it was",
  (await count(`select count(*)::int as n from driver_employment_history where driver_id = $1`, [CANON])) === 1
    && (await count(`select count(*)::int as n from driver_authorizations where driver_id = $1`, [CANON])) === 1,
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
