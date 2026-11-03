// 2026-11-03 lead-path audit M1, migration 0561: a lead is claimed for conversion before its applicant is
// created, so two requests at once (a double click) create one applicant; a claim lapses after two minutes,
// so a crash never leaves a lead stuck.
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
const ACTOR = (await one(`insert into auth.users (email) values ('dana@x.test') returning id`)).id;
const lead = async () => (await one(`select public.ingest_lead($1, $2::jsonb) as r`, [ORG, JSON.stringify({
  channel: "meta", external_ref: randomUUID(), full_name: "Ray Driver", phone_e164: "+17082365732" })])).r.lead_id;
const claim = async (org, id) => (await one(`select public.claim_lead_conversion($1, $2) as r`, [org, id])).r;

// ── 1. two requests at once: one claims, the other is told it is busy ────────────────────────────
const L1 = await lead();
ok("the first request claims the lead", (await claim(ORG, L1)) === "claimed");
ok("a second request while the first is live is answered busy", (await claim(ORG, L1)) === "busy");
ok("the claim is stamped on the lead",
  (await one(`select conversion_claimed_at is not null as c from recruiting_leads where id = $1`, [L1])).c === true);

// ── 2. a claim given back, and one that lapsed, can be claimed again ────────────────────────────
await db.query(`select public.release_lead_conversion($1, $2)`, [ORG, L1]);
ok("a released claim (the create failed) can be claimed again at once", (await claim(ORG, L1)) === "claimed");
await db.query(`update recruiting_leads set conversion_claimed_at = now() - interval '3 minutes' where id = $1`, [L1]);
ok("a claim older than two minutes (a request that crashed) has lapsed, so the lead is never stuck", (await claim(ORG, L1)) === "claimed");
await db.query(`update recruiting_leads set conversion_claimed_at = now() - interval '90 seconds' where id = $1`, [L1]);
ok("a claim under two minutes old still holds", (await claim(ORG, L1)) === "busy");

// ── 3. a converted lead, another carrier's lead ─────────────────────────────────────────────────
const L2 = await lead();
const DRIVER = (await one(`insert into drivers (org_id, full_name, status) values ($1, 'Ray Driver', 'applicant') returning id`, [ORG])).id;
await db.query(`select public.convert_lead($1, $2, $3, $4, 'Dana')`, [ORG, L2, DRIVER, ACTOR]);
ok("a converted lead is answered converted, not claimed", (await claim(ORG, L2)) === "converted");
ok("another carrier's lead reads as no lead (RL020)",
  (await sqlstate(`select public.claim_lead_conversion($1, $2)`, [OTHER, L1])) === "RL020");
ok("releasing another carrier's lead changes nothing", await (async () => {
  await db.query(`update recruiting_leads set conversion_claimed_at = now() where id = $1`, [L1]);
  await db.query(`select public.release_lead_conversion($1, $2)`, [OTHER, L1]);
  return (await one(`select conversion_claimed_at is not null as c from recruiting_leads where id = $1`, [L1])).c;
})());

// ── 4. the column is the recruiter's process state, not frozen attribution ──────────────────────
ok("claiming does not trip the attribution guard (RL013)", (await sqlstate(`select public.release_lead_conversion($1, $2)`, [ORG, L1])) === null);

// ── 5. grants ────────────────────────────────────────────────────────────────────────────────────
const callable = (await db.query(
  `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('claim_lead_conversion', 'release_lead_conversion')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`)).rows;
ok("neither function is executable by anon or authenticated", callable.length === 0, JSON.stringify(callable));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
