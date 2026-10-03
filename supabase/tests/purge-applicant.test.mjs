// FuelGuard — purge_applicant matrix (migration 0380, Q-AW40 P1).
//
// The owner ruled (2026-09-28) that an admin may delete an applicant outright. 0380 is the one
// door: a service-role function that refuses anybody who was ever hired and opens six delete guards
// for ONE applicant's rows through a transaction-local flag. This file is where each half of that
// is a fact:
//
//   1. An applicant with a row in every table an application writes is purged completely, and the
//      function says what it removed and which Storage objects the api must now delete.
//   2. It refuses (PA010) a driver hired by any of the four readings, (PA011) one with rows it does
//      not own, (PA012) one linked to an outside identity, (PA020) another carrier's driver, (PA030)
//      an actor who is not an admin — and a refusal deletes nothing.
//   3. The guards are not weakened: without the flag every one still refuses the service role, and
//      with the flag set for one applicant, another applicant's rows are still refused.
//   4. The flag does not outlive the call.
//
// Applies EVERY migration, on rls.test.mjs's model, with Supabase's real default privileges.
//
// Run:  node supabase/tests/purge-applicant.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

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
    bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now()
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
    "alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ADMIN = randomUUID();
const RECRUITER = randomUUID();
const OTHER_ADMIN = randomUUID();
for (const [id, email] of [[ADMIN, "admin@t"], [RECRUITER, "rec@t"], [OTHER_ADMIN, "admin@o"]])
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'O') returning id`)).id;
await db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,'admin'), ($1,$3,'recruiter'), ($4,$5,'admin')`,
  [ORG, ADMIN, RECRUITER, OTHER, OTHER_ADMIN]);

const SHA = "a".repeat(64);

/** Service-role call: no JWT claims, which is what the api is. Returns "OK" or the SQLSTATE. */
async function asService(sql, params = []) {
  try {
    await db.query(sql, params);
    return "OK";
  } catch (e) {
    return e.code ?? `ERROR: ${e.message}`;
  }
}
const purge = (org, driver, actor = ADMIN) =>
  asService(`select purge_applicant($1,$2,$3)`, [org, driver, actor]);

/**
 * An applicant with one row (at least) in every table an application writes. The invitation is
 * filed and its envelope sent (which opens the handbook, D-AW16), so handbook_marks' insert guard
 * admits a mark.
 */
async function seedApplicant(org, name) {
  const d = (await one(`insert into drivers (org_id, full_name, photo_path, status) values ($1,$2,$3,'applicant') returning id`,
    [org, name, `${org}/drivers/${name}.jpg`])).id;
  const inv = (await one(
    `insert into application_invitations (org_id, driver_id, token_hash, expires_at, submitted_at, signing_opened_at)
     values ($1,$2,$3, now() + interval '5 days', now(), now()) returning id`,
    [org, d, randomUUID()])).id;
  const adoption = randomUUID();
  await db.query(
    `insert into signature_adoptions (id, org_id, invitation_id, kind, typed_text, storage_path, sha256)
     values ($1,$2,$3,'signature',$4,$5,$6)`,
    [adoption, org, inv, name, `${org}/driver/${d}/${adoption}.png`, SHA]);
  const app = (await one(
    `insert into driver_applications (org_id, driver_id, invitation_id, payload, signed_name) values ($1,$2,$3,'{}',$4) returning id`,
    [org, d, inv, name])).id;
  const auth = (await one(
    `insert into driver_authorizations (org_id, driver_id, invitation_id, adoption_id, purpose, disclosure_version,
       disclosure_text, method, signed_name, intent_statement)
     values ($1,$2,$3,$4,'psp','v1','text','esign',$5,'I agree') returning id`,
    [org, d, inv, adoption, name])).id;
  // A revocation, so the self-referencing RESTRICT is exercised.
  await db.query(
    `insert into driver_authorizations (org_id, driver_id, purpose, disclosure_version, disclosure_text, method,
       signed_name, intent_statement, revokes, revoke_reason)
     values ($1,$2,'psp','v1','text','esign',$3,'I withdraw',$4,'changed my mind')`,
    [org, d, name, auth]);
  await db.query(
    `insert into esign_consents (org_id, driver_id, invitation_id, disclosure_version, disclosure_text, intent_statement)
     values ($1,$2,$3,'v1','text','I agree')`, [org, d, inv]);
  await db.query(
    `insert into application_packet_marks (org_id, invitation_id, adoption_id, placement_id, page, mark, anchor, affirmed, signed_name)
     values ($1,$2,$3,'p03',3,'signature','a','yes',$4)`, [org, inv, adoption, name]);
  await db.query(
    `insert into handbook_marks (org_id, invitation_id, adoption_id, placement_id, party, handbook_version, signed_name, affirmed)
     values ($1,$2,$3,'h1','driver','2026-09-01',$4,'yes')`, [org, inv, adoption, name]);
  const emp = (await one(
    `insert into driver_employment_history (org_id, driver_id, employer_name, started_on) values ($1,$2,'Acme','2020-01-01') returning id`,
    [org, d])).id;
  const inquiry = (await one(
    `insert into employer_inquiries (org_id, driver_id, employment_id, employer_name, method, sent_to, contacted_on,
       wording_version, body_sent) values ($1,$2,$3,'Acme','email','hr@acme','2026-09-01','v1','body') returning id`,
    [org, d, emp])).id;
  await db.query(
    `insert into employer_verification_calls (org_id, invitation_id, employer_key, employer_name, outcomes, called_by,
       answered_by, called_at, copied_inquiry_id)
     values ($1,$2,gen_random_uuid(),'Acme',
       '{"dates":"confirmed","position":"confirmed","reason":"confirmed","cmv":"confirmed","dot_tested":"confirmed"}',
       $3,'HR',now(),$4)`, [org, inv, ADMIN, inquiry]);
  await db.query(
    `insert into psp_requests (org_id, driver_id, internal_ref_id, idempotency_key, request_body) values ($1,$2,$3,$3,'{}')`,
    [org, d, randomUUID()]);
  await db.query(`insert into application_intakes (org_id, invitation_id) values ($1,$2)`, [org, inv]);
  await db.query(
    `insert into application_intake_licences (org_id, invitation_id, position, state_code, licence_number) values ($1,$2,0,'IL','X123')`,
    [org, inv]);
  await db.query(
    `insert into drug_test_appointments (org_id, invitation_id, site_name, site_address, window_start, arranged_by)
     values ($1,$2,'Lab','1 Main',now(),$3)`, [org, inv, ADMIN]);
  await db.query(
    `insert into applicant_travel (org_id, invitation_id, mode, depart_at, arrive_at, booked_by)
     values ($1,$2,'bus',now(),now() + interval '1 hour',$3)`, [org, inv, ADMIN]);
  await db.query(`insert into application_screen_events (org_id, invitation_id, screen, entered_at) values ($1,$2,'part1.identity',now())`,
    [org, inv]);
  await db.query(
    `insert into sms_outbox (org_id, driver_id, invitation_id, phone, template, params, reason, not_before, expires_at)
     values ($1,$2,$3,'+13125550100','nudge','{}','nudge',now(),now() + interval '1 day')`, [org, d, inv]);
  await db.query(
    `insert into sms_consents (org_id, driver_id, phone, consent_text, consent_version, intent_statement, source)
     values ($1,$2,'+13125550100','text','v1','I agree','application')`, [org, d]);
  await db.query(`insert into sms_suppressions (org_id, driver_id, phone, reason) values ($1,$2,$3,'stop')`,
    [org, d, `+1312555${String(Math.floor(Math.random() * 9000) + 1000)}`]);
  await db.query(`insert into application_edits (org_id, invitation_id, path) values ($1,$2,'["employers",0,"city"]')`, [org, inv]);
  await db.query(`insert into application_drafts (org_id, invitation_id, driver_id) values ($1,$2,$3)`, [org, inv, d]);
  await db.query(
    `insert into applicant_dispositions (org_id, driver_id, outcome, decided_on) values ($1,$2,'withdrawn','2026-09-01')`,
    [org, d]);
  const doc = (await one(
    `insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, sha256)
     values (gen_random_uuid(),$1,'driver',$2,'employment_application',$3,'application/pdf',$4) returning id`,
    [org, d, `${org}/driver/${d}/application.pdf`, SHA])).id;
  await db.query(
    `insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, sha256, derived_from, variant)
     values (gen_random_uuid(),$1,'driver',$2,'employment_application',$3,'image/webp',$4,$5,'thumb')`,
    [org, d, `${org}/driver/${d}/application.thumb.webp`, SHA, doc]);
  await db.query(
    `insert into application_captures (org_id, invitation_id, driver_id, slot, storage_path, content_type, sha256, promoted_document_id)
     values ($1,$2,$3,'cdl_front',$4,'image/jpeg',$5,$6)`,
    [org, inv, d, `${org}/${inv}/cdl_front.jpg`, SHA, doc]);
  // 0387: the carrier's countersignature, citing its stamped copy — the one row here that points at a
  // Representative, the application and a document at once, which is what fixes its place in the order.
  const repId = (await one(
    `insert into carrier_representatives (org_id, full_name, title, signature_path, created_by)
     values ($1,'Rep Resentative','Safety manager',$2,$3) returning id`,
    [org, `${org}/representatives/${randomUUID()}.png`, ADMIN])).id;
  const cs = (await one(
    `insert into application_packet_countersignatures (org_id, invitation_id, application_id, representative_id, recorded_by,
       placements, source_sha256) values ($1,$2,$3,$4,$5,'{p18c,p19ac,p19bc,p22c}',$6) returning id`,
    [org, inv, app, repId, ADMIN, SHA])).id;
  await db.query(`update application_packet_countersignatures set document_id = $2 where id = $1`, [cs, doc]);
  await db.query(
    `insert into certifications (org_id, subject_type, subject_id, kind, effective_from, document_id)
     values ($1,'driver',$2,'cdl','2026-01-01',$3)`, [org, d, doc]);
  await db.query(
    `insert into qualification_records (org_id, driver_id, kind, occurred_on, document_id)
     values ($1,$2,'employment_application','2026-09-01',$3)`, [org, d, doc]);
  return { d, inv, adoption };
}

// Every row in the database that belongs to this applicant, table by table — the ruler the purge
// is measured against. The table lists are READ FROM THE CATALOGUE, so a table added later that
// references drivers or invitations is counted without anybody editing this file.
const fkChildren = async (parent) =>
  (await db.query(
    `select c.conrelid::regclass::text as tbl, a.attname as col
       from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f' and c.confrelid = $1::regclass order by 1, 2`, [parent])).rows;
const DRIVER_FKS = await fkChildren("public.drivers");
const INVITATION_FKS = await fkChildren("public.application_invitations");

async function footprint(d, inv) {
  const out = {};
  for (const { tbl, col } of DRIVER_FKS)
    out[`${tbl}.${col}`] = await count(`select count(*)::int as n from ${tbl} where ${col} = $1`, [d]);
  for (const { tbl, col } of INVITATION_FKS)
    out[`${tbl}.${col}`] = await count(`select count(*)::int as n from ${tbl} where ${col} = $1`, [inv]);
  out["documents.subject_id"] = await count(`select count(*)::int as n from documents where subject_type='driver' and subject_id = $1`, [d]);
  out["certifications.subject_id"] = await count(`select count(*)::int as n from certifications where subject_type='driver' and subject_id = $1`, [d]);
  out["drivers.id"] = await count(`select count(*)::int as n from drivers where id = $1`, [d]);
  return out;
}
const total = (fp) => Object.values(fp).reduce((a, b) => a + b, 0);
// Key order is not meaning: jsonb returns its keys in its own order.
const canon = (v) =>
  Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
  : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// ── 1. A complete applicant is purged completely ──────────────────────────────────────────────
const A = await seedApplicant(ORG, "Ana Plicant");
const before = await footprint(A.d, A.inv);
const everyInvitationChild = INVITATION_FKS.every(({ tbl, col }) => before[`${tbl}.${col}`] > 0);
ok(
  "the fixture holds a row in every table that references application_invitations (so a new one fails here until it is seeded)",
  everyInvitationChild,
  JSON.stringify(INVITATION_FKS.filter(({ tbl, col }) => before[`${tbl}.${col}`] === 0)),
);
const ownedByDriver = ["application_invitations", "driver_applications", "driver_authorizations", "esign_consents",
  "application_drafts", "application_captures", "driver_employment_history", "employer_inquiries", "psp_requests",
  "qualification_records", "applicant_dispositions", "sms_consents", "sms_outbox", "sms_suppressions"];
ok(
  "and in every drivers-referencing table the purge owns",
  ownedByDriver.every((t) => before[`${t}.driver_id`] > 0),
  JSON.stringify(ownedByDriver.filter((t) => !(before[`${t}.driver_id`] > 0))),
);

const B = await seedApplicant(ORG, "Bo Standing");
const bBefore = await footprint(B.d, B.inv);

const result = (await one(`select purge_applicant($1,$2,$3) as r`, [ORG, A.d, ADMIN])).r;
const after = await footprint(A.d, A.inv);
const leftovers = Object.entries(after).filter(([k, n]) => n > 0 && k !== "sms_suppressions.driver_id");
ok("a complete applicant is purged: no row of theirs is left in any table", leftovers.length === 0, JSON.stringify(leftovers));
ok("the driver row itself is gone", after["drivers.id"] === 0);
ok(
  "the STOP outlives the person: the sms_suppressions row stays, its driver_id nulled",
  (await count(`select count(*)::int as n from sms_suppressions where driver_id is null and org_id = $1`, [ORG])) === 1,
);
ok("another applicant in the same org is untouched", same(await footprint(B.d, B.inv), bBefore));

const expectCounts = {
  drivers: 1, application_invitations: 1, driver_applications: 1, driver_authorizations: 2, esign_consents: 1,
  signature_adoptions: 1, application_packet_marks: 1, handbook_marks: 1, employer_verification_calls: 1,
  application_packet_countersignatures: 1,
  employer_inquiries: 1, driver_employment_history: 1, psp_requests: 1, application_intakes: 1,
  application_intake_licences: 1, drug_test_appointments: 1, applicant_travel: 1, application_screen_events: 1,
  sms_outbox: 1, sms_consents: 1, application_edits: 1, application_drafts: 1, application_captures: 1,
  applicant_dispositions: 1, documents: 2, certifications: 1, qualification_records: 1,
};
const wrongCounts = Object.entries(expectCounts).filter(([t, n]) => result.counts[t] !== n);
ok("it returns the count it deleted from each table", wrongCounts.length === 0,
  JSON.stringify({ wrongCounts, got: result.counts }));
ok(
  "and every Storage path it removed a row for, keyed by table",
  same(result.storage, {
    documents: [`${ORG}/driver/${A.d}/application.pdf`, `${ORG}/driver/${A.d}/application.thumb.webp`].sort(),
    application_captures: [`${ORG}/${A.inv}/cdl_front.jpg`],
    signature_adoptions: [`${ORG}/driver/${A.d}/${A.adoption}.png`],
    drivers: [`${ORG}/drivers/Ana Plicant.jpg`],
  }),
  JSON.stringify(result.storage),
);
ok(
  "the drivers audit trigger records the delete, by id",
  (await count(`select count(*)::int as n from audit_logs where entity = 'drivers' and entity_id = $1 and action = 'driver.delete'`, [A.d])) === 1,
);

// ── 2. The flag does not outlive the call ─────────────────────────────────────────────────────
ok(
  "the purge flag is cleared when the function returns",
  ((await one(`select coalesce(current_setting('fuelguard.purging_applicant', true), '') as v`)).v) === "",
);
await db.exec("begin");
const C = await seedApplicant(ORG, "Cy Inline");
await db.query(`select purge_applicant($1,$2,$3)`, [ORG, C.d, ADMIN]);
const flagAfter = (await one(`select coalesce(current_setting('fuelguard.purging_applicant', true), '') as v`)).v;
const leak = await asService(`delete from esign_consents where driver_id = $1`, [B.d]);
await db.exec("rollback");
ok("inside one explicit transaction, the flag is already cleared when the purge returns", flagAfter === "", `got ${flagAfter}`);
ok("inside one explicit transaction, the next statement after a purge is refused by the guards again", leak === "EC010", `got ${leak}`);

// ── 3. The guards are not weakened ────────────────────────────────────────────────────────────
const guarded = [
  ["drivers", `delete from drivers where id = $1`, "DR010", "d"],
  ["driver_applications", `delete from driver_applications where driver_id = $1`, "DA010", "d"],
  ["esign_consents", `delete from esign_consents where driver_id = $1`, "EC010", "d"],
  ["signature_adoptions", `delete from signature_adoptions where invitation_id = $1`, "SA010", "inv"],
  ["employer_verification_calls", `delete from employer_verification_calls where invitation_id = $1`, "EV010", "inv"],
  ["handbook_marks", `delete from handbook_marks where invitation_id = $1`, "HB011", "inv"],
  ["application_packet_countersignatures", `delete from application_packet_countersignatures where invitation_id = $1`, "PC010", "inv"],
];
for (const [t, sql, code, key] of guarded) {
  const got = await asService(sql, [B[key]]);
  ok(`without the flag, ${t} still refuses the service role (${code})`, got === code, `got ${got}`);
}
// The flag names ONE applicant: B's rows stay refused while it names somebody else.
for (const [t, sql, code, key] of guarded) {
  await db.exec("begin");
  await db.query(`select set_config('fuelguard.purging_applicant', $1, true)`, [randomUUID()]);
  const got = await asService(sql, [B[key]]);
  await db.exec("rollback");
  ok(`with the flag naming another driver, ${t} still refuses (${code})`, got === code, `got ${got}`);
}
// ...and names that one exactly: with B's id, each guarded delete of B's rows passes (rolled back).
for (const [t, sql, , key] of guarded) {
  await db.exec("begin");
  await db.query(`select set_config('fuelguard.purging_applicant', $1, true)`, [B.d]);
  // An adoption is still pointed at by the marks and authorizations it signed (RESTRICT), so those go
  // first — under the same flag, which is what lets the handbook mark go.
  if (t === "signature_adoptions") {
    await db.query(`delete from driver_authorizations where driver_id = $1 and revokes is not null`, [B.d]);
    for (const child of ["application_packet_marks", "handbook_marks", "driver_authorizations"])
      await db.query(`delete from ${child} where invitation_id = $1`, [B.inv]);
  }
  // The countersignature points at the application (0387), so it goes first — under the same flag.
  if (t === "driver_applications")
    await db.query(`delete from application_packet_countersignatures where invitation_id = $1`, [B.inv]);
  const got = t === "drivers" ? "skipped" : await asService(sql, [B[key]]);
  await db.exec("rollback");
  if (t !== "drivers") ok(`with the flag naming this applicant, ${t} lets their row go`, got === "OK", `got ${got}`);
}
ok("merge_driver's flag still opens the drivers guard (0235 is unchanged)", await (async () => {
  await db.exec("begin");
  const X = (await one(`insert into drivers (org_id, full_name) values ($1,'Merge Flag') returning id`, [ORG])).id;
  await db.query(`select set_config('fuelguard.merging_driver', 'on', true)`);
  const got = await asService(`delete from drivers where id = $1`, [X]);
  await db.exec("rollback");
  return got === "OK";
})());
ok("and B is still whole after all of that", same(await footprint(B.d, B.inv), bBefore));

// ── 4. Refusals, and a refusal deletes nothing ────────────────────────────────────────────────
async function refused(label, driver, inv, expected, actor = ADMIN, org = ORG) {
  const fp = await footprint(driver, inv);
  const got = await purge(org, driver, actor);
  ok(`${label} (${expected})`, got === expected, `got ${got}`);
  ok(`…and nothing of theirs was deleted`, same(await footprint(driver, inv), fp) && total(fp) > 0);
}

const H1 = await seedApplicant(ORG, "Hal Active");
// Through the hire itself: since 0386 (Q-AW21) nothing else may make an applicant active.
await db.query(`select public.hire_applicant($1, $2, '2026-09-01'::date, null, '[]'::jsonb)`, [ORG, H1.d]);
await refused("a hired driver is refused", H1.d, H1.inv, "PA010");

const H2 = await seedApplicant(ORG, "Hana Reverted");
await db.query(
  `insert into audit_logs (org_id, actor_id, action, entity, entity_id) values ($1,$2,'compliance.applicant_hired','drivers',$3)`,
  [ORG, ADMIN, H2.d]);
await refused("a driver edited back to 'applicant' after a hire is still refused, on the audit row", H2.d, H2.inv, "PA010");

const H3 = await seedApplicant(ORG, "Hugo Dated");
await db.query(`update drivers set hire_date = '2026-09-01' where id = $1`, [H3.d]);
await refused("a hire_date alone refuses", H3.d, H3.inv, "PA010");

const H4 = await seedApplicant(ORG, "Hedy Ended");
await db.query(`update drivers set termination_date = '2026-09-01' where id = $1`, [H4.d]);
await refused("a termination_date alone refuses", H4.d, H4.inv, "PA010");

const H5 = await seedApplicant(ORG, "Hank Status");
await db.query(`update drivers set status = 'terminated' where id = $1`, [H5.d]);
await refused("a status past 'applicant' alone refuses", H5.d, H5.inv, "PA010");

// An audit row for somebody else, or for an unrelated act, is not evidence about this driver.
const N1 = await seedApplicant(ORG, "Nia Neighbour");
await db.query(
  `insert into audit_logs (org_id, actor_id, action, entity, entity_id) values ($1,$2,'compliance.applicant_hired','drivers',$3),
     ($1,$2,'compliance.application_invited','drivers',$4)`,
  [ORG, ADMIN, H1.d, N1.d]);
ok("another driver's hire and this driver's other audit rows do not refuse", (await purge(ORG, N1.d)) === "OK");

const L1 = await seedApplicant(ORG, "Lu Linked");
await db.query(`update drivers set mcleod_driver_id = 'LULI01' where id = $1`, [L1.d]);
await refused("a driver with a McLeod id is refused", L1.d, L1.inv, "PA012");
const L2 = await seedApplicant(ORG, "Lea Account");
await db.query(`update drivers set user_id = $2 where id = $1`, [L2.d, RECRUITER]);
await refused("a driver with a driver-app account is refused", L2.d, L2.inv, "PA012");
const L3 = await seedApplicant(ORG, "Lars Telematic");
await db.query(`update drivers set samsara_driver_id = 'S-9' where id = $1`, [L3.d]);
await refused("a driver with a Samsara id is refused", L3.d, L3.inv, "PA012");
const L4 = await seedApplicant(ORG, "Liv Carded");
await db.query(`update drivers set efs_driver_id = 'E-9' where id = $1`, [L4.d]);
await refused("a driver with an EFS id is refused", L4.d, L4.inv, "PA012");

const R1 = await seedApplicant(ORG, "Rex Scored");
await db.query(
  `insert into driver_scores (org_id, driver_id, week_start, week_end, window_start, window_end)
   values ($1,$2,'2026-09-07','2026-09-13',now(),now())`, [ORG, R1.d]);
await refused("a driver with a row in a table the purge does not own is refused", R1.d, R1.inv, "PA011");
const R2 = await seedApplicant(ORG, "Ria Exported");
await db.query(`insert into dq_exports (org_id, kind, driver_ids, as_at) values ($1,'binder',array[$2::uuid],'2026-09-01')`, [ORG, R2.d]);
await refused("a driver named in a DQ export is refused", R2.d, R2.inv, "PA011");

const X1 = await seedApplicant(ORG, "Xavi Crossed");
await refused("another carrier cannot purge this carrier's applicant, even as its own admin", X1.d, X1.inv, "PA020", OTHER_ADMIN, OTHER);
await refused("an admin of another carrier cannot purge through this carrier's id", X1.d, X1.inv, "PA030", OTHER_ADMIN, ORG);
await refused("a recruiter is not an admin", X1.d, X1.inv, "PA030", RECRUITER);
ok("a missing driver is refused (PA020)", (await purge(ORG, randomUUID())) === "PA020");
ok("a null actor is refused (PA020)", (await purge(ORG, X1.d, null)) === "PA020");

// ── 5. Only the service role may call it ──────────────────────────────────────────────────────
for (const role of ["authenticated", "anon"]) {
  await db.exec("begin");
  let got;
  try {
    await db.exec(`set local role ${role}`);
    await db.query(`select purge_applicant($1,$2,$3)`, [ORG, X1.d, ADMIN]);
    got = "OK";
  } catch (e) {
    got = e.code;
  }
  await db.exec("rollback");
  ok(`${role} cannot execute purge_applicant (42501)`, got === "42501", `got ${got}`);
}
ok("and the last applicant is still whole", (await count(`select count(*)::int as n from drivers where id = $1`, [X1.d])) === 1);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
