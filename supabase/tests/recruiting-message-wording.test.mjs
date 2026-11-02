// §12 MT1 (HIRING-WORKFLOW-AUDIT-2026-10-31 §8.2, §9.3), migration 0551: the carrier's own wording for
// the messages an applicant is sent — one row per save, newest wins, never edited, never deleted except
// with the organization; lengths and line breaks checked; and the outbox's `travel` reason for MT3.
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



const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const save = (org, key, parts = {}, at = null) => sqlstate(
  `insert into recruiting_message_wording (org_id, message_key, email_subject, email_heading, email_paragraph, text_lead, saved_by_name, saved_at)
   values ($1, $2, $3, $4, $5, $6, 'Dana', coalesce($7::timestamptz, now()))`,
  [org, key, parts.subject ?? null, parts.heading ?? null, parts.paragraph ?? null, parts.lead ?? null, at]);

// ── a save is a row ───────────────────────────────────────────────────────────────────────────
ok("a wording with all four parts saves",
  (await save(ORG, "invitation", { subject: "Your application", heading: "Hi {first_name}", paragraph: "Call Dana.\nAny time.", lead: "Hi {first_name}, here is your application." }, "2026-11-01T10:00:00Z")) === null);
ok("the standard wording (four nulls) saves", (await save(ORG, "invitation", {}, "2026-11-03T10:00:00Z")) === null);
ok("a key the catalogue may not have yet still saves (shape only, D-CE3)", (await save(ORG, "some_future_message")) === null);
ok("another carrier's wording saves beside it", (await save(OTHER, "invitation", { lead: "Other words" })) === null);

// ── newest wins, and the wording at an instant is the history's ───────────────────────────────
const at = async (org, key, instant) => one(
  `select email_subject s from recruiting_message_wording
    where org_id = $1 and message_key = $2 and saved_at <= $3 order by saved_at desc limit 1`, [org, key, instant]);
ok("the newest row is the current wording (reset to standard)", (await at(ORG, "invitation", "2026-12-01")).s === null);
ok("on 11/02 the carrier's subject was in force", (await at(ORG, "invitation", "2026-11-02")).s === "Your application");

// ── the shape refusals ────────────────────────────────────────────────────────────────────────
ok("a key with capitals or spaces is refused", (await save(ORG, "Invitation Email")) === "23514");
ok("an empty key is refused", (await save(ORG, "")) === "23514");
ok("a subject with a line break is refused (a header injection)", (await save(ORG, "invitation", { subject: "Hi\r\nBcc: x@y" })) === "23514");
ok("a heading with a line break is refused", (await save(ORG, "invitation", { heading: "Hi\nthere" })) === "23514");
ok("a text lead with a line break is refused", (await save(ORG, "invitation", { lead: "Hi\nthere" })) === "23514");
ok("a blank subject is refused (null is the standard, not spaces)", (await save(ORG, "invitation", { subject: "   " })) === "23514");
ok("a 121-character subject is refused", (await save(ORG, "invitation", { subject: "x".repeat(121) })) === "23514");
ok("a 120-character subject saves", (await save(ORG, "invitation", { subject: "x".repeat(120) })) === null);
ok("a 1,001-character paragraph is refused", (await save(ORG, "invitation", { paragraph: "x".repeat(1001) })) === "23514");
ok("a 121-character text lead is refused", (await save(ORG, "invitation", { lead: "x".repeat(121) })) === "23514");
ok("a save without a name is refused",
  (await sqlstate(`insert into recruiting_message_wording (org_id, message_key, saved_by_name) values ($1, 'reminder', ' ')`, [ORG])) === "23514");

// ── append-only ───────────────────────────────────────────────────────────────────────────────
ok("a wording is never edited (MW010)",
  (await sqlstate(`update recruiting_message_wording set email_subject = 'changed' where org_id = $1`, [ORG])) === "MW010");
ok("a wording is never deleted (MW011)",
  (await sqlstate(`delete from recruiting_message_wording where org_id = $1`, [ORG])) === "MW011");
ok("the organization's own delete takes its wording with it",
  (await sqlstate(`delete from organizations where id = $1`, [OTHER])) === null
  && Number((await one(`select count(*)::int n from recruiting_message_wording where org_id = $1`, [OTHER])).n) === 0);

// ── the outbox's trip reason (MT3) ────────────────────────────────────────────────────────────
const D = (await one(`insert into drivers (org_id, full_name) values ($1, 'Pat') returning id`, [ORG])).id;
const outbox = (reason, params = '{"mode":"bus"}') => sqlstate(
  `insert into sms_outbox (org_id, driver_id, phone, template, params, reason, not_before, expires_at)
   values ($1, $2, '+15555550100', 'travel', $3::jsonb, $4, now(), now() + interval '1 day')`, [ORG, D, params, reason]);
ok("a text filed under `travel` is accepted", (await outbox("travel")) === null);
ok("the older reasons are all still accepted",
  (await Promise.all(["nudge", "application_sent", "signing_link", "drug_test_site", "consent_confirm", "invite", "orientation_videos", "other"]
    .map((r) => outbox(r)))).every((s) => s === null));
ok("an unknown reason is still refused", (await outbox("trip")) === "23514");
ok("a trip text still may not carry a link in its params (0376)",
  (await outbox("travel", '{"note":"https://example.com"}')) === "23514");

// ── the API's only door ───────────────────────────────────────────────────────────────────────
const policies = Number((await one(`select count(*)::int n from pg_policies where tablename = 'recruiting_message_wording'`)).n);
const rls = (await one(`select relrowsecurity r from pg_class where relname = 'recruiting_message_wording'`)).r;
ok("RLS is on with no client policy — deny-all from a browser", policies === 0 && rls === true);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
