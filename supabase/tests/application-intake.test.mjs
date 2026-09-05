// FuelGuard — application intake matrix (migration 0220, HIRING-PLAN.md H5).
//
// The applicant's submission is the only unauthenticated write in the product that accepts personal
// data, and it must be all-or-nothing. A submission that filed the document but left the link live
// invites a second person to submit over it; one that spent the link but filed nothing loses the
// applicant's work with no way to ask for it again. This proves the transaction, the single use, and
// the immutability of what was certified.
//
// The RULES about what a submission becomes live in packages/shared/src/applicationIntake.ts and are
// unit-tested there. This proves the database half.
//
// Applies EVERY migration, same as rls.test.mjs.
//
// Run:  node supabase/tests/application-intake.test.mjs
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
  await one(`insert into drivers (org_id, full_name, status) values ($1,'Susan Godfrey','applicant') returning id`, [ORG])
).id;
// A second applicant whose recruiter already typed a licence number off the physical card.
const CHECKED = (
  await one(
    `insert into drivers (org_id, full_name, status, cdl_number, cdl_state)
       values ($1,'Gary Thomas','applicant','ALREADY-TYPED','GA') returning id`,
    [ORG],
  )
).id;
const STRANGER = (
  await one(`insert into drivers (org_id, full_name, status) values ($1,'Jose Davis','applicant') returning id`, [OTHER_ORG])
).id;

const invite = async (org, driver, expires = "now() + interval '14 days'", hash = null) =>
  (
    await one(
      `insert into application_invitations (org_id, driver_id, token_hash, expires_at)
         values ($1, $2, $3, ${expires}) returning id`,
      [org, driver, hash ?? `hash-${driver}-${expires}`],
    )
  ).id;

const PAYLOAD = JSON.stringify({ first_name: "Susan", last_name: "Godfrey", certified: true });
const PATCH = JSON.stringify({
  first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
  cdl_number: "PA334554", cdl_state: "PA",
  // §391.23(a)(2), added by 0231. The whole value of the field is that it is PROJECTED: a maiden name
  // that stayed in the payload would be something we asked for, stored, and never used.
  other_names: ["Susan Smith", "Susan Marie Smith"],
});
const EMPLOYMENT = JSON.stringify([
  {
    employer_name: "Old Carrier", usdot_number: "123456", employer_city: "Joliet", employer_state: "IL",
    employer_phone: "555-0100", position_held: "Driver", started_on: "2023-01-01", ended_on: "2025-06-30",
    dot_regulated: true, operated_cmv: true, subject_to_fmcsr: true, safety_sensitive: true,
    reason_for_leaving: "Better route",
  },
  {
    employer_name: "A Warehouse", usdot_number: null, employer_city: null, employer_state: null,
    employer_phone: null, position_held: "Picker", started_on: "2021-01-01", ended_on: "2022-12-31",
    dot_regulated: false, operated_cmv: false, subject_to_fmcsr: null, safety_sensitive: null,
    reason_for_leaving: null,
  },
]);

const submit = (org, invitation, driver, patch = PATCH, employment = EMPLOYMENT) =>
  db.query(
    `select public.submit_driver_application($1,$2,$3,$4::jsonb,'Susan Godfrey','203.0.113.9','UA','6789',null,$5::jsonb,$6::jsonb) as r`,
    [org, invitation, driver, PAYLOAD, patch, employment],
  );

// ── the submission ─────────────────────────────────────────────────────────────────────────────
const INV = await invite(ORG, APPLICANT);
const result = (await submit(ORG, INV, APPLICANT)).rows[0].r;

ok("the certified application is filed", (await count(`select count(*)::int as n from driver_applications where driver_id = $1`, [APPLICANT])) === 1);
ok("the transaction returns the application id", Boolean(result.application_id));
ok(
  "the invitation's submit phase is spent in the same transaction",
  (await one(`select submitted_at from application_invitations where id = $1`, [INV])).submitted_at !== null,
);
ok(
  "the driver's identity is filled in from what they declared",
  (await one(`select cdl_number from drivers where id = $1`, [APPLICANT])).cdl_number === "PA334554",
);
ok(
  "the names a previous employer would know are projected onto the driver (§391.23(a)(2), 0231)",
  (await one(`select other_names from drivers where id = $1`, [APPLICANT])).other_names?.length === 2,
);
ok(
  "every declared employer becomes a row, marked as coming from the application",
  (await count(`select count(*)::int as n from driver_employment_history where driver_id = $1 and source = 'application'`, [APPLICANT])) === 2,
);
// §391.23(a)(2) applies to DOT-regulated employers only — a warehouse owes no safety-history inquiry.
ok(
  "only the DOT-regulated employer owes an inquiry",
  (await count(`select count(*)::int as n from driver_employment_history where driver_id = $1 and inquiry_status = 'pending'`, [APPLICANT])) === 1 &&
    (await count(`select count(*)::int as n from driver_employment_history where driver_id = $1 and inquiry_status = 'not_required'`, [APPLICANT])) === 1,
);
ok(
  "§391.51(b)(1) evidence cites the application",
  (await count(
    `select count(*)::int as n from qualification_records
      where driver_id = $1 and kind = 'employment_application' and reference = $2`,
    [APPLICANT, result.application_id],
  )) === 1,
);
ok("the last four are kept", (await one(`select ssn_last4 from driver_applications where driver_id = $1`, [APPLICANT])).ssn_last4 === "6789");

// ── single use ─────────────────────────────────────────────────────────────────────────────────
let replay = null;
try {
  await submit(ORG, INV, APPLICANT);
} catch (e) {
  replay = e;
}
// DA021 until 0225, DA022 since: the submit PHASE is spent, and the link itself is still alive so
// the driver can reach the signing ceremony through it (D-APP1). The phases have their own matrix,
// application-session.test.mjs; what is pinned here is that a second application cannot be filed.
ok("a spent invitation is refused", replay?.code === "DA022", String(replay?.code));
ok(
  "and the second attempt filed nothing",
  (await count(`select count(*)::int as n from driver_applications where driver_id = $1`, [APPLICANT])) === 1,
);

const EXPIRED = await invite(ORG, CHECKED, "now() - interval '1 day'");
let expired = null;
try {
  await submit(ORG, EXPIRED, CHECKED);
} catch (e) {
  expired = e;
}
ok("an expired invitation is refused", expired?.code === "DA021", String(expired?.code));

// ── the application never overwrites a value somebody checked against a document ───────────────
const INV2 = await invite(ORG, CHECKED);
await submit(ORG, INV2, CHECKED);
ok(
  "a licence number the recruiter already typed survives the applicant's answer",
  (await one(`select cdl_number from drivers where id = $1`, [CHECKED])).cdl_number === "ALREADY-TYPED",
);
ok(
  "while a field nobody had filled is taken from the application",
  String((await one(`select date_of_birth from drivers where id = $1`, [CHECKED])).date_of_birth).includes("1980"),
);
// An application that lists no other name leaves the column NULL rather than writing `{}`: "we never
// asked" and "they said none" are different facts, and array_agg over no rows gives that for free.
const NO_ALIAS = (
  await one(`insert into drivers (org_id, full_name, status) values ($1,'No Alias','applicant') returning id`, [ORG])
).id;
await db.query(
  `select public.submit_driver_application($1,$2,$3,$4::jsonb,'No Alias','203.0.113.9','UA','1111',null,
     '{"first_name":"No"}'::jsonb,'[]'::jsonb)`,
  [ORG, await invite(ORG, NO_ALIAS), NO_ALIAS, PAYLOAD],
);
ok(
  "an application that names no other name leaves the column null, not an empty array",
  (await one(`select other_names from drivers where id = $1`, [NO_ALIAS])).other_names === null,
);

// ── immutability: a certification somebody can edit afterwards is not a certification ──────────
let updated = null;
try {
  await db.query(`update driver_applications set signed_name = 'Someone Else' where driver_id = $1`, [APPLICANT]);
} catch (e) {
  updated = e;
}
ok("a filed application cannot be updated", updated?.code === "DA010", String(updated?.code));

let deleted = null;
try {
  await db.query(`delete from driver_applications where driver_id = $1`, [APPLICANT]);
} catch (e) {
  deleted = e;
}
ok("a filed application cannot be deleted", deleted?.code === "DA010");
ok(
  "and it is still there",
  (await count(`select count(*)::int as n from driver_applications where driver_id = $1`, [APPLICANT])) === 1,
);

// ── the tenant boundary is on the function's own parameters ────────────────────────────────────
const STRANGER_INV = await invite(OTHER_ORG, STRANGER);
let crossOrg = null;
try {
  await submit(ORG, STRANGER_INV, STRANGER);
} catch (e) {
  crossOrg = e;
}
ok("an invitation from another org is not found", crossOrg?.code === "DA020", String(crossOrg?.code));
ok(
  "and nothing was filed for them",
  (await count(`select count(*)::int as n from driver_applications where driver_id = $1`, [STRANGER])) === 0,
);

// ── A6: the §391.51(b)(1) record learns which document it cites ────────────────────────────────
// The PDF is drawn FROM the application, so it cannot exist inside the transaction that files it.
// `attach_application_document` is the one narrow act that closes that gap afterwards.
const DOC = (
  await one(
    // `documents.id` carries no default: the API mints the uuid so the storage path can be built
    // from it before the row exists (the `pspOrder.ts` filing pattern).
    `insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, bytes, sha256)
       values (gen_random_uuid(),$1,'driver',$2,'employment_application',$3,'application/pdf',1024,repeat('a',64)) returning id`,
    [ORG, APPLICANT, `${ORG}/driver/${APPLICANT}/app.pdf`],
  )
).id;
const attached = (await one(`select public.attach_application_document($1,$2,$3) as r`, [ORG, result.application_id, DOC])).r;
ok("the citation is attached", attached === true);
ok(
  "and the qualification record points at the document",
  (await one(
    `select document_id from qualification_records where kind = 'employment_application' and reference = $1`,
    [result.application_id],
  )).document_id === DOC,
);
// Idempotent by design: the PDF is regenerable, but the record cites the first one filed. A second
// render losing the race must not silently repoint evidence at a different copy.
const second = (await one(`select public.attach_application_document($1,$2,$3) as r`, [ORG, result.application_id, DOC])).r;
ok("attaching twice is a no-op, not a second answer", second === false);
const crossAttach = (await one(`select public.attach_application_document($1,$2,$3) as r`, [OTHER_ORG, result.application_id, DOC])).r;
ok("and another org cannot attach to it at all", crossAttach === false);

// ── neither table is reachable from a browser session ──────────────────────────────────────────
ok(
  "the intake function is service_role only",
  (await count(
    `select count(*)::int as n from information_schema.role_routine_grants
      where routine_name = 'submit_driver_application' and grantee in ('anon','authenticated','PUBLIC')`,
  )) === 0,
);
for (const table of ["application_invitations", "driver_applications"]) {
  ok(
    `${table} has RLS on and no client policies`,
    (await count(`select count(*)::int as n from pg_policies where tablename = $1`, [table])) === 0 &&
      (await one(`select relrowsecurity from pg_class where relname = $1`, [table])).relrowsecurity === true,
  );
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
