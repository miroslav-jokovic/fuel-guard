// Silvicom 360 — who hears a platform alarm (migration 0427, platform_alert_recipients).
//
// The release train reads this table at 01:00 to decide who is texted when production breaks. A row a
// sender cannot use is a page that never arrives, and a duplicate is a page sent twice; both are
// refused here, in the database, not only by admin-api's normaliser. A removal is a stamp, so the
// same number can be added again after it was removed.
//
// Run: node supabase/tests/platform-alert-recipients.test.mjs
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
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ADMIN = (await one(`insert into platform_admins (email, role) values ('ops@example.com','platform_owner') returning id`)).id;
const add = (channel, address) =>
  sqlstate(`insert into platform_alert_recipients (channel, address, added_by) values ($1,$2,$3)`, [channel, address, ADMIN]);

ok("an E.164 phone is admitted", (await add("sms", "+18725550100")) === null);
ok("a lower-case email is admitted", (await add("email", "ops@example.com")) === null);
for (const [channel, bad, why] of [
  ["sms", "8725550100", "no country code — Telnyx refuses it"],
  ["sms", "+1 872 555 0100", "spaces"],
  ["sms", "+0872555010", "a country code cannot start with 0"],
  ["email", "Ops@Example.com", "not lower-cased, so the unique index could hold it twice"],
  ["email", "ops@example", "no domain"],
  ["fax", "+18725550100", "not a channel"],
]) ok(`refused: ${channel} '${bad}' (${why})`, (await add(channel, bad)) === "23514");

ok("the same live phone twice is refused", (await add("sms", "+18725550100")) === "23505");
ok("a phone number put on the email channel is refused",
  (await add("email", "+18725550100")) === "23514");

await db.query(`update platform_alert_recipients set removed_at = now(), removed_by = $1 where address = '+18725550100'`, [ADMIN]);
ok("after removal the number can be added again", (await add("sms", "+18725550100")) === null);
ok("the removed row is kept, not deleted",
  (await one(`select count(*)::int n from platform_alert_recipients where address = '+18725550100'`)).n === 2);
ok("a live row cannot name a remover",
  (await sqlstate(`update platform_alert_recipients set removed_by = $1 where address = 'ops@example.com'`, [ADMIN])) === "23514");
ok("row level security is on (no client policy reaches it)",
  (await one(`select relrowsecurity r from pg_class where relname = 'platform_alert_recipients'`)).r === true);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
