// LQ5a, migration 0578 (ADS-LEAD-INTAKE-PLAN.md): a recruiter closes a lead with a fixed reason, qualifies it after
// a reached call, or reopens it. The row in `recruiting_lead_closures` is the fact; `recruiting_leads.status` is its
// projection. Three reasons need evidence the database reads from `recruiting_contacts`; `duplicate` needs another
// lead of the same person; a `not_qualified:<requirement>` close also writes a verified `does_not_meet` verdict.
// `LEAD_CLOSE_REASONS` (shared) and the CHECK are held together here, as 0554's phone normalisation is. The outcome
// feed's stage CHECK is NOT widened here (adsSchemaParity holds it to the shared list) — that is LQ5b2's.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LEAD_CLOSE_REASONS, LEAD_REQUIREMENTS, UNREACHABLE_MIN_ATTEMPTS, statusAfterClose } from "../../packages/shared/dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name} ${extra}`); }
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

const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const user = async () => (await one(`insert into auth.users (email) values (gen_random_uuid()::text || '@x.test') returning id`)).id;
const ADMIN = await user();
const RECRUITER = await user();
await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'dispatcher')`, [ORG, ADMIN, RECRUITER]);

// A profile and an opening, so a not_qualified close has a version to write its verdict against.
const profile = await one(`select public.save_hiring_profile_version($1, null, 'Class A regional',
  '{"min_age":{"years":23,"reason":"r"},"min_class_a_years":{"years":2,"reason":"r"},"hazmat":{"mode":"preferred","reason":"r"},"disqualifiers":{"dui_any_vehicle_years":5,"preventable_accident_years":3,"reason":"r"}}'::jsonb,
  $2, 'Dana') as r`, [ORG, ADMIN]);
const PV = profile.r.version_id;
const opening = await one(`select public.save_opening_version($1, null, $2::jsonb, $3, 'Dana') as r`, [ORG, JSON.stringify({
  profile_version_id: PV, title: "OTR Class A", facts: {}, headcount: 2, area_label: "Chicago", area_latitude: 41.88,
  area_longitude: -87.63, area_radius_miles: 50, area_reason: "Drivers live within a day of the Chicago yard.",
}), ADMIN]);
const OPENING = opening.r.opening_id;

let n = 0;
const ingest = async (extra = {}) => {
  n += 1;
  const r = (await one(`select public.ingest_lead($1, $2::jsonb) as r`, [ORG, JSON.stringify({
    channel: "meta", external_ref: `L-${n}`, source: "instant_form", campaign_ref: "camp-1", opening_id: OPENING,
    full_name: `Driver ${n}`, phone_e164: `+1708236${String(5000 + n).padStart(4, "0")}`, email_lower: `d${n}@example.com`,
    answers: { class_a_held: "yes" }, raw: { id: `L-${n}` }, ...extra,
  })])).r;
  return r.lead_id;
};
const contact = (lead, outcome, direction = "outbound") => db.query(
  `insert into recruiting_contacts (org_id, lead_id, direction, method, outcome, created_by, created_by_name) values ($1, $2, $3, 'call', $4, $5, 'Dana')`,
  [ORG, lead, direction, outcome, RECRUITER]);
const close = (lead, reason, note = null, org = ORG) =>
  one(`select public.close_lead($1, $2, $3, $4, $5, 'Dana') as r`, [org, lead, reason, note, RECRUITER]).then((x) => x.r);
const closeState = (lead, reason, note = null, org = ORG) =>
  sqlstate(`select public.close_lead($1, $2, $3, $4, $5, 'Dana')`, [org, lead, reason, note, RECRUITER]);
const qualify = (lead) => one(`select public.qualify_lead($1, $2, null, $3, 'Dana') as r`, [ORG, lead, RECRUITER]).then((x) => x.r);
const qualifyState = (lead) => sqlstate(`select public.qualify_lead($1, $2, null, $3, 'Dana')`, [ORG, lead, RECRUITER]);
const reopen = (lead) => one(`select public.reopen_lead($1, $2, null, $3, 'Dana') as r`, [ORG, lead, RECRUITER]).then((x) => x.r);
const reopenState = (lead) => sqlstate(`select public.reopen_lead($1, $2, null, $3, 'Dana')`, [ORG, lead, RECRUITER]);
const status = async (lead) => (await one(`select status from recruiting_leads where id = $1`, [lead])).status;
const closures = (lead) => db.query(`select * from recruiting_lead_closures where lead_id = $1 order by seq`, [lead]).then((r) => r.rows);

// ── 1. the reason list and the CHECK are one list ────────────────────────────────────────────────
ok("the shared list derives one not_qualified reason per LEAD_REQUIREMENTS entry, plus six lost reasons",
  LEAD_CLOSE_REASONS.length === LEAD_REQUIREMENTS.length + 6, String(LEAD_CLOSE_REASONS.length));
let accepted = 0;
for (const reason of LEAD_CLOSE_REASONS) {
  const lead = await ingest();
  const st = await sqlstate(`insert into recruiting_lead_closures (org_id, lead_id, kind, reason, status_after, actor, actor_name) values ($1, $2, 'closed', $3, $4, $5, 'Dana')`,
    [ORG, lead, reason, statusAfterClose(reason), RECRUITER]);
  if (st === null) accepted += 1; else console.log(`    CHECK refused ${reason}: ${st}`);
}
ok("every shared reason passes the CHECK", accepted === LEAD_CLOSE_REASONS.length, `${accepted}/${LEAD_CLOSE_REASONS.length}`);
{
  const lead = await ingest();
  ok("a reason outside the list is refused by the CHECK (23514)",
    (await sqlstate(`insert into recruiting_lead_closures (org_id, lead_id, kind, reason, status_after, actor, actor_name) values ($1, $2, 'closed', 'not_qualified:home_time', 'not_qualified', $3, 'Dana')`, [ORG, lead, RECRUITER])) === "23514");
  ok("a close without a reason is refused (23514)",
    (await sqlstate(`insert into recruiting_lead_closures (org_id, lead_id, kind, reason, status_after, actor, actor_name) values ($1, $2, 'closed', null, 'lost', $3, 'Dana')`, [ORG, lead, RECRUITER])) === "23514");
  ok("a qualify with a reason is refused (23514)",
    (await sqlstate(`insert into recruiting_lead_closures (org_id, lead_id, kind, reason, status_after, actor, actor_name) values ($1, $2, 'qualified', 'spam', 'qualified', $3, 'Dana')`, [ORG, lead, RECRUITER])) === "23514");
}

// ── 2. a not_qualified close: status, closure row, verified verdict ─────────────────────────────
{
  const lead = await ingest();
  await contact(lead, "reached");
  const r = await close(lead, "not_qualified:class_a", "  said he drives a straight truck  ");
  ok("close answers closed with the status and a verdict written", r.closed === true && r.already === false && r.status === "not_qualified" && r.verdict_written === true, JSON.stringify(r));
  ok("the lead reads not_qualified", (await status(lead)) === "not_qualified");
  const rows = await closures(lead);
  ok("one closure row: kind closed, the reason, the status, the trimmed note, the actor",
    rows.length === 1 && rows[0].kind === "closed" && rows[0].reason === "not_qualified:class_a" && rows[0].status_after === "not_qualified"
    && rows[0].note === "said he drives a straight truck" && rows[0].actor === RECRUITER && rows[0].actor_name === "Dana", JSON.stringify(rows));
  const v = await one(`select requirement, verdict, evidence, detail from lead_match_verdicts where lead_id = $1 and requirement = 'class_a' order by computed_at desc limit 1`, [lead]);
  ok("a verified does_not_meet verdict on class_a names the closure",
    v && v.verdict === "does_not_meet" && v.evidence === "verified" && v.detail.hard === true && v.detail.closure_id === r.closure_id && v.detail.by === "recruiter", JSON.stringify(v));
  const again = await close(lead, "spam");
  ok("closing an already-closed lead changes nothing and says already", again.closed === false && again.already === true && again.status === "not_qualified");
  ok("and wrote no second row", (await closures(lead)).length === 1);
}
{
  const lead = await ingest({ opening_id: null });
  const r = await close(lead, "not_qualified:hazmat");
  ok("a lead with no opening is closed and the answer says no verdict was written", r.closed === true && r.verdict_written === false && (await status(lead)) === "not_qualified", JSON.stringify(r));
  ok("no verdict row exists for it", (await one(`select count(*)::int as c from lead_match_verdicts where lead_id = $1`, [lead])).c === 0);
}

// ── 3. evidence the reasons need, read from the contacts ledger ─────────────────────────────────
{
  const lead = await ingest();
  ok("not_interested without a reached call is refused (RL055)", (await closeState(lead, "not_interested")) === "RL055");
  await contact(lead, "voicemail");
  ok("a voicemail is not a reached call (RL055)", (await closeState(lead, "not_interested")) === "RL055");
  await contact(lead, "reached");
  const r = await close(lead, "not_interested");
  ok("with a reached call on record the lead closes as lost", r.closed === true && r.status === "lost" && (await status(lead)) === "lost");
}
{
  const lead = await ingest();
  ok("wrong_number without a wrong_number call is refused (RL055)", (await closeState(lead, "wrong_number")) === "RL055");
  await contact(lead, "wrong_number");
  ok("with one it closes as lost", (await close(lead, "wrong_number")).status === "lost");
}
{
  const lead = await ingest();
  for (let i = 1; i < UNREACHABLE_MIN_ATTEMPTS; i += 1) await contact(lead, i % 2 ? "no_answer" : "voicemail");
  ok(`unreachable with ${UNREACHABLE_MIN_ATTEMPTS - 1} attempts is refused (RL056)`, (await closeState(lead, "unreachable")) === "RL056");
  await contact(lead, "no_answer", "inbound");
  ok("an inbound row does not count as an attempt (RL056)", (await closeState(lead, "unreachable")) === "RL056");
  await contact(lead, "reached");
  ok("a reached call does not count as a no-answer attempt (RL056)", (await closeState(lead, "unreachable")) === "RL056");
  await contact(lead, "no_answer");
  ok(`with ${UNREACHABLE_MIN_ATTEMPTS} outbound no-answer/voicemail attempts it closes as lost`, (await close(lead, "unreachable")).status === "lost");
}
{
  const lead = await ingest();
  ok("duplicate with nobody sharing the phone or e-mail is refused (RL057)", (await closeState(lead, "duplicate")) === "RL057");
  const twin = await ingest({ phone_e164: (await one(`select phone_e164 from recruiting_leads where id = $1`, [lead])).phone_e164, email_lower: "other@example.com" });
  ok("with another lead on the same phone it closes as lost", (await close(lead, "duplicate")).status === "lost");
  ok("the twin is untouched", (await status(twin)) === "new");
}
{
  const lead = await ingest();
  ok("out_of_area needs no evidence", (await close(lead, "out_of_area")).status === "lost");
  ok("spam needs no evidence", (await close(await ingest(), "spam")).status === "lost");
}

// ── 4. qualify ───────────────────────────────────────────────────────────────────────────────────
{
  const lead = await ingest();
  ok("qualifying without a reached call is refused (RL055)", (await qualifyState(lead)) === "RL055");
  await contact(lead, "reached");
  const r = await qualify(lead);
  ok("after a reached call the lead is qualified", r.qualified === true && r.already === false && (await status(lead)) === "qualified", JSON.stringify(r));
  const rows = await closures(lead);
  ok("one closure row of kind qualified with no reason", rows.length === 1 && rows[0].kind === "qualified" && rows[0].reason === null && rows[0].status_after === "qualified");
  const again = await qualify(lead);
  ok("qualifying twice changes nothing and says already", again.qualified === false && again.already === true && (await closures(lead)).length === 1);
  ok("a qualified lead can still be closed (the call found something later)", (await close(lead, "not_qualified:dui")).status === "not_qualified");
  ok("a closed lead cannot be qualified: reopen first (RL058)", (await qualifyState(lead)) === "RL058");
}

// ── 5. reopen ────────────────────────────────────────────────────────────────────────────────────
{
  const lead = await ingest();
  ok("reopening an open lead is refused (RL059)", (await reopenState(lead)) === "RL059");
  await close(lead, "spam");
  const r = await reopen(lead);
  ok("a closed lead nobody ever contacted reopens as new", r.reopened === true && r.status === "new" && (await status(lead)) === "new", JSON.stringify(r));
  await contact(lead, "no_answer");
  await close(lead, "out_of_area");
  ok("a closed lead with a contact on record reopens as contacted", (await reopen(lead)).status === "contacted");
  const rows = await closures(lead);
  ok("every act is a row, in order: closed, reopened, closed, reopened",
    rows.map((x) => x.kind).join(",") === "closed,reopened,closed,reopened" && rows.every((x) => x.kind !== "reopened" || x.reason === null), JSON.stringify(rows.map((x) => x.kind)));
  ok("after reopening, not_interested still needs its reached call (RL055)", (await closeState(lead, "not_interested")) === "RL055");
}

// ── 6. the refusals every act shares ─────────────────────────────────────────────────────────────
{
  const lead = await ingest();
  ok("another carrier's lead reads as no lead (RL051)", (await closeState(lead, "spam", null, OTHER)) === "RL051");
  ok("a missing actor is refused (RL050)", (await sqlstate(`select public.close_lead($1, $2, 'spam', null, null, 'Dana')`, [ORG, lead])) === "RL050");
  ok("an empty actor name is refused (RL050)", (await sqlstate(`select public.qualify_lead($1, $2, null, $3, '  ')`, [ORG, lead, RECRUITER])) === "RL050");
  ok("an unknown reason is refused in words (RL054)", (await closeState(lead, "ghosted")) === "RL054");
  ok("a null reason is refused (RL054)", (await closeState(lead, null)) === "RL054");
  const driver = (await one(`insert into drivers (org_id, full_name, status) values ($1, 'Driver X', 'applicant') returning id`, [ORG])).id;
  await contact(lead, "reached");
  await db.query(`select public.convert_lead($1, $2, $3, $4, 'Dana')`, [ORG, lead, driver, RECRUITER]);
  ok("a converted lead refuses close (RL053)", (await closeState(lead, "spam")) === "RL053");
  ok("a converted lead refuses qualify (RL053)", (await qualifyState(lead)) === "RL053");
  ok("a converted lead refuses reopen (RL053)", (await reopenState(lead)) === "RL053");
}
{
  const lead = await ingest();
  await close(lead, "spam", "the note names the person");
  const purged = (await one(`select public.purge_lead($1, $2, $3) as r`, [ORG, lead, ADMIN])).r;
  ok("purge_lead empties the closures' notes and reports it", purged.purged === true && purged.closure_notes_cleared === 1, JSON.stringify(purged));
  ok("the closure row stays with its reason, note gone", (await closures(lead)).every((x) => x.reason === "spam" && x.note === null));
  ok("a purged lead refuses every act (RL052)", (await reopenState(lead)) === "RL052" && (await closeState(lead, "spam")) === "RL052");
  ok("a second purge reports nothing more to clear", (await one(`select public.purge_lead($1, $2, $3) as r`, [ORG, lead, ADMIN])).r.closure_notes_cleared === 0);
}

// ── 7. append-only ───────────────────────────────────────────────────────────────────────────────
{
  const lead = await ingest();
  await close(lead, "spam", "n");
  const [row] = await closures(lead);
  ok("a closure's reason cannot be edited (RL061)", (await sqlstate(`update recruiting_lead_closures set reason = 'out_of_area' where id = $1`, [row.id])) === "RL061");
  ok("a closure's note cannot be edited outside a purge (RL061)", (await sqlstate(`update recruiting_lead_closures set note = null where id = $1`, [row.id])) === "RL061");
  ok("the purge exemption for one lead does not open another lead's closure (RL061)",
    (await sqlstate(`do $$ begin perform set_config('fuelguard.purging_lead', '${await ingest()}', true); update public.recruiting_lead_closures set note = null where id = '${row.id}'; end $$`)) === "RL061");
  const applicant = (await one(`insert into drivers (org_id, full_name, status) values ($1, 'Driver Y', 'applicant') returning id`, [ORG])).id;
  const lead2 = await ingest();
  await contact(lead2, "reached");
  await qualify(lead2);
  await db.query(`select public.convert_lead($1, $2, $3, $4, 'Dana')`, [ORG, lead2, applicant, RECRUITER]);
  const purgeApp = await sqlstate(`select public.purge_applicant($1, $2, $3)`, [ORG, applicant, ADMIN]);
  ok("purge_applicant still removes a converted lead whole: its closures go with it (cascade)",
    purgeApp === null && (await one(`select count(*)::int as c from recruiting_lead_closures where lead_id = $1`, [lead2])).c === 0, String(purgeApp));
}

// ── 8. grants and RLS ────────────────────────────────────────────────────────────────────────────
{
  const callable = (await db.query(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('close_lead', 'qualify_lead', 'reopen_lead', 'lead_for_act', 'purge_lead')
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`)).rows;
  ok("none of the functions is executable by anon or authenticated", callable.length === 0, JSON.stringify(callable));
  ok("recruiting_lead_closures has row level security on", (await one(`select relrowsecurity as r from pg_class where oid = 'public.recruiting_lead_closures'::regclass`)).r === true);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
