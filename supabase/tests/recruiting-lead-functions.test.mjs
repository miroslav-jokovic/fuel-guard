// Ads D1a (ADS-AGENT-BUILD-WORKFLOW.md §4 D1), migration 0554: recruiting's lead functions — the phone
// normalisation held to `normalisePhone`, a lead stored once, the same person found by phone or email only,
// a lead converted to one applicant once, profile and opening versions numbered in order, and the queue
// showing a person once, newest first, paged without skipping or repeating.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalisePhone } from "../../packages/shared/dist/index.js";

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

const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const ACTOR = randomUUID();

// ── 1. phone_e164 is normalisePhone, value for value ─────────────────────────────────────────────
const PHONES = ["(708) 236-5732", "708.236.5732", "7082365732", "17082365732", "1 (708) 236-5732", "+17082365732",
  " +17082365732 ", "+447911123456", "+44 7911 123456", "236-5732", "", null, "abc", "+0123456789", "001447911123456",
  "+1 708 236 5732", "12345678901234567", "(123) 456-7890",
  // 11 digits not starting with 1 is not a US number written long, and a padded non-US E.164 is kept, trimmed.
  "27821234567", " +447911123456 "];
const mismatched = [];
for (const raw of PHONES) {
  const sql = (await one(`select public.phone_e164($1) as v`, [raw])).v;
  const ts = normalisePhone(raw);
  if (sql !== ts) mismatched.push({ raw, sql, ts });
}
ok(`phone_e164 agrees with normalisePhone on all ${PHONES.length} fixtures`, mismatched.length === 0, JSON.stringify(mismatched));

// ── 2. a lead is stored once ─────────────────────────────────────────────────────────────────────
const ingest = async (org, lead) => (await one(`select public.ingest_lead($1, $2::jsonb) as r`, [org, JSON.stringify(lead)])).r;
const meta = (ref, extra = {}) => ({ channel: "meta", external_ref: ref, full_name: "Ray Driver", phone_e164: "+17082365732",
  email_lower: "ray@example.com", campaign_ref: "camp-1", answers: { class_a_held: "yes" }, raw: { id: ref }, ...extra });
const first = await ingest(ORG, meta("L-1"));
ok("a new lead is stored and answered `new`", first.stored === "new" && typeof first.lead_id === "string");
const again = await ingest(ORG, meta("L-1", { full_name: "Somebody Else", raw: { id: "L-1", retried: true } }));
ok("the same lead again (a retried webhook) answers `duplicate` with the first id", again.stored === "duplicate" && again.lead_id === first.lead_id);
ok("and the repeat changed nothing on the stored row",
  (await one(`select full_name, raw from recruiting_leads where id = $1`, [first.lead_id])).full_name === "Ray Driver");
ok("there is one row for that lead", (await one(`select count(*)::int as n from recruiting_leads where external_ref = 'L-1'`)).n === 1);
ok("the same ref in another carrier is that carrier's own lead", (await ingest(OTHER, meta("L-1"))).stored === "new");
ok("a lead without a channel is refused (RL032)",
  (await sqlstate(`select public.ingest_lead($1, '{"external_ref":"x"}'::jsonb)`, [ORG])) === "RL032");
ok("a phone the contract did not normalise is refused by the table, loudly",
  (await sqlstate(`select public.ingest_lead($1, $2::jsonb)`, [ORG, JSON.stringify(meta("L-bad", { phone_e164: "(708) 236-5732" }))])) === "23514");

// ── 3. the same person, found by phone or email only ─────────────────────────────────────────────
const applicant = (await one(
  `insert into drivers (org_id, full_name, phone, status) values ($1, 'Ray D.', '(708) 236-5732', 'applicant') returning id`, [ORG])).id;
const former = (await one(
  `insert into drivers (org_id, full_name, email, status) values ($1, 'Raymond', ' Ray@Example.com ', 'active') returning id`, [ORG])).id;
await db.query(`insert into drivers (org_id, full_name, phone) values ($1, 'Ray Driver', '(708) 236-5732')`, [OTHER]);
await db.query(`insert into drivers (org_id, full_name, phone) values ($1, 'Ray Driver', '(312) 555-0100')`, [ORG]);
const tiktok = await ingest(ORG, { channel: "tiktok", external_ref: "T-9", phone_e164: "+17082365732" });
const driverIds = tiktok.matches.drivers.map((d) => d.id).sort();
ok("a lead from a second platform is stored as its own lead (its own attribution)", tiktok.stored === "new");
ok("it names the first lead as the same person", tiktok.matches.leads.map((l) => l.id).join() === first.lead_id);
ok("it finds the applicant whose free-text phone normalises to the same number", driverIds.includes(applicant));
ok("it finds the employed driver by email, case and spaces aside", (await ingest(ORG, meta("L-2"))).matches.drivers.some((d) => d.id === former));
ok("another carrier's driver with the same phone is never named", !driverIds.some((id) => id !== applicant && id !== former) && driverIds.length === 1);
ok("a namesake with another phone is not the same person (no name matching)",
  (await ingest(ORG, { channel: "paste", full_name: "Ray Driver", phone_e164: "+13125550199" })).matches.drivers.length === 0);

// ── 4. a lead becomes one applicant once ─────────────────────────────────────────────────────────
const convert = (lead, driver, org = ORG) => one(`select public.convert_lead($1, $2, $3, $4, 'Dana') as r`, [org, lead, driver, ACTOR]);
const convertErr = (lead, driver, org = ORG) => sqlstate(`select public.convert_lead($1, $2, $3, $4, 'Dana')`, [org, lead, driver, ACTOR]);
ok("another carrier's lead cannot be converted here (RL020)", (await convertErr(first.lead_id, applicant, OTHER)) === "RL020");
ok("a lead cannot become an employed driver (RL021)", (await convertErr(first.lead_id, former)) === "RL021");
// An open APPLICANT of another carrier, so only the carrier check can refuse it (not the status check).
const stranger = (await one(`insert into drivers (org_id, full_name, status) values ($1, 'Theirs', 'applicant') returning id`, [OTHER])).id;
ok("a lead cannot become another carrier's applicant (RL021)", (await convertErr(first.lead_id, stranger)) === "RL021");
const c1 = (await convert(first.lead_id, applicant)).r;
ok("a lead becomes the applicant roster created", c1.created === true && c1.driver_id === applicant);
ok("and reads `converted`", (await one(`select status from recruiting_leads where id = $1`, [first.lead_id])).status === "converted");
const c2 = (await convert(first.lead_id, applicant)).r;
ok("the same conversion again (a retried request) is answered, not refused", c2.created === false && c2.conversion_id === c1.conversion_id);
const other = (await one(`insert into drivers (org_id, full_name, status) values ($1, 'Second', 'applicant') returning id`, [ORG])).id;
ok("a converted lead cannot be converted to somebody else (RL022)", (await convertErr(first.lead_id, other)) === "RL022");
ok("the second platform's lead converts to the same applicant", (await convert(tiktok.lead_id, applicant)).r.created === true);
ok("a missing actor is refused (RL032)",
  (await sqlstate(`select public.convert_lead($1, $2, $3, null, 'Dana')`, [ORG, tiktok.lead_id, applicant])) === "RL032");

// ── 5. versions follow each other ────────────────────────────────────────────────────────────────
const saveProfile = (profile, name = "Class A regional", org = ORG) => one(
  `select public.save_hiring_profile_version($1, $2, $3, '{"min_age": 23}'::jsonb, $4, 'Dana') as r`, [org, profile, name, ACTOR]);
const p1 = (await saveProfile(null)).r;
ok("a first save creates the profile at version 1", p1.version === 1);
const p2 = (await saveProfile(p1.profile_id, "Class A regional — reefer")).r;
ok("the next save is version 2 of the same profile", p2.version === 2 && p2.profile_id === p1.profile_id);
ok("and renames it", (await one(`select name from hiring_profiles where id = $1`, [p1.profile_id])).name === "Class A regional — reefer");
ok("another carrier cannot save onto this profile (RL030)",
  (await sqlstate(`select public.save_hiring_profile_version($1, $2, 'x', '{}'::jsonb, $3, 'Dana')`, [OTHER, p1.profile_id, ACTOR])) === "RL030");
await db.query(`update hiring_profiles set archived_at = now() where id = $1`, [p1.profile_id]);
ok("an archived profile takes no new version (RL031)",
  (await sqlstate(`select public.save_hiring_profile_version($1, $2, 'x', '{}'::jsonb, $3, 'Dana')`, [ORG, p1.profile_id, ACTOR])) === "RL031");

const opening = (pv, radius = 50) => JSON.stringify({ profile_version_id: pv, title: "Class A regional", facts: {},
  headcount: 3, area_label: "Joliet yard", area_latitude: 41.52, area_longitude: -88.08, area_radius_miles: radius,
  area_reason: "Home weekly from the yard" });
const saveOpening = (id, pv, radius) => one(
  `select public.save_opening_version($1, $2, $3::jsonb, $4, 'Dana') as r`, [ORG, id, opening(pv, radius), ACTOR]);
const o1 = (await saveOpening(null, p2.version_id, 50)).r;
ok("a first save creates the opening at version 1", o1.version === 1);
ok("the next save is version 2", (await saveOpening(o1.opening_id, p2.version_id, 60)).r.version === 2);
const otherPv = (await saveProfile(null, "Theirs", OTHER)).r.version_id;
ok("an opening cannot pin another carrier's profile version (RL034)",
  (await sqlstate(`select public.save_opening_version($1, null, $2::jsonb, $3, 'Dana')`, [ORG, opening(otherPv), ACTOR])) === "RL034");
ok("an area under 15 miles is refused by the table",
  (await sqlstate(`select public.save_opening_version($1, null, $2::jsonb, $3, 'Dana')`, [ORG, opening(p2.version_id, 10), ACTOR])) === "23514");
ok("another carrier cannot save onto this opening (RL030)",
  (await sqlstate(`select public.save_opening_version($1, $2, $3::jsonb, $4, 'Dana')`, [OTHER, o1.opening_id, opening(otherPv), ACTOR])) === "RL030");

// ── 6. the queue: one person per row, newest first, paged ────────────────────────────────────────
const Q = await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Queue') returning id`).then((r) => r.id);
// `received_at` is frozen once written (RL013) and `ingest_lead` stamps it with now(), so leads ingested in
// one burst can share a millisecond and order by their random ids. The fixture inserts with explicit minutes.
const put = async (ref, phone, email, min, status = "new") => (await one(
  `insert into recruiting_leads (org_id, channel, external_ref, phone_e164, email_lower, status, received_at)
   values ($1, 'meta', $2, $3, $4, $5, $6) returning id`,
  [Q, ref, phone, email, status, new Date(Date.UTC(2026, 10, 3, 12, min)).toISOString()])).id;
const ann1 = await put("q1", "+13125550001", null, 1);
const bob = await put("q2", "+13125550002", "bob@example.com", 2);
const ann2 = await put("q3", null, null, 3); // no contact: its own person
const bobAgain = await put("q4", "+13125550099", "bob@example.com", 4); // same email as bob
const ann3 = await put("q5", "+13125550001", null, 5); // same phone as ann1
const lostCarl = await put("q6", "+13125550006", null, 6, "lost");
const carlAgain = await put("q7", "+13125550006", null, 7); // carl lost earlier, back again
const queue = async (before = null, limit = 50) => (await db.query(
  `select id, also from public.recruiting_lead_queue($1, array['new','contacted','qualified'], $2, $3, $4)`,
  [Q, before?.received_at ?? null, before?.id ?? null, limit])).rows;
const rows = await queue();
const ids = rows.map((r) => r.id);
ok("each person is one row: the later lead with the same phone rides on the first", ids.includes(ann1) && !ids.includes(ann3)
  && rows.find((r) => r.id === ann1).also.map((a) => a.id).join() === ann3);
ok("the same email joins two leads with different phones", ids.includes(bob) && !ids.includes(bobAgain));
ok("a lead with no phone or email is its own row", ids.includes(ann2));
ok("a person lost earlier who comes back is a new row, not hidden behind the closed one", ids.includes(carlAgain) && !ids.includes(lostCarl));
ok("four people, newest first by their first open lead", JSON.stringify(ids) === JSON.stringify([carlAgain, ann2, bob, ann1]),
  JSON.stringify(ids));
const times = (await db.query(`select id, received_at from recruiting_leads where org_id = $1`, [Q])).rows;
const byId = Object.fromEntries(times.map((t) => [t.id, t.received_at]));
const page1 = await queue(null, 2);
const page2 = await queue({ id: page1[1].id, received_at: byId[page1[1].id] }, 2);
const paged = [...page1, ...page2].map((r) => r.id);
ok("two pages of two hold every row once, in the same order as one page", JSON.stringify(paged) === JSON.stringify(ids),
  JSON.stringify({ paged, ids }));
ok("another carrier's leads are never in the queue",
  (await db.query(`select id from public.recruiting_lead_queue($1, array['new'])`, [OTHER])).rows.every((r) => r.id !== first.lead_id));

// ── 7. no client may call any of them ────────────────────────────────────────────────────────────
const callable = (await db.query(
  `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any ($1)
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`,
  [["phone_e164", "recruiting_lead_matches", "ingest_lead", "convert_lead", "save_hiring_profile_version",
    "save_opening_version", "recruiting_lead_queue"]])).rows;
ok("none of the seven functions is executable by anon or authenticated", callable.length === 0, JSON.stringify(callable));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
