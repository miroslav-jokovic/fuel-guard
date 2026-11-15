// F5, migration 0607: one question the office sends back to an applicant about one answer. The matrix
// holds the CHECKs to the shared figure (the question's length), the path's shape, the states a row may
// be in, one OPEN question per answer, the cascade from the invitation, and RLS.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ASK_AGAIN_QUESTION_MAX } from "../../packages/shared/dist/index.js";

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
const insert = (cols = {}) => {
  const row = { org_id: ORG, invitation_id: INV, path: '["experience"]', question: "How many years?", ...cols };
  const keys = Object.keys(row);
  return sqlstate(`insert into application_ask_agains (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
};

// ── 1. what a question row may hold ─────────────────────────────────────────────────────────
ok("a question is stored", (await insert()) === null);
ok("the longest question the contract allows is stored", (await insert({ path: '["a"]', question: "x".repeat(ASK_AGAIN_QUESTION_MAX) })) === null);
ok("one character more is refused (23514)", (await insert({ path: '["b"]', question: "x".repeat(ASK_AGAIN_QUESTION_MAX + 1) })) === "23514");
ok("a blank question is refused (23514)", (await insert({ path: '["c"]', question: "   " })) === "23514");
ok("a path that is not an array is refused (23514)", (await insert({ path: '"experience"' })) === "23514");
ok("an empty path is refused (23514)", (await insert({ path: "[]" })) === "23514");
ok("a path of four parts is refused (23514)", (await insert({ path: '["a","b","c","d"]' })) === "23514");
ok("a keyed row's answer is stored", (await insert({ path: '["employers","k1","ended_on"]' })) === null);

// ── 2. one OPEN question per answer ─────────────────────────────────────────────────────────
ok("a second open question about the same answer is refused (23505)", (await insert()) === "23505");
const id = (await one(`select id from application_ask_agains where invitation_id = $1 and path = '["experience"]'`, [INV])).id;
ok("answered, it is closed", (await sqlstate(`update application_ask_agains set answered_at = now() where id = $1`, [id])) === null);
ok("…and the same answer may be asked about again", (await insert()) === null);
const again = (await one(`select id from application_ask_agains where invitation_id = $1 and path = '["experience"]' and answered_at is null`, [INV])).id;
ok("taken back, it is closed too", (await sqlstate(`update application_ask_agains set withdrawn_at = now() where id = $1`, [again])) === null);
ok("…and may be asked a third time", (await insert()) === null);

// ── 3. the states a row may be in ───────────────────────────────────────────────────────────
ok("answered AND taken back is refused (23514)", (await sqlstate(`update application_ask_agains set withdrawn_at = now() where id = $1`, [id])) === "23514");
ok("answered before it was asked is refused (23514)",
  (await sqlstate(`update application_ask_agains set answered_at = asked_at - interval '1 second' where id = $1`, [id])) === "23514");

// ── 4. it goes with its invitation ──────────────────────────────────────────────────────────
await db.query(`delete from application_invitations where id = $1`, [INV]);
ok("deleting the invitation deletes its questions", (await one(`select count(*)::int n from application_ask_agains where invitation_id = $1`, [INV])).n === 0);

// ── 5. RLS ──────────────────────────────────────────────────────────────────────────────────
ok("row level security on", (await one(`select relrowsecurity r from pg_class where oid = 'public.application_ask_agains'::regclass`)).r === true);
ok("no policy: deny-all to every client role", (await one(`select count(*)::int n from pg_policies where tablename = 'application_ask_agains'`)).n === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
