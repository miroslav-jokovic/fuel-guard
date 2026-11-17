// Silvicom 360 — toll statements kept as uploaded (migration 0627; TOLLS-PER-TRUCK-PLAN.md TL4a).
//
// 1. A statement keeps its provider, file, format, size and fingerprint; PrePass, an unknown format,
//    a malformed fingerprint and a name holding a slash are refused.
// 2. The same file counts once per org while kept; another org may keep the same bytes.
// 3. The file is never changed (TS002); the reader's columns may be filled; a period runs forwards.
// 4. A removal needs who and why, happens once (TS003), and frees the file to come back.
// 5. A statement is never deleted (TS001), except with its organisation.
// 6. RLS on with no client policy; the bucket is private.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
/** Run a statement and report the SQLSTATE it raised, or null when it succeeded. */
const refuses = async (q, p = []) => {
  try {
    await db.query(q, p);
    return null;
  } catch (e) {
    return e.code ?? "unknown";
  }
};

// Supabase-managed schemas, shimmed identically to unit-tags.test.mjs.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false, file_size_limit bigint,
    allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text)
  returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Fleet') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Rival') returning id`)).id;
const USER = "11111111-1111-4111-8111-111111111111";
const SHA = "a".repeat(64);
const keep = (org, over = {}) => {
  const r = { provider: "ezpass", file_name: "June 2026.pdf", format: "pdf", byte_size: 1000, sha256: SHA, ...over };
  return refuses(
    `insert into toll_statements (id, org_id, provider, file_name, format, byte_size, sha256, storage_path, uploaded_by)
     values (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6, $1::text || '/' || gen_random_uuid(), $7::uuid)`,
    [org, r.provider, r.file_name, r.format, r.byte_size, r.sha256, USER],
  );
};
const idOf = async (org, sha) => (await one(`select id from toll_statements where org_id = $1 and sha256 = $2 and removed_at is null`, [org, sha])).id;

// ── 1: what a statement holds ─────────────────────────────────────────────────────────────────
{ const r = await keep(ORG); ok("an E-ZPass PDF statement is kept", r === null, r); }
ok("a K-TAG spreadsheet is kept", (await keep(ORG, { provider: "ktag", format: "xlsx", sha256: "b".repeat(64) })) === null);
ok("PrePass is refused", (await keep(ORG, { provider: "prepass", sha256: "c".repeat(64) })) === "23514");
ok("a format no provider sends is refused", (await keep(ORG, { format: "jpeg", sha256: "c".repeat(64) })) === "23514");
ok("a malformed fingerprint is refused", (await keep(ORG, { sha256: "C".repeat(64) })) === "23514");
ok("a name holding a slash is refused", (await keep(ORG, { file_name: "../june.pdf", sha256: "c".repeat(64) })) === "23514");
ok("an empty file is refused", (await keep(ORG, { byte_size: 0, sha256: "c".repeat(64) })) === "23514");
ok("a file over 25 MB is refused", (await keep(ORG, { byte_size: 25 * 1024 * 1024 + 1, sha256: "c".repeat(64) })) === "23514");

// ── 2: one file counts once ───────────────────────────────────────────────────────────────────
ok("the same bytes cannot be kept twice in one org", (await keep(ORG, { file_name: "copy.pdf" })) === "23505");
ok("another org may keep the same bytes", (await keep(OTHER)) === null);

// ── 3: fixed once kept ────────────────────────────────────────────────────────────────────────
const JUNE = await idOf(ORG, SHA);
for (const [col, val] of [["provider", "'ktag'"], ["file_name", "'other.pdf'"], ["format", "'csv'"], ["byte_size", "2"], ["sha256", "repeat('d', 64)"], ["uploaded_by", "gen_random_uuid()"], ["storage_path", "'x/y'"]]) {
  const r = await refuses(`update toll_statements set ${col} = ${val} where id = $1`, [JUNE]);
  ok(`${col} is never changed`, r === "TS002", r);
}
ok(
  "the reader may fill the period, the printed total and when it read",
  (await refuses(`update toll_statements set period_start = '2026-06-01', period_end = '2026-06-07', printed_total = 1234.56, read_at = now() where id = $1`, [JUNE])) === null,
);
ok("a period cannot end before it starts", (await refuses(`update toll_statements set period_start = '2026-06-08' where id = $1`, [JUNE])) === "23514");

// ── 4: removal ────────────────────────────────────────────────────────────────────────────────
ok("a removal needs a reason", (await refuses(`update toll_statements set removed_at = now(), removed_by = $2 where id = $1`, [JUNE, USER])) === "23514");
ok("a removal needs who", (await refuses(`update toll_statements set removed_at = now(), remove_reason = 'wrong provider' where id = $1`, [JUNE])) === "23514");
ok(
  "a wrong file is removed with who and why",
  (await refuses(`update toll_statements set removed_at = now(), removed_by = $2, remove_reason = 'wrong provider' where id = $1`, [JUNE, USER])) === null,
);
ok("a removed statement is not removed again", (await refuses(`update toll_statements set remove_reason = 'again, louder' where id = $1`, [JUNE])) === "TS003");
ok("a removed file may be uploaded again", (await keep(ORG, { provider: "ktag" })) === null);

// ── 5: never deleted ──────────────────────────────────────────────────────────────────────────
ok("a statement is never deleted", (await refuses(`delete from toll_statements where id = $1`, [JUNE])) === "TS001");
ok("an organisation that goes takes its statements", (await refuses(`delete from organizations where id = $1`, [OTHER])) === null);
ok("…and none of them is left", Number((await one(`select count(*)::int as n from toll_statements where org_id = $1`, [OTHER])).n) === 0);

// ── 6: closed to clients ──────────────────────────────────────────────────────────────────────
const rls = await one(`select relrowsecurity as on, (select count(*)::int from pg_policies where tablename = 'toll_statements') as policies from pg_class where relname = 'toll_statements'`);
ok("RLS is on with no client policy", rls.on === true && rls.policies === 0);
const bucket = await one(`select public, file_size_limit from storage.buckets where id = 'toll-statements'`);
ok("the bucket is private and holds 25 MB a file", bucket.public === false && Number(bucket.file_size_limit) === 25 * 1024 * 1024);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
