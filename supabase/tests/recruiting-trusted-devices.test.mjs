// U2, migration 0604: a device an applicant asked to be remembered after a right date of birth or code.
// The matrix holds the CHECKs to the shared figures (the two ways one is earned), the hash's shape, the
// time order, one row per token per invitation, the cascade from the invitation, RLS, and the index the
// 90-day prune reads.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TRUSTED_DEVICE_EARNED_BY } from "../../packages/shared/dist/index.js";

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
const HASH = "b".repeat(64);
const insert = (cols = {}) => {
  const row = { org_id: ORG, invitation_id: INV, token_hash: HASH, earned_by: "date_of_birth", expires_at: "now() + interval '30 days'", ...cols };
  const keys = Object.keys(row);
  const vals = keys.map((k) => (String(row[k]).startsWith("now()") ? row[k] : `'${row[k]}'`));
  return sqlstate(`insert into application_trusted_devices (${keys.join(", ")}) values (${vals.join(", ")})`);
};

// ── 1. what a device row may hold ───────────────────────────────────────────────────────────
let earned = 0;
for (const [i, earned_by] of TRUSTED_DEVICE_EARNED_BY.entries()) {
  if ((await insert({ earned_by, token_hash: String(i).repeat(64) })) === null) earned += 1;
}
ok("every shared way of earning one is stored", earned === TRUSTED_DEVICE_EARNED_BY.length, String(earned));
ok("a way outside the two is refused (23514)", (await insert({ earned_by: "office", token_hash: "c".repeat(64) })) === "23514");
ok("a hash that is not 64 hex characters is refused (23514)", (await insert({ token_hash: "not-a-hash" })) === "23514");
ok("a device that expires before it was made is refused (23514)",
  (await insert({ token_hash: "d".repeat(64), expires_at: "now() - interval '1 minute'" })) === "23514");

// ── 2. one row per token per invitation ─────────────────────────────────────────────────────
ok("a token is stored once", (await insert()) === null);
ok("the same token on the same invitation is refused (23505)", (await insert()) === "23505");
const OTHER = (await one(
  `insert into application_invitations (org_id, driver_id, token_hash, expires_at) values ($1, $2, md5('u'), now() + interval '1 day') returning id`,
  [ORG, DRIVER],
)).id;
ok("the same hash on another invitation is its own row", (await insert({ invitation_id: OTHER })) === null);

// ── 3. the visit stamp ──────────────────────────────────────────────────────────────────────
const id = (await one(`select id from application_trusted_devices where invitation_id = $1 and token_hash = $2`, [INV, HASH])).id;
ok("a visit is stamped", (await sqlstate(`update application_trusted_devices set last_used_at = now() where id = $1`, [id])) === null);
ok("a visit before the device was remembered is refused (23514)",
  (await sqlstate(`update application_trusted_devices set last_used_at = created_at - interval '1 second' where id = $1`, [id])) === "23514");

// ── 4. it goes with its invitation ──────────────────────────────────────────────────────────
await db.query(`delete from application_invitations where id = $1`, [INV]);
ok("deleting the invitation deletes its devices", (await one(`select count(*)::int n from application_trusted_devices where invitation_id = $1`, [INV])).n === 0);
ok("another invitation's device is left", (await one(`select count(*)::int n from application_trusted_devices where invitation_id = $1`, [OTHER])).n === 1);

// ── 5. RLS and the prune ────────────────────────────────────────────────────────────────────
ok("row level security on", (await one(`select relrowsecurity r from pg_class where oid = 'public.application_trusted_devices'::regclass`)).r === true);
ok("no policy: deny-all to every client role",
  (await one(`select count(*)::int n from pg_policies where tablename = 'application_trusted_devices'`)).n === 0);
ok("the age index exists for the 90-day prune",
  (await one(`select count(*)::int n from pg_indexes where tablename = 'application_trusted_devices' and indexname = 'ix_application_trusted_devices_age'`)).n === 1);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
