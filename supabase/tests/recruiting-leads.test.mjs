// Ads D0 (ADS-AGENT-BUILD-WORKFLOW.md §4 D0, §1.2-9), migration 0553: recruiting's lead tables — the
// hiring profile and the opening (versions never change), the lead ledger (idempotent, attribution
// frozen, phone and email in the form dedupe compares), contacts and conversions (append-only for the
// service role too), match verdicts (recomputed, never edited), and the roster merge moving a conversion
// with the REAL `DRIVER_REASSIGNMENTS` list. The purge half is `purge-applicant.test.mjs`.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LEAD_CONTACT_DIRECTIONS, LEAD_CONTACT_METHODS, LEAD_CONTACT_OUTCOMES } from "../../packages/shared/dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

// The REAL merge list, parsed the way lint:driver-references parses it.
const tsSrc = readFileSync(join(SUPA, "..", "apps", "api", "src", "modules", "roster", "mergeDriver.ts"), "utf8");
const MOVES = [...tsSrc.matchAll(/\{\s*table:\s*"([a-z_][a-z0-9_]*)",\s*column:\s*"([a-z_][a-z0-9_]*)"(,\s*orgScoped:\s*true)?/g)]
  .map((m) => ({ table: m[1], column: m[2], org_scoped: !!m[3] }));
if (MOVES.length < 20) {
  console.error("could not parse DRIVER_REASSIGNMENTS");
  process.exit(1);
}

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

const TABLES = ["hiring_profiles", "hiring_profile_versions", "recruiting_openings", "recruiting_opening_versions",
  "recruiting_leads", "recruiting_contacts", "lead_match_verdicts", "lead_conversions"];
const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const ACTOR = randomUUID();
const driver = async (org, name) => (await one(`insert into drivers (org_id, full_name) values ($1, $2) returning id`, [org, name])).id;
const profileVersion = async (org) => {
  const p = (await one(`insert into hiring_profiles (org_id, name) values ($1, 'Class A regional') returning id`, [org])).id;
  return (await one(
    `insert into hiring_profile_versions (org_id, profile_id, version, requirements, created_by, created_by_name)
     values ($1, $2, 1, '{"min_age": 23}', $3, 'Dana') returning id`, [org, p, ACTOR])).id;
};
const lead = async (org, extra = {}) => {
  const cols = { channel: "meta", external_ref: randomUUID(), ...extra };
  const keys = Object.keys(cols);
  return (await one(
    `insert into recruiting_leads (org_id, ${keys.join(", ")}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")}) returning id`,
    [org, ...keys.map((k) => cols[k])])).id;
};

// ── 1. the tables are the service role's alone ───────────────────────────────────────────────────
const rls = (await db.query(
  `select c.relname, c.relrowsecurity, (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any ($1)`, [TABLES])).rows;
ok("all eight lead tables exist", rls.length === 8, JSON.stringify(rls.map((r) => r.relname)));
ok("every one has RLS on and no client policy (deny-all from a browser)",
  rls.every((r) => r.relrowsecurity && r.policies === 0), JSON.stringify(rls));
ok("recruiting_ai_outputs is deliberately not created (no Stage 1 writer; D3 adds it)",
  (await one(`select to_regclass('public.recruiting_ai_outputs') as t`)).t === null);

// ── 2. versions never change ─────────────────────────────────────────────────────────────────────
const PV = await profileVersion(ORG);
ok("a profile version cannot be edited (RL012)",
  (await sqlstate(`update hiring_profile_versions set requirements = '{"min_age": 21}' where id = $1`, [PV])) === "RL012");
ok("nor deleted (RL012)", (await sqlstate(`delete from hiring_profile_versions where id = $1`, [PV])) === "RL012");

const OPENING = (await one(`insert into recruiting_openings (org_id) values ($1) returning id`, [ORG])).id;
const openingVersion = (radius, pv = PV, org = ORG, opening = OPENING, version = 1) => sqlstate(
  `insert into recruiting_opening_versions (org_id, opening_id, version, profile_version_id, title, facts, area_label,
     area_latitude, area_longitude, area_radius_miles, area_reason, created_by, created_by_name)
   values ($1, $2, $3, $4, 'Class A regional', '{}', 'Joliet yard', 41.52, -88.08, $5, 'Drivers home weekly from the yard', $6, 'Dana')`,
  [org, opening, version, pv, radius, ACTOR]);
ok("an opening area under 15 miles is refused (Meta's employment floor)", (await openingVersion(14)) === "23514");
ok("an opening area over 500 miles is refused", (await openingVersion(501)) === "23514");
ok("an opening at 15 miles with a written reason is stored", (await openingVersion(15)) === null);
ok("an opening version cannot pin another carrier's profile version (composite FK)",
  (await openingVersion(50, await profileVersion(OTHER), ORG, OPENING, 2)) === "23503");
ok("an opening version cannot be edited (RL012)",
  (await sqlstate(`update recruiting_opening_versions set area_radius_miles = 40 where opening_id = $1`, [OPENING])) === "RL012");
ok("the opening has no ZIP column to fill",
  (await one(`select count(*)::int as n from information_schema.columns
               where table_name in ('recruiting_opening_versions', 'recruiting_openings', 'recruiting_leads') and column_name ilike '%zip%'`)).n === 0);
ok("the opening's status moves on the parent row",
  (await sqlstate(`update recruiting_openings set status = 'filled' where id = $1`, [OPENING])) === null);

// 0574 (LQ2a, Q-AD50): the opening names its recruiter on the parent row, never in a version.
const RECRUITER = (await one(`insert into auth.users (email) values ('recruiter@carrier.test') returning id`)).id;
ok("an opening names its recruiter on the parent row (0574)",
  (await sqlstate(`update recruiting_openings set recruiter_id = $2 where id = $1`, [OPENING, RECRUITER])) === null);
ok("a recruiter who is not a user is refused (0574 FK)",
  (await sqlstate(`update recruiting_openings set recruiter_id = $2 where id = $1`, [OPENING, randomUUID()])) === "23503");
await db.query(`delete from auth.users where id = $1`, [RECRUITER]);
ok("a deleted user leaves the opening unowned, not the opening gone (0574 on delete set null)",
  (await one(`select recruiter_id from recruiting_openings where id = $1`, [OPENING])).recruiter_id === null);
ok("the versions carry no recruiter: handing an opening over mints no new version (0574)",
  (await one(`select count(*)::int as n from information_schema.columns
               where table_name = 'recruiting_opening_versions' and column_name = 'recruiter_id'`)).n === 0);

// ── 3. the lead: idempotent, attribution frozen, comparable contact details ──────────────────────
const REF = "meta-lead-1";
const L1 = await lead(ORG, { external_ref: REF, opening_id: OPENING, campaign_ref: "camp-1", full_name: "Ray Driver" });
ok("the same lead twice is refused by its key (org, channel, external_ref)",
  (await sqlstate(`insert into recruiting_leads (org_id, channel, external_ref) values ($1, 'meta', $2)`, [ORG, REF])) === "23505");
ok("the same ref on another channel is another lead",
  (await sqlstate(`insert into recruiting_leads (org_id, channel, external_ref) values ($1, 'tiktok', $2)`, [ORG, REF])) === null);
ok("the same ref in another carrier is another lead",
  (await sqlstate(`insert into recruiting_leads (org_id, channel, external_ref) values ($1, 'meta', $2)`, [OTHER, REF])) === null);
ok("two pasted leads with no ref are both stored",
  (await sqlstate(`insert into recruiting_leads (org_id, channel) values ($1, 'paste'), ($1, 'paste')`, [ORG])) === null);
ok("a phone not in E.164 is refused (dedupe could never match it)",
  (await sqlstate(`insert into recruiting_leads (org_id, channel, phone_e164) values ($1, 'paste', '(312) 555-0100')`, [ORG])) === "23514");
ok("an email not in lower case is refused",
  (await sqlstate(`insert into recruiting_leads (org_id, channel, email_lower) values ($1, 'paste', 'Ray@Example.com')`, [ORG])) === "23514");
ok("a channel outside the shape is refused",
  (await sqlstate(`insert into recruiting_leads (org_id, channel) values ($1, 'Meta Ads')`, [ORG])) === "23514");
ok("a lead cannot name another carrier's opening (composite FK)",
  (await sqlstate(`insert into recruiting_leads (org_id, channel, opening_id) values ($1, 'paste', $2)`, [OTHER, OPENING])) === "23503");
ok("the recruiter corrects the name, phone, email, status and assignee",
  (await sqlstate(`update recruiting_leads set full_name = 'Raymond Driver', phone_e164 = '+13125550100',
                     email_lower = 'ray@example.com', status = 'contacted' where id = $1`, [L1])) === null);
for (const [col, val] of [["channel", "'tiktok'"], ["external_ref", "'other'"], ["campaign_ref", "'camp-2'"],
  ["source", "'cdljobs'"], ["opening_id", "null"], ["raw", `'{"edited": true}'`], ["received_at", "now() - interval '1 day'"]]) {
  ok(`a lead's ${col} never changes (RL013)`,
    (await sqlstate(`update recruiting_leads set ${col} = ${val} where id = $1`, [L1])) === "RL013");
}
ok("a lead never moves to another carrier",
  (await sqlstate(`update recruiting_leads set org_id = $2 where id = $1`, [L1, OTHER])) !== null);
ok("a status outside the list is refused",
  (await sqlstate(`update recruiting_leads set status = 'hired' where id = $1`, [L1])) === "23514");

// ── 4. verdicts: recomputed, never edited; evidence on every fact ────────────────────────────────
ok("a verdict that is not `unknown` must carry its evidence level",
  (await sqlstate(`insert into lead_match_verdicts (org_id, lead_id, profile_version_id, requirement, verdict)
                   values ($1, $2, $3, 'class_a', 'meets')`, [ORG, L1, PV])) === "23514");
ok("`unknown` stands without evidence — for a Meta lead's age it is the design",
  (await sqlstate(`insert into lead_match_verdicts (org_id, lead_id, profile_version_id, requirement, verdict)
                   values ($1, $2, $3, 'age', 'unknown')`, [ORG, L1, PV])) === null);
ok("a self-reported fact is stored with its level",
  (await sqlstate(`insert into lead_match_verdicts (org_id, lead_id, profile_version_id, requirement, verdict, evidence)
                   values ($1, $2, $3, 'class_a', 'meets', 'self_reported')`, [ORG, L1, PV])) === null);
ok("a verdict is never edited (RL014)",
  (await sqlstate(`update lead_match_verdicts set verdict = 'meets', evidence = 'verified' where lead_id = $1 and requirement = 'age'`, [L1])) === "RL014");
const loose = await lead(ORG);
await db.query(`insert into lead_match_verdicts (org_id, lead_id, profile_version_id, requirement, verdict) values ($1, $2, $3, 'age', 'unknown')`, [ORG, loose, PV]);
ok("an untouched lead is prunable, and its verdicts go with it",
  (await sqlstate(`delete from recruiting_leads where id = $1`, [loose])) === null
  && (await one(`select count(*)::int as n from lead_match_verdicts where lead_id = $1`, [loose])).n === 0);

// ── 5. contacts: a person's act, append-only for the service role too ────────────────────────────
const contact = (l, by = ACTOR) => sqlstate(
  `insert into recruiting_contacts (org_id, lead_id, direction, method, outcome, created_by, created_by_name)
   values ($1, $2, 'outbound', 'call', 'reached', $3, 'Dana')`, [ORG, l, by]);
ok("a contact needs the person who made it (D-LS6: no system actor)", (await contact(L1, null)) === "23502");
ok("a recruiter's call is recorded", (await contact(L1)) === null);
const contactWith = (col, value) => {
  const row = { direction: "outbound", method: "call", outcome: "reached", [col]: value };
  return sqlstate(
    `insert into recruiting_contacts (org_id, lead_id, direction, method, outcome, created_by, created_by_name)
     values ($1, $2, $3, $4, $5, $6, 'Dana')`, [ORG, L1, row.direction, row.method, row.outcome, ACTOR]);
};
const refused = [];
for (const [col, list] of [["direction", LEAD_CONTACT_DIRECTIONS], ["method", LEAD_CONTACT_METHODS], ["outcome", LEAD_CONTACT_OUTCOMES]]) {
  for (const value of list) if ((await contactWith(col, value)) !== null) refused.push(`${col}=${value}`);
}
ok("every direction, method and outcome the shared contract offers passes 0553's CHECKs", refused.length === 0);
await db.exec("set role service_role");
ok("the service role cannot edit a contact (RL010)",
  (await sqlstate(`update recruiting_contacts set note = 'edited' where lead_id = $1`, [L1])) === "RL010");
ok("nor delete one (RL010)", (await sqlstate(`delete from recruiting_contacts where lead_id = $1`, [L1])) === "RL010");
await db.exec("reset role");
ok("a contacted lead cannot be pruned out from under its contacts (on delete restrict)",
  (await sqlstate(`delete from recruiting_leads where id = $1`, [L1])) === "23001");

// ── 6. conversions: append-only, inside the carrier, one per lead ────────────────────────────────
const DUP = await driver(ORG, "Ray Driver (dup)");
const CANON = await driver(ORG, "Ray Driver");
const STRANGER = await driver(OTHER, "Somebody Else");
const convert = (l, d) => sqlstate(
  `insert into lead_conversions (org_id, lead_id, driver_id, converted_by, converted_by_name) values ($1, $2, $3, $4, 'Dana')`,
  [ORG, l, d, ACTOR]);
ok("a lead cannot become another carrier's applicant (composite FK)", (await convert(L1, STRANGER)) === "23503");
ok("a lead becomes an applicant", (await convert(L1, DUP)) === null);
ok("the same lead cannot be converted twice", (await convert(L1, CANON)) === "23505");
const L2 = await lead(ORG, { channel: "tiktok" });
ok("the same person from a second platform converts to the same applicant, keeping its own attribution",
  (await convert(L2, DUP)) === null);
await db.exec("set role service_role");
ok("the service role cannot rewrite who converted it (RL011)",
  (await sqlstate(`update lead_conversions set converted_by_name = 'Someone' where lead_id = $1`, [L1])) === "RL011");
ok("nor point it at another lead (RL011)",
  (await sqlstate(`update lead_conversions set lead_id = $2 where lead_id = $1`, [L1, L2])) === "RL011");
ok("nor delete it (RL010)", (await sqlstate(`delete from lead_conversions where lead_id = $1`, [L1])) === "RL010");
await db.exec("reset role");
// The purge flag opens a contact only for the applicant its lead became: a purge of somebody else, in the
// same transaction, must not.
await db.exec("begin");
await db.query(`select set_config('fuelguard.purging_applicant', $1, true)`, [CANON]);
const otherPurge = await sqlstate(`delete from recruiting_contacts where lead_id = $1`, [L1]);
await db.exec("rollback");
ok("another applicant's purge does not open the contacts of a lead converted to somebody else (RL010)",
  otherPurge === "RL010", `got ${otherPurge}`);
ok("a converted lead cannot be pruned (its attribution is what the conversion reads)",
  (await sqlstate(`delete from recruiting_leads where id = $1`, [L2])) === "23001");

// ── 7. the roster merge moves a conversion, with the real list ───────────────────────────────────
const without = JSON.stringify(MOVES.filter((m) => m.table !== "lead_conversions"));
const aborted = await sqlstate(`select merge_driver_v2($1, $2, $3, $4::jsonb)`, [ORG, DUP, CANON, without]);
ok("a merge whose list forgot lead_conversions aborts rather than lose the conversion", aborted !== null, `got ${aborted}`);
ok("and the conversions still name the duplicate after the aborted merge",
  (await one(`select count(*)::int as n from lead_conversions where driver_id = $1`, [DUP])).n === 2);
const merged = await sqlstate(`select merge_driver_v2($1, $2, $3, $4::jsonb)`, [ORG, DUP, CANON, JSON.stringify(MOVES)]);
ok("with the real DRIVER_REASSIGNMENTS a merge of a converted applicant completes", merged === null, `got ${merged}`);
ok("both conversions now name the surviving record, and nothing else about them changed",
  (await one(`select count(*)::int as n from lead_conversions where driver_id = $1 and converted_by_name = 'Dana'
                 and lead_id in ($2, $3)`, [CANON, L1, L2])).n === 2);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
