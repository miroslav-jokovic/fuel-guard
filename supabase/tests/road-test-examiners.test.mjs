// Silvicom 360 — road_test_examiners, who may sign a §391.31 road test (migration 0372,
// ROAD-TEST-PLAN.md RT0; the owner's ruling on Q-RT2).
//
// Three promises, each held by the DATABASE because the API writes with the service role:
//
//   · Append-only except retirement: a new title or signature is a new row; a retired row is frozen;
//     nothing is deleted (a filed road test must still resolve its examiner years later).
//   · A signature file can only come from the row's own org folder.
//   · Nobody reads it through the client: RLS on, no policy.
//
// Run:  node supabase/tests/road-test-examiners.test.mjs
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
    name text, owner uuid, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
// Supabase's default privileges, before the migrations, as rls.test.mjs installs them: RLS is the gate.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const org = async (name) => (await one(`insert into organizations (id, name) values (gen_random_uuid(), $1) returning id`, [name])).id;
const ORG = await org("Carrier");
const OTHER = await org("Someone else");
const OFFICE = (await one(`insert into auth.users (email) values ('office@carrier.test') returning id`)).id;
await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'admin')`, [ORG, OFFICE]);

const add = (o, path, name = "Arvidera Gakhal", title = "Maintenance manager") =>
  sqlstate(`insert into road_test_examiners (org_id, full_name, title, signature_path, created_by) values ($1,$2,$3,$4,$5)`,
    [o, name, title, path, OFFICE]);

// ── 1. What a row must carry ─────────────────────────────────────────────────────────────────────
ok("an examiner with a name, a title and a signature in the org's own folder is accepted",
  (await add(ORG, `${ORG}/examiners/sig-1.png`)) === null);
ok("a signature from ANOTHER org's folder is refused (23514)", (await add(ORG, `${OTHER}/examiners/x.png`)) === "23514");
ok("a signature outside the examiners folder is refused (23514)", (await add(ORG, `${ORG}/driver/x.png`)) === "23514");
ok("a blank name is refused (23514)", (await add(ORG, `${ORG}/examiners/s.png`, "  ")) === "23514");
ok("a blank title is refused (23514)", (await add(ORG, `${ORG}/examiners/s.png`, "Arvidera Gakhal", " ")) === "23514");
const ID = (await one(`select id from road_test_examiners where org_id = $1`, [ORG])).id;

// ── 2. Append-only, except retirement ────────────────────────────────────────────────────────────
for (const [col, val] of [["full_name", "'Someone Else'"], ["title", "'Driver trainer'"],
  ["signature_path", `'${ORG}/examiners/other.png'`], ["org_id", `'${OTHER}'`]]) {
  ok(`${col} is never edited (RT011)`,
    (await sqlstate(`update road_test_examiners set ${col} = ${val} where id = $1`, [ID])) === "RT011");
}
ok("a retirement names who retired it — one without the other is refused (23514)",
  (await sqlstate(`update road_test_examiners set retired_at = now() where id = $1`, [ID])) === "23514");
ok("retirement with its author is accepted",
  (await sqlstate(`update road_test_examiners set retired_at = now(), retired_by = $2 where id = $1`, [ID, OFFICE])) === null);
ok("a retired examiner is frozen, retirement included (RT011)",
  (await sqlstate(`update road_test_examiners set retired_at = null, retired_by = null where id = $1`, [ID])) === "RT011");
ok("an examiner is never deleted (RT010)",
  (await sqlstate(`delete from road_test_examiners where id = $1`, [ID])) === "RT010");

// ── 3. RLS: on, no client policy ─────────────────────────────────────────────────────────────────
ok("RLS is enabled", (await one(`select relrowsecurity r from pg_class where relname = 'road_test_examiners'`)).r === true);
ok("and no policy is declared — deny-all is the design",
  (await one(`select count(*)::int c from pg_policies where tablename = 'road_test_examiners'`)).c === 0);
await db.exec("begin");
await db.exec("set local role authenticated");
await db.query("select set_config('request.jwt.claims', $1, true)",
  [JSON.stringify({ sub: OFFICE, org_id: ORG, user_role: "admin" })]);
const seen = (await db.query(`select id from road_test_examiners`)).rows.length;
const wrote = await add(ORG, `${ORG}/examiners/sig-2.png`);
await db.exec("rollback");
ok("an office user of the same org reads nothing through the client — the API is the only door", seen === 0);
ok("…and cannot write one either (42501)", wrote === "42501");

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
