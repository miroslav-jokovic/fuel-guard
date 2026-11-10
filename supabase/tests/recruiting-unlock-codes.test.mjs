// F0b, migration 0585: a one-time code that opens a saved application when the date of birth on file will
// not. The matrix holds the CHECKs to the shared figures (two channels, five tries), the hash's shape, the
// time order, the cascade from the invitation, RLS, and the index the 90-day prune reads.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { UNLOCK_CODE_CHANNELS, UNLOCK_CODE_MAX_TRIES } from "../../packages/shared/dist/index.js";

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
const DRIVER = (await one(`insert into drivers (org_id, full_name) values ($1, 'Susan Godfrey') returning id`, [ORG])).id;
const INV = (await one(
  `insert into application_invitations (org_id, driver_id, token_hash, expires_at) values ($1, $2, md5('t'), now() + interval '1 day') returning id`,
  [ORG, DRIVER],
)).id;
const HASH = "a".repeat(64);
const insert = (cols = {}) => {
  const row = { org_id: ORG, invitation_id: INV, channel: "email", code_hash: HASH, expires_at: "now() + interval '10 minutes'", ...cols };
  const keys = Object.keys(row);
  const vals = keys.map((k) => (String(row[k]).startsWith("now()") ? row[k] : `'${row[k]}'`));
  return sqlstate(`insert into application_unlock_codes (${keys.join(", ")}) values (${vals.join(", ")})`);
};

// ── 1. what a code row may hold ─────────────────────────────────────────────────────────────
let channels = 0;
for (const channel of UNLOCK_CODE_CHANNELS) if ((await insert({ channel })) === null) channels += 1;
ok("every shared channel stored", channels === UNLOCK_CODE_CHANNELS.length, String(channels));
ok("a channel outside the two refused (23514)", (await insert({ channel: "fax" })) === "23514");
ok("a hash that is not 64 hex characters refused (23514)", (await insert({ code_hash: "042917" })) === "23514");
ok("a code that expires before it was made refused (23514)", (await insert({ expires_at: "now() - interval '1 minute'" })) === "23514");

// ── 2. the tries: the CHECK holds the shared figure ─────────────────────────────────────────
const id = (await one(`select id from application_unlock_codes where org_id = $1 order by created_at limit 1`, [ORG])).id;
ok("the fifth try is stored", (await sqlstate(`update application_unlock_codes set attempts = $2 where id = $1`, [id, UNLOCK_CODE_MAX_TRIES])) === null);
ok("a sixth is refused (23514)", (await sqlstate(`update application_unlock_codes set attempts = $2 where id = $1`, [id, UNLOCK_CODE_MAX_TRIES + 1])) === "23514");
ok("a spend before the code existed refused (23514)",
  (await sqlstate(`update application_unlock_codes set used_at = created_at - interval '1 second' where id = $1`, [id])) === "23514");

// ── 3. it goes with its invitation ──────────────────────────────────────────────────────────
await db.query(`delete from application_invitations where id = $1`, [INV]);
ok("deleting the invitation deletes its codes", (await one(`select count(*)::int n from application_unlock_codes where invitation_id = $1`, [INV])).n === 0);

// ── 4. RLS and the prune ────────────────────────────────────────────────────────────────────
ok("row level security on", (await one(`select relrowsecurity r from pg_class where oid = 'public.application_unlock_codes'::regclass`)).r === true);
ok("the age index exists for the 90-day prune",
  (await one(`select count(*)::int n from pg_indexes where tablename = 'application_unlock_codes' and indexname = 'ix_application_unlock_codes_age'`)).n === 1);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
