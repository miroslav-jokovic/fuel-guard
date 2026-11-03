// 2026-11-03 lead-path audit H2, migration 0558: `purge_lead` empties an unconverted lead's personal details on
// request and leaves an anonymous tombstone — so the channel's backfill reads it as a duplicate, its contacts
// stay (D-RA12), and the do-not-contact hold on the number stays.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
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

const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const user = async () => (await one(`insert into auth.users (email) values (gen_random_uuid()::text || '@x.test') returning id`)).id;
const ADMIN = await user();
const RECRUITER = await user();
await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'dispatcher')`, [ORG, ADMIN, RECRUITER]);

const ingest = async (org, lead) => (await one(`select public.ingest_lead($1, $2::jsonb) as r`, [org, JSON.stringify(lead)])).r;
const metaLead = (ref, extra = {}) => ({ channel: "meta", external_ref: ref, full_name: "Ray Driver", phone_e164: "+17082365732",
  email_lower: "ray@example.com", campaign_ref: "camp-1", answers: { class_a_held: "yes" }, raw: { id: ref, field_data: [{ name: "full_name", values: ["Ray Driver"] }] }, ...extra });
const purge = async (org, leadId, actor) => (await one(`select public.purge_lead($1, $2, $3) as r`, [org, leadId, actor])).r;
const row = (id) => one(`select * from recruiting_leads where id = $1`, [id]);

const p = (await one(`insert into hiring_profiles (org_id, name) values ($1, 'Class A regional') returning id`, [ORG])).id;
const PV = (await one(`insert into hiring_profile_versions (org_id, profile_id, version, requirements, created_by, created_by_name)
  values ($1, $2, 1, '{"min_age": 23}', $3, 'Dana') returning id`, [ORG, p, ADMIN])).id;

// ── 1. a purge empties the person and keeps the tombstone ────────────────────────────────────────
const L1 = (await ingest(ORG, metaLead("L-1"))).lead_id;
await db.query(`insert into lead_match_verdicts (org_id, lead_id, profile_version_id, requirement, verdict) values ($1, $2, $3, 'age', 'unknown')`, [ORG, L1, PV]);
await db.query(`insert into recruiting_contacts (org_id, lead_id, direction, method, outcome, note, created_by, created_by_name)
  values ($1, $2, 'outbound', 'call', 'declined', 'asked not to be called again', $3, 'Dana')`, [ORG, L1, RECRUITER]);
await db.query(`insert into sms_suppressions (org_id, phone, reason) values ($1, '+17082365732', 'manual')`, [ORG]);
const r1 = await purge(ORG, L1, ADMIN);
ok("an admin's purge answers purged, one verdict deleted, one contact kept",
  r1.purged === true && r1.already === false && r1.verdicts_deleted === 1 && r1.contacts_kept === 1, JSON.stringify(r1));
const after = await row(L1);
ok("the name, phone, email, answers and raw payload are gone",
  after.full_name === null && after.phone_e164 === null && after.email_lower === null
  && JSON.stringify(after.answers) === "{}" && JSON.stringify(after.raw) === "{}", JSON.stringify(after));
ok("the tombstone keeps channel, the channel's id and campaign, is lost, and is stamped",
  after.channel === "meta" && after.external_ref === "L-1" && after.campaign_ref === "camp-1" && after.status === "lost" && after.purged_at !== null);
ok("its verdicts are gone", (await one(`select count(*)::int as n from lead_match_verdicts where lead_id = $1`, [L1])).n === 0);
ok("its contact is kept whole (D-RA12: contacts are evidence)",
  (await one(`select note from recruiting_contacts where lead_id = $1`, [L1])).note === "asked not to be called again");
ok("the do-not-contact hold on the number is kept: deleting it would re-open texting",
  (await one(`select count(*)::int as n from sms_suppressions where org_id = $1 and phone = '+17082365732' and lifted_at is null`, [ORG])).n === 1);

// ── 2. the channel cannot bring the person back ──────────────────────────────────────────────────
const again = await ingest(ORG, metaLead("L-1"));
ok("Meta handing the same lead again (the backfill, a webhook) is a duplicate of the tombstone", again.stored === "duplicate" && again.lead_id === L1);
const still = await row(L1);
ok("and the tombstone stays empty", still.full_name === null && still.phone_e164 === null && JSON.stringify(still.raw) === "{}");
ok("a second purge changes nothing and says so", (await purge(ORG, L1, ADMIN)).already === true);

// ── 3. a purged lead stays empty, and the exemption is for one lead only ─────────────────────────
ok("a name written back onto a purged lead is refused (RL044)",
  (await sqlstate(`update recruiting_leads set full_name = 'Ray Driver' where id = $1`, [L1])) === "RL044");
ok("its purge stamp cannot be cleared (RL013)",
  (await sqlstate(`update recruiting_leads set purged_at = null where id = $1`, [L1])) === "RL013");
const L2 = (await ingest(ORG, metaLead("L-2", { phone_e164: "+17082365799", email_lower: "ana@example.com", full_name: "Ana Lopez" }))).lead_id;
ok("outside a purge, the raw payload is still frozen (RL013)",
  (await sqlstate(`update recruiting_leads set raw = '{}' where id = $1`, [L2])) === "RL013");
const leak = await sqlstate(`do $$ begin perform set_config('fuelguard.purging_lead', '${L1}', true);
  update public.recruiting_leads set raw = '{}' where id = '${L2}'; end $$`);
ok("the purge exemption for one lead does not open another's raw payload (RL013)", leak === "RL013");

// ── 4. the refusals ──────────────────────────────────────────────────────────────────────────────
ok("a member who is not an admin cannot purge (RL042)", (await sqlstate(`select public.purge_lead($1, $2, $3)`, [ORG, L2, RECRUITER])) === "RL042");
ok("another carrier's admin is not this carrier's admin (RL042)",
  (await sqlstate(`select public.purge_lead($1, $2, $3)`, [OTHER, L2, ADMIN])) === "RL042");
await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'admin')`, [OTHER, ADMIN]);
ok("another carrier's lead reads as no lead (RL040)", (await sqlstate(`select public.purge_lead($1, $2, $3)`, [OTHER, L2, ADMIN])) === "RL040");
ok("a missing argument is refused (RL043)", (await sqlstate(`select public.purge_lead($1, null, $2)`, [ORG, ADMIN])) === "RL043");
const DRIVER = (await one(`insert into drivers (org_id, full_name, status) values ($1, 'Ana Lopez', 'applicant') returning id`, [ORG])).id;
await db.query(`select public.convert_lead($1, $2, $3, $4, 'Dana')`, [ORG, L2, DRIVER, ADMIN]);
ok("a lead that became an applicant is refused: purge the applicant (RL041)",
  (await sqlstate(`select public.purge_lead($1, $2, $3)`, [ORG, L2, ADMIN])) === "RL041");
ok("and it was left untouched", (await row(L2)).full_name === "Ana Lopez");

// ── 5. grants ────────────────────────────────────────────────────────────────────────────────────
const callable = (await db.query(
  `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('purge_lead', 'purging_lead')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`)).rows;
ok("neither function is executable by anon or authenticated", callable.length === 0, JSON.stringify(callable));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
