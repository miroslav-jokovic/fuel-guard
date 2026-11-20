// Tenstreet TS1 (TENSTREET-INTAKE-PLAN; ADS-PLATFORM-V2-PLAN Q-APX29 (a)), migration 0640: a carrier's connection
// and the one-year log of its posts — what arrived and what we answered never change, a post is processed once,
// its body is only ever purged, a refused post carries no body, and neither table is open to a client.
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
const HASH = "a".repeat(64);
const SHA = "b".repeat(64);

// ── 1. the connection ────────────────────────────────────────────────────────────────────────────
ok("a connection cannot be on without a key", (await sqlstate(`insert into tenstreet_connections (org_id, company_id, enabled) values ($1, '14', true)`, [ORG])) === "23514");
ok("a key hash comes with its hint, and only then", (await sqlstate(`insert into tenstreet_connections (org_id, company_id, key_hash) values ($1, '14', $2)`, [ORG, HASH])) === "23514");
ok("a Company ID is its digits", (await sqlstate(`insert into tenstreet_connections (org_id, company_id) values ($1, '14a')`, [ORG])) === "23514");
const CONN = (await one(`insert into tenstreet_connections (org_id, company_id, mode, enabled, key_hash, key_hint) values ($1, '14', 'test', true, $2, 'Ab3_') returning id`, [ORG, HASH])).id;
ok("one connection per carrier", (await sqlstate(`insert into tenstreet_connections (org_id, company_id) values ($1, '15')`, [ORG])) === "23505");
ok("one carrier per Company ID", (await sqlstate(`insert into tenstreet_connections (org_id, company_id) values ($1, '14')`, [OTHER])) === "23505");
ok("one carrier per key", (await sqlstate(`insert into tenstreet_connections (org_id, company_id, key_hash, key_hint) values ($1, '15', $2, 'Zz9-')`, [OTHER, HASH])) === "23505");
const OCONN = (await one(`insert into tenstreet_connections (org_id, company_id) values ($1, '15') returning id`, [OTHER])).id;

// ── 2. the log ───────────────────────────────────────────────────────────────────────────────────
const post = async (org, conn, over = {}) => {
  const r = { reply_status: "ACCEPTED", reply_reason: "accepted", body_sealed: "v1.sealed", ...over };
  return db.query(`insert into tenstreet_posts (org_id, connection_id, driver_ref, mode, body_sha256, bytes, body_sealed, reply_status, reply_reason)
    values ($1, $2, '6346598', 'TEST', $3, 100, $4, $5, $6) returning id`, [org, conn, SHA, r.body_sealed, r.reply_status, r.reply_reason]);
};
const P = (await post(ORG, CONN)).rows[0].id;
ok("a post cannot name another carrier's connection", await sqlstate(`insert into tenstreet_posts (org_id, connection_id, body_sha256, bytes, body_sealed, reply_status, reply_reason) values ($1, $2, $3, 1, 'x', 'ACCEPTED', 'accepted')`, [ORG, OCONN, SHA]) === "23503");
ok("an accepted post must carry its body", (await sqlstate(`insert into tenstreet_posts (org_id, connection_id, body_sha256, bytes, reply_status, reply_reason) values ($1, $2, $3, 1, 'ACCEPTED', 'accepted')`, [ORG, CONN, SHA])) === "23514");
ok("a refused post carries no body", (await sqlstate(`insert into tenstreet_posts (org_id, connection_id, body_sha256, bytes, body_sealed, reply_status, reply_reason) values ($1, $2, $3, 1, 'x', 'REJECTED', 'mode')`, [ORG, CONN, SHA])) === "23514");
ok("a refused post is logged without one", (await sqlstate(`insert into tenstreet_posts (org_id, connection_id, body_sha256, bytes, reply_status, reply_reason) values ($1, $2, $3, 1, 'REJECTED', 'wrong_mode')`, [ORG, CONN, SHA])) === null);
ok("a reply reason is a word, never text from the post", (await sqlstate(`insert into tenstreet_posts (org_id, connection_id, body_sha256, bytes, reply_status, reply_reason) values ($1, $2, $3, 1, 'REJECTED', 'John Public')`, [ORG, CONN, SHA])) === "23514");

ok("what arrived never changes (TS001)", (await sqlstate(`update tenstreet_posts set driver_ref = 'other' where id = $1`, [P])) === "TS001");
ok("what we answered never changes (TS001)", (await sqlstate(`update tenstreet_posts set reply_status = 'REJECTED' where id = $1`, [P])) === "TS001");
ok("the body is not rewritten (TS003)", (await sqlstate(`update tenstreet_posts set body_sealed = 'v1.other' where id = $1`, [P])) === "TS003");
const LEAD = (await one(`select (public.ingest_lead($1, $2::jsonb)->>'lead_id')::uuid as id`, [ORG, JSON.stringify({ channel: "tenstreet", external_ref: "6346598", full_name: "John Public", phone_e164: "+19181231231", email_lower: null, source: null, campaign_ref: null, opening_id: null, platform_created_at: null, raw: {}, answers: {} })])).id;
ok("processing records the lead once", (await sqlstate(`update tenstreet_posts set processed_at = now(), lead_id = $2 where id = $1`, [P, LEAD])) === null);
ok("a processed post is final (TS002)", (await sqlstate(`update tenstreet_posts set process_error = 'again' where id = $1`, [P])) === "TS002");
ok("a post cannot name another carrier's lead", (await sqlstate(`insert into tenstreet_posts (org_id, connection_id, body_sha256, bytes, reply_status, reply_reason, lead_id) values ($1, $2, $3, 1, 'REJECTED', 'x', $4)`, [OTHER, OCONN, SHA, LEAD])) === "23503");
ok("the purge clears the body and stamps it", (await sqlstate(`update tenstreet_posts set body_sealed = null, purged_at = now() where id = $1`, [P])) === null);
ok("a purge is final (TS004)", (await sqlstate(`update tenstreet_posts set purged_at = null where id = $1`, [P])) === "TS004");
ok("the body cannot come back after a purge (TS003)", (await sqlstate(`update tenstreet_posts set body_sealed = 'v1.back' where id = $1`, [P])) === "TS003");
ok("the retention prune may delete a row", (await sqlstate(`delete from tenstreet_posts where id = $1`, [P])) === null);

// ── 3. no client reaches either table ────────────────────────────────────────────────────────────
for (const t of ["tenstreet_connections", "tenstreet_posts"]) {
  const r = await one(`select relrowsecurity as rls, (select count(*) from pg_policies where tablename = $1)::int as policies from pg_class where relname = $1`, [t]);
  ok(`${t} has row level security and no client policy`, r.rls === true && r.policies === 0);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
