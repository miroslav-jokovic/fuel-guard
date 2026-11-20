// The public apply page's schema (APPLY-PAGE-PLAN AP1; Q-APX31 (a), Q-APX34 (a)), migration 0641: one careers page per
// carrier with a handle people can type and an accommodation contact before it may be on; a texting consent that
// belongs to a lead OR a driver, never both or neither, whose subject cannot change; a STOP by number reaching a
// lead's consent; and a lead's purge taking its consents with it.
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
const ADMIN = (await one(`insert into auth.users (email) values ('admin@x.test') returning id`)).id;
await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'admin')`, [ORG, ADMIN]);

// ── 1. the careers page ──────────────────────────────────────────────────────────────────────────
const page = (org, cols) => {
  const keys = Object.keys(cols);
  return sqlstate(`insert into recruiting_careers_pages (org_id, ${keys.join(", ")}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")})`,
    [org, ...Object.values(cols)]);
};
for (const bad of ["Silvicom", "si", "-silvicom", "silvicom-", "silvi com", "silvicom_inc", "a".repeat(41)]) {
  ok(`a handle people type: ${JSON.stringify(bad)} is refused`, (await page(ORG, { handle: bad })) === "23514");
}
ok("a page cannot be on without an accommodation contact", (await page(ORG, { handle: "silvicom", enabled: true })) === "23514");
ok("an accommodation email is lower-case", (await page(ORG, { handle: "silvicom", accommodation_email: "Jobs@Silvicominc.com" })) === "23514");
ok("an accommodation phone is E.164", (await page(ORG, { handle: "silvicom", accommodation_phone: "708-236-5732" })) === "23514");
ok("a page on with an email is accepted", (await page(ORG, { handle: "silvicom", enabled: true, accommodation_email: "recruiting@silvicominc.com" })) === null);
ok("one careers page per carrier", (await page(ORG, { handle: "silvicom-2" })) === "23505");
ok("one carrier per handle", (await page(OTHER, { handle: "silvicom" })) === "23505");
ok("a page on with only a phone is accepted", (await page(OTHER, { handle: "other-carrier", enabled: true, accommodation_phone: "+17082365732" })) === null);
ok("its contact cannot be removed while it is on",
  (await sqlstate(`update recruiting_careers_pages set accommodation_phone = null where org_id = $1`, [OTHER])) === "23514");

// ── 2. a consent belongs to a lead or a driver ───────────────────────────────────────────────────
const ingest = async (org, ref, phone) => (await one(`select public.ingest_lead($1, $2::jsonb) as r`, [org, JSON.stringify({
  channel: "apply_page", external_ref: ref, full_name: "Ray Driver", phone_e164: phone, email_lower: null, answers: {}, raw: {} })])).r.lead_id;
const PHONE = "+17085550101";
const LEAD = await ingest(ORG, "form-1", PHONE);
const OLEAD = await ingest(OTHER, "form-1", "+17085550102");
const DRIVER = (await one(`insert into drivers (org_id, full_name, status) values ($1, 'Ana Lopez', 'applicant') returning id`, [ORG])).id;
const consent = (org, subject) => sqlstate(
  `insert into sms_consents (org_id, driver_id, lead_id, phone, consent_text, consent_version, intent_statement, source, granted_ip)
   values ($1, $2, $3, $4, 'I agree…', 'apply-page-2026-11-20', 'Text me', 'lead_form', '203.0.113.9')`,
  [org, subject.driver ?? null, subject.lead ?? null, subject.phone ?? PHONE]);
ok("a consent on a lead alone is accepted", (await consent(ORG, { lead: LEAD })) === null);
ok("a consent on a driver alone is still accepted (every row before 0641)", (await consent(ORG, { driver: DRIVER, phone: "+17085550103" })) === null);
ok("a consent on both a lead and a driver is refused", (await consent(ORG, { lead: LEAD, driver: DRIVER })) === "23514");
ok("a consent on neither is refused", (await consent(ORG, {})) === "23514");
ok("a consent on another carrier's lead is refused (same-org key)", (await consent(ORG, { lead: OLEAD })) === "23503");
const C = (await one(`select id from sms_consents where lead_id = $1`, [LEAD])).id;
ok("a consent's lead cannot be changed (SC010)",
  (await sqlstate(`update sms_consents set lead_id = $2 where id = $1`, [C, await ingest(ORG, "form-2", "+17085550104")])) === "SC010");
ok("nor moved from its lead to a driver (SC010)",
  (await sqlstate(`update sms_consents set lead_id = null, driver_id = $2 where id = $1`, [C, DRIVER])) === "SC010");

const D = (await one(`select id from sms_consents where driver_id = $1`, [DRIVER])).id;
const DRIVER2 = (await one(`insert into drivers (org_id, full_name, status) values ($1, 'Second Driver', 'applicant') returning id`, [ORG])).id;
ok("a driver's consent cannot be moved to another driver (SC010): the driver half of the guard still holds",
  (await sqlstate(`update sms_consents set driver_id = $2 where id = $1`, [D, DRIVER2])) === "SC010");
ok("a driver's consent cannot be moved onto a lead (SC010)",
  (await sqlstate(`update sms_consents set driver_id = null, lead_id = $2 where id = $1`, [D, LEAD])) === "SC010");

// ── 3. a STOP by number reaches a lead's consent ─────────────────────────────────────────────────
const revoked = (await one(`select public.revoke_sms_consent($1, $2, 'inbound: STOP') as n`, [ORG, PHONE])).n;
ok("revoke_sms_consent by number revokes the lead's live consent", revoked === 1
  && (await one(`select revoked_at is not null as r from sms_consents where id = $1`, [C])).r === true);
ok("and the revocation is final (SC011)", (await sqlstate(`update sms_consents set revoked_at = null where id = $1`, [C])) === "SC011");

// ── 4. purging a lead takes its consents ─────────────────────────────────────────────────────────
const L3 = await ingest(ORG, "form-3", "+17085550105");
await consent(ORG, { lead: L3, phone: "+17085550105" });
await consent(ORG, { lead: L3, phone: "+17085550105" });
const OTHER_CONSENTS = (await one(`select count(*)::int as n from sms_consents where org_id = $1 and (lead_id is distinct from $2)`, [ORG, L3])).n;
const r = (await one(`select public.purge_lead($1, $2, $3) as r`, [ORG, L3, ADMIN])).r;
ok("the purge deletes the lead's two consents and says so", r.purged === true && r.sms_consents_deleted === 2, JSON.stringify(r));
ok("no other consent is touched",
  (await one(`select count(*)::int as n from sms_consents where org_id = $1`, [ORG])).n === OTHER_CONSENTS);
ok("the earlier answer's keys are all still there",
  ["lead_id", "purged", "already", "verdicts_deleted", "contacts_kept", "closure_notes_cleared"].every((k) => k in r), JSON.stringify(r));
await consent(ORG, { lead: L3, phone: "+17085550106" });
const again = (await one(`select public.purge_lead($1, $2, $3) as r`, [ORG, L3, ADMIN])).r;
ok("a consent that lands on a purged lead goes at the next purge", again.already === true && again.sms_consents_deleted === 1, JSON.stringify(again));

// ── 5. nothing is open to a client ───────────────────────────────────────────────────────────────
const rls = (await one(`select relrowsecurity as on from pg_class where oid = 'public.recruiting_careers_pages'::regclass`)).on;
const policies = (await one(`select count(*)::int as n from pg_policies where tablename = 'recruiting_careers_pages'`)).n;
ok("the careers page table has row security on and no client policy", rls === true && policies === 0);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
