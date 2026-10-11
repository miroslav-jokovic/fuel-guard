// Silvicom 360 — the carrier's countersignature on the filed packet (migration 0387,
// HANDBOOK-SIGNING-PLAN.md §6, QH0).
//
// What must be a fact rather than a comment: a countersignature exists only between "the application is
// filed and the envelope was sent" and "the handbook is filed" (h4c's own order, D-HB7); one per
// invitation; it names a Representative of the same org and the application of the same invitation; it
// is born without its document and may gain one ONCE, and only this driver's filed application; nothing
// else about it ever changes, including against a cascade; and a Representative who countersigned
// cannot be deleted.
//
// Run:  node supabase/tests/packet-countersignatures.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const sqlstate = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
};

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text,
    name text, owner uuid, owner_id text, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const SHA = "b".repeat(64);
const CARRIER_LINES = "{p18c,p19ac,p19bc,p22c}";
const org = async (name) => (await one(`insert into organizations (id, name) values (gen_random_uuid(), $1) returning id`, [name])).id;
const ORG = await org("Carrier");
const OTHER = await org("Someone else");
const OFFICE = (await one(`insert into auth.users (email) values ('office@carrier.test') returning id`)).id;
const rep = async (o, name) => (await one(
  `insert into carrier_representatives (org_id, full_name, title, signature_path, created_by)
   values ($1, $2, 'Safety manager', $3, $4) returning id`, [o, name, `${o}/representatives/${name}.png`, OFFICE])).id;
const REP = await rep(ORG, "Miroslav Jokovic");
const OTHER_REP = await rep(OTHER, "Somebody Else");

/** A driver, an invitation in the given state, and (when filed) its application. */
const applicant = async (over = {}) => {
  const v = { submitted: true, sent: true, filed: false, expires: "now() + interval '10 days'", ...over };
  const d = (await one(`insert into drivers (org_id, full_name, status) values ($1, 'Jovana Petrović-Szczepańska', 'applicant') returning id`, [ORG])).id;
  const inv = (await one(
    `insert into application_invitations (org_id, driver_id, token_hash, expires_at, submitted_at, signing_opened_at, handbook_filed_at)
     values ($1, $2, md5(random()::text), ${v.expires}, ${v.submitted ? "now()" : "null"}, ${v.sent ? "now()" : "null"},
       ${v.filed ? "now()" : "null"}) returning id`, [ORG, d])).id;
  const app = (await one(
    `insert into driver_applications (org_id, driver_id, invitation_id, payload, signed_name)
     values ($1, $2, $3, '{}', 'Jovana Petrović-Szczepańska') returning id`, [ORG, d, inv])).id;
  return { d, inv, app };
};

const countersign = (a, over = {}) => {
  const m = { org: ORG, app: a.app, rep: REP, by: OFFICE, placements: CARRIER_LINES, sha: SHA, doc: null, ...over };
  return sqlstate(
    `insert into application_packet_countersignatures (org_id, invitation_id, application_id, representative_id, recorded_by,
       placements, source_sha256, document_id)
     values ($1, $2, $3, $4, $5, $6::text[], $7, $8)`,
    [m.org, a.inv, m.app, m.rep, m.by, m.placements, m.sha, m.doc]);
};
const docFor = async (o, driverId, kind = "employment_application") => (await one(
  `insert into documents (id, org_id, subject_type, subject_id, kind, storage_path, content_type, sha256)
   values (gen_random_uuid(), $1, 'driver', $2, $3, $4, 'application/pdf', $5)
   returning id`, [o, driverId, kind, `${o}/driver/${driverId}/${Math.random().toString(36).slice(2)}.pdf`, SHA])).id;

// ── 1. The order the database holds (PC020..PC026, h4c's own) ─────────────────────────────────────
const LIVE = await applicant();
ok("a countersignature on a filed application with the envelope sent is accepted", (await countersign(LIVE)) === null);
ok("a second one on the same invitation is refused by the index (23505)", (await countersign(LIVE)) === "23505");
const NOT_FILED = await applicant({ submitted: false, sent: false });
ok("before the application is filed: PC022", (await countersign(NOT_FILED)) === "PC022");
ok("filed but the envelope was never sent: PC023", (await countersign(await applicant({ sent: false }))) === "PC023");
ok("sent but the packet not filed — still PC022 (packet first)", (await countersign(await applicant({ submitted: false }))) === "PC022");
ok("after the handbook is filed: PC024", (await countersign(await applicant({ filed: true }))) === "PC024");
ok("on an expired link: PC021", (await countersign(await applicant({ expires: "now() - interval '1 day'" }))) === "PC021");
const REVOKED = await applicant();
await db.query(`update application_invitations set revoked_at = now() where id = $1`, [REVOKED.inv]);
ok("on a revoked link: PC021", (await countersign(REVOKED)) === "PC021");
ok("against another org's invitation: PC020", (await countersign(await applicant(), { org: OTHER, rep: OTHER_REP })) === "PC020");
ok("with another org's Representative: PC025", (await countersign(await applicant(), { rep: OTHER_REP })) === "PC025");
const SECOND = await applicant();
ok("with the application of a DIFFERENT invitation: PC026", (await countersign(SECOND, { app: LIVE.app })) === "PC026");
ok("born with a document already: PC010 (the copy is filed after the row)",
  (await countersign(await applicant(), { doc: await docFor(ORG, SECOND.d) })) === "PC010");

// ── 2. What a row must carry ────────────────────────────────────────────────────────────────────
ok("no office user is refused (23502)", (await countersign(await applicant(), { by: null })) === "23502");
ok("a driver's line among the placements is refused (23514)",
  (await countersign(await applicant(), { placements: "{p18c,p18}" })) === "23514");
ok("a handbook place among the placements is refused (23514)",
  (await countersign(await applicant(), { placements: "{h4c}" })) === "23514");
ok("a malformed source hash is refused (23514)", (await countersign(await applicant(), { sha: "abc" })) === "23514");
ok("an EMPTY placement list is accepted — the §391.21 summary has no carrier lines (D-HB10)",
  (await countersign(await applicant(), { placements: "{}" })) === null);
ok("a single carrier line is accepted (a later withdrawal is recorded, not assumed)",
  (await countersign(await applicant(), { placements: "{p18c}" })) === null);

// ── 3. The one write: the stamped copy's id, once, and only this driver's filed application ──────
const ROW = (await one(`select id from application_packet_countersignatures where invitation_id = $1`, [LIVE.inv])).id;
const setDoc = (id, doc) => sqlstate(`update application_packet_countersignatures set document_id = $2 where id = $1`, [id, doc]);
ok("another driver's document is refused (PC027)", (await setDoc(ROW, await docFor(ORG, SECOND.d))) === "PC027");
ok("a document of another kind is refused (PC027)", (await setDoc(ROW, await docFor(ORG, LIVE.d, "handbook"))) === "PC027");
const OTHER_DRIVER = (await one(`insert into drivers (org_id, full_name) values ($1, 'Other') returning id`, [OTHER])).id;
ok("another org's document is refused (PC027)", (await setDoc(ROW, await docFor(OTHER, OTHER_DRIVER))) === "PC027");
// The partial case: another org's document that names THIS driver (subject_id is polymorphic, no FK), so
// only the org check can refuse it — the driver check alone would pass it.
ok("another org's document naming this very driver is refused (PC027)",
  (await setDoc(ROW, await docFor(OTHER, LIVE.d))) === "PC027");
const COPY = await docFor(ORG, LIVE.d);
ok("this driver's filed application is accepted", (await setDoc(ROW, COPY)) === null);
ok("a second write of the document is refused (PC010)", (await setDoc(ROW, await docFor(ORG, LIVE.d))) === "PC010");
ok("clearing it again is refused (PC010)", (await setDoc(ROW, null)) === "PC010");
const UNSTAMPED = (await one(`select id from application_packet_countersignatures where placements = '{p18c}'`)).id;
ok("the document written together with another column is refused (PC010)",
  (await sqlstate(`update application_packet_countersignatures set document_id = $2, source_sha256 = $3 where id = $1`,
    [UNSTAMPED, await docFor(ORG, (await one(`select a.driver_id from application_packet_countersignatures c
       join driver_applications a on a.id = c.application_id where c.id = $1`, [UNSTAMPED])).driver_id), "c".repeat(64)])) === "PC010");
for (const [col, val] of [["representative_id", `'${REP}'`], ["placements", "'{p18c}'"], ["source_sha256", `'${"d".repeat(64)}'`],
  ["signed_at", "now() - interval '1 day'"], ["recorded_by", `'${OFFICE}'`]]) {
  ok(`${col} is never edited (PC010)`,
    (await sqlstate(`update application_packet_countersignatures set ${col} = ${val} where id = $1`, [UNSTAMPED])) === "PC010");
}

// ── 4. Append-only, and what that does to the Representative, the invitation and the document ────
ok("a countersignature is never deleted (PC010)",
  (await sqlstate(`delete from application_packet_countersignatures where id = $1`, [ROW])) === "PC010");
// The application's own guard (DA010) refuses the same cascade first, so it is switched off for this one
// statement, rolled back: what is under test is that THIS table's guard would refuse on its own.
await db.exec("begin");
await db.exec("alter table driver_applications disable trigger trg_driver_applications_append_only");
const cascade = await sqlstate(`delete from application_invitations where id = $1`, [LIVE.inv]);
await db.exec("rollback");
ok("deleting the invitation cannot take it along in silence, even with the application's guard off (PC010)",
  cascade === "PC010", `got ${cascade}`);
ok("a Representative who countersigned cannot be deleted (23001, on delete restrict)",
  (await sqlstate(`delete from carrier_representatives where id = $1`, [REP])) === "23001");
ok("the stamped copy it cites cannot be deleted from under it (23503)",
  (await sqlstate(`delete from documents where id = $1`, [COPY])) === "23503");

// ── 5. The purge is the one door out (0380's flag, 0387's branch) ───────────────────────────────
await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'admin')`, [ORG, OFFICE]);
const PURGED = await applicant();
await countersign(PURGED);
const purged = await sqlstate(`select purge_applicant($1, $2, $3)`, [ORG, PURGED.d, OFFICE]);
ok("purge_applicant deletes an applicant's countersignature with the rest of their file", purged === null, `got ${purged}`);
ok("…and none of theirs is left",
  (await one(`select count(*)::int c from application_packet_countersignatures where invitation_id = $1`, [PURGED.inv])).c === 0);
ok("…while another applicant's stays",
  (await one(`select count(*)::int c from application_packet_countersignatures where invitation_id = $1`, [LIVE.inv])).c === 1);

// ── 6a. 0388: a filed handbook implies a countersigned packet (QH2) ───────────────────────────────
const fileHandbook = (inv) => sqlstate(`update application_invitations set handbook_filed_at = now() where id = $1`, [inv]);
const SUMMARY = await applicant();
await countersign(SUMMARY, { placements: "{}" });
const summaryRow = (await one(`select id from application_packet_countersignatures where invitation_id = $1`, [SUMMARY.inv])).id;
ok("the §391.21 summary's row, before it cites its filing, does not satisfy it (PC030)", (await fileHandbook(SUMMARY.inv)) === "PC030");
await setDoc(summaryRow, await docFor(ORG, SUMMARY.d));
ok("…and does once it cites the driver's own filing (D-HB10: nothing stamped, still accounted for)",
  (await fileHandbook(SUMMARY.inv)) === null);
ok("an invitation with no countersignature at all is refused (PC030)", (await fileHandbook((await applicant()).inv)) === "PC030");
ok("another column of an unsigned invitation still updates — the guard watches handbook_filed_at only",
  (await sqlstate(`update application_invitations set expires_at = now() + interval '20 days' where id = $1`, [SECOND.inv])) === null);

// 0388's index: one D-HB11 record per countersignature.
const record = (cs) => sqlstate(
  `insert into qualification_records (org_id, driver_id, kind, occurred_on, reference, detail)
   values ($1, $2, 'employment_application', '2026-09-29', $3, jsonb_build_object('source', 'packet_countersign', 'countersignature_id', $3::text))`,
  [ORG, LIVE.d, cs]);
ok("the first record citing a countersigned copy is accepted", (await record(ROW)) === null);
ok("a second one for the same countersignature is refused (23505)", (await record(ROW)) === "23505");
// The partial case: a record from ANOTHER source naming the same countersignature (a later correction,
// which evidence files as a new row) must not be refused. The driver's own record below carries no
// countersignature_id, and NULLs never collide, so only this case can tell the index's source clause apart.
ok("a correction naming the same countersignature, from another source, is not refused by it",
  (await sqlstate(`insert into qualification_records (org_id, driver_id, kind, occurred_on, reference, detail)
    values ($1, $2, 'employment_application', '2026-09-30', $3, jsonb_build_object('source', 'correction', 'countersignature_id', $3::text))`,
    [ORG, LIVE.d, ROW])) === null);
ok("the driver's own §391.51(b)(1) record is not caught by that index",
  (await sqlstate(`insert into qualification_records (org_id, driver_id, kind, occurred_on, reference, detail)
    values ($1, $2, 'employment_application', '2026-09-29', 'app', '{"source":"certification"}')`, [ORG, LIVE.d])) === null
  && (await sqlstate(`insert into qualification_records (org_id, driver_id, kind, occurred_on, reference, detail)
    values ($1, $2, 'employment_application', '2026-09-29', 'app', '{"source":"certification"}')`, [ORG, LIVE.d])) === null);

// ── 6. RLS: on, no client policy ─────────────────────────────────────────────────────────────────
ok("RLS is enabled",
  (await one(`select relrowsecurity r from pg_class where relname = 'application_packet_countersignatures'`)).r === true);
ok("no policy is declared — deny-all is the design",
  (await one(`select count(*)::int c from pg_policies where tablename = 'application_packet_countersignatures'`)).c === 0);
await db.exec("begin");
await db.exec("set local role authenticated");
await db.query("select set_config('request.jwt.claims', $1, true)",
  [JSON.stringify({ sub: OFFICE, org_id: ORG, user_role: "admin" })]);
const seen = (await db.query(`select id from application_packet_countersignatures`)).rows.length;
await db.exec("rollback");
ok("an office user of the same org reads nothing through the client — the API is the only door", seen === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
