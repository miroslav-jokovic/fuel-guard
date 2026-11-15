// Q-AM19, migration 0608: the documents-only link's own token and its own end on the invitation. The
// matrix holds the hash's shape, the pair rule (a token and its end together or not at all), one
// invitation per hash, and the rotation's guards: only this org's, never a revoked one, and — the
// point of the link having its own end — a lapsed or a submitted invitation is still given one.
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
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
  // As Supabase ships: a new function is callable by every client role unless the migration revokes it.
  // Without this line "no client role may" passes on a migration that revoked nothing.
  "alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const DRIVER = (await one(`insert into drivers (org_id, full_name) values ($1, 'Susan Godfrey') returning id`, [ORG])).id;
const invite = async (tok, extra = "") => (await one(
  `insert into application_invitations (org_id, driver_id, token_hash, expires_at ${extra ? ", " + extra.split("=")[0] : ""})
   values ($1, $2, md5($3), now() + interval '1 day' ${extra ? ", " + extra.split("=")[1] : ""}) returning id`, [ORG, DRIVER, tok])).id;
const INV = await invite("a");
const H1 = "a".repeat(64), H2 = "b".repeat(64);
const rotate = (org, inv, hash, ends = "now() + interval '14 days'") =>
  db.query(`select public.rotate_invitation_docs_token($1, $2, $3, ${ends}) as ok`, [org, inv, hash]).then((r) => r.rows[0].ok);
const rotateCode = async (...a) => { try { await rotate(...a); return null; } catch (e) { return e.code; } };
const row = (inv) => one(`select docs_token_hash h, docs_link_expires_at e from application_invitations where id = $1`, [inv]);

// ── 1. what the columns may hold ────────────────────────────────────────────────────────────
ok("an invitation never sent one holds neither", (await row(INV)).h === null && (await row(INV)).e === null);
ok("a token with no end is refused (23514)",
  (await sqlstate(`update application_invitations set docs_token_hash = $2 where id = $1`, [INV, H1])) === "23514");
ok("an end with no token is refused (23514)",
  (await sqlstate(`update application_invitations set docs_link_expires_at = now() + interval '1 day' where id = $1`, [INV])) === "23514");
ok("a hash that is not 64 hex characters is refused (23514)",
  (await sqlstate(`update application_invitations set docs_token_hash = 'nope', docs_link_expires_at = now() + interval '1 day' where id = $1`, [INV])) === "23514");

// ── 2. the rotation ─────────────────────────────────────────────────────────────────────────
ok("a send sets the token and its end together", (await rotate(ORG, INV, H1)) === true && (await row(INV)).h === H1 && (await row(INV)).e !== null);
ok("a second send replaces the first: only the last link works", (await rotate(ORG, INV, H2)) === true && (await row(INV)).h === H2);
ok("another org's invitation is not written, and says so", (await rotate(OTHER_ORG, INV, H1)) === false && (await row(INV)).h === H2);
ok("a malformed hash is refused (22023)", (await rotateCode(ORG, INV, "nope")) === "22023");
ok("an end in the past is refused (22023)", (await rotateCode(ORG, INV, H1, "now() - interval '1 minute'")) === "22023");

// ── 3. the invitations it must and must not reach ───────────────────────────────────────────
const REVOKED = await invite("r", "revoked_at=now()");
ok("a revoked invitation is never given a link", (await rotate(ORG, REVOKED, "c".repeat(64))) === false && (await row(REVOKED)).h === null);
const LAPSED = (await one(
  `insert into application_invitations (org_id, driver_id, token_hash, expires_at, created_at)
   values ($1, $2, md5('l'), now() - interval '1 day', now() - interval '20 days') returning id`, [ORG, DRIVER])).id;
ok("a LAPSED invitation is still given one — the link has its own end", (await rotate(ORG, LAPSED, "d".repeat(64))) === true);
ok("…and its own expires_at is not moved", (await one(`select expires_at < now() past from application_invitations where id = $1`, [LAPSED])).past === true);

// ── 4. one invitation per hash ──────────────────────────────────────────────────────────────
const SECOND = await invite("s");
ok("two invitations cannot hold the same documents token (23505)", (await rotateCode(ORG, SECOND, H2)) === "23505");

// ── 5. who may call it ──────────────────────────────────────────────────────────────────────
const may = async (role) => (await one(`select has_function_privilege($1, 'public.rotate_invitation_docs_token(uuid, uuid, text, timestamptz)', 'execute') p`, [role])).p;
ok("the service role may rotate", (await may("service_role")) === true);
ok("no client role may", (await may("anon")) === false && (await may("authenticated")) === false);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
