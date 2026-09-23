// Silvicom 360 — password_resets + password_reset_candidates() + revoke_user_sessions() (0363).
//
// docs/plans/permissions/PASSWORD-RESET-PLAN.md, D-PWR1..D-PWR6. The API tests prove what the code
// asks for; this matrix proves what only the database can answer:
//
//  1. **Nobody but the service role.** RLS on with zero policies; both functions refuse `anon` and
//     `authenticated`. Asserted from the catalogue, not by trying and hoping.
//  2. **One live link per person, whatever the API does** (D-PWR2): a second live row is refused by
//     the partial unique index; a revoked or consumed one frees the slot.
//  3. **The claim is one conditional UPDATE** (D-PWR3): the statement the API runs claims a live row
//     once and a second time touches nothing; a revoked or expired row cannot be claimed at all.
//  4. **Candidates are a measurement** (D-PWR5): every membership the address holds, case-insensitive,
//     oldest first, drivers INCLUDED — the verdict is TypeScript's.
//  5. **A reset ends every session** (D-PWR6): the person's sessions go and their refresh tokens with
//     them; nobody else's are touched.
//  6. **Only a hash fits**, and deleting the auth user takes the rows with it.
//
// ⚠ The auth.sessions / auth.refresh_tokens shims exist only in THIS matrix — every other one shims
// auth.users alone, which is why 0363's revoke function is plpgsql (not checked at CREATE time).
//
// Run:  node supabase/tests/password-resets.test.mjs
//
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
const rows = async (q, p = []) => (await db.query(q, p)).rows;
const refused = async (sql, params = []) => {
  try {
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  }
};

// Supabase-managed schemas, shimmed identically to rls.test.mjs — plus the two GoTrue tables
// revoke_user_sessions touches, shaped as production has them (measured 2026-09-23:
// refresh_tokens.session_id cascades from sessions, and refresh_tokens.user_id is varchar there).
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null);
  create table auth.refresh_tokens (
    id bigserial primary key, user_id varchar, revoked boolean default false,
    session_id uuid references auth.sessions(id) on delete cascade
  );
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key,
    name text,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner uuid,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text)
  returns text[]
  language sql
  immutable
  as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (
    version text primary key,
    name text,
    statements text[]
  );
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
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// ── The cast ────────────────────────────────────────────────────────────────────────────────────
const OFFICE = "00000000-0000-4000-8000-000000000001"; // admin here, dispatcher in a second org
const DRIVER = "00000000-0000-4000-8000-000000000002";
const BYSTANDER = "00000000-0000-4000-8000-000000000003";
await db.query(
  `insert into auth.users (id, email) values ($1,'Pavlin@Silvicominc.com'), ($2,'hauler@drivers.fuelguard.app'), ($3,'other@example.com')`,
  [OFFICE, DRIVER, BYSTANDER],
);
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const SECOND = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'U') returning id`)).id;
const member = (org, user, role, at) =>
  db.query(`insert into memberships (org_id, user_id, role, created_at) values ($1,$2,$3::user_role,$4)`, [org, user, role, at]);
// Inserted newest-first on purpose, so "oldest first" is the function's ordering and not insertion's.
await member(SECOND, OFFICE, "dispatcher", "2026-02-01T00:00:00Z");
await member(ORG, OFFICE, "admin", "2026-01-01T00:00:00Z");
await member(ORG, DRIVER, "driver", "2026-01-02T00:00:00Z");
await member(ORG, BYSTANDER, "dispatcher", "2026-01-03T00:00:00Z");

const hash = (c) => c.repeat(64);
const insertLive = async (user, h) =>
  (
    await one(
      `insert into password_resets (org_id, user_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '1 hour') returning id`,
      [ORG, user, h],
    )
  ).id;

console.log("\n-- password_resets (0363) --");

// ── 1. Service role only ────────────────────────────────────────────────────────────────────────
ok(
  "password_resets has row level security ON and zero policies",
  (await one(`select relrowsecurity as rls from pg_class where relname = 'password_resets'`)).rls === true &&
    Number((await one(`select count(*)::int as n from pg_policies where tablename = 'password_resets'`)).n) === 0,
);
for (const fn of ["password_reset_candidates(text)", "revoke_user_sessions(uuid)"]) {
  const p = await one(
    `select has_function_privilege('authenticated', $1, 'execute') as auth_can,
            has_function_privilege('anon', $1, 'execute') as anon_can,
            has_function_privilege('service_role', $1, 'execute') as svc_can`,
    [fn],
  );
  ok(`${fn} is executable by the service role and by nobody a browser can be`, p.svc_can && !p.auth_can && !p.anon_can, JSON.stringify(p));
}

// ── 2. One live link per person ─────────────────────────────────────────────────────────────────
const first = await insertLive(OFFICE, hash("a"));
ok("a second LIVE link for the same person is refused by the index", await refused(
  `insert into password_resets (org_id, user_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '1 hour')`,
  [ORG, OFFICE, hash("b")],
));
ok("…but another person's live link is not", Boolean(await insertLive(BYSTANDER, hash("c"))));
await db.query(`update password_resets set revoked_at = now() where id = $1`, [first]);
const second = await insertLive(OFFICE, hash("d"));
ok("revoking the old link frees the slot for a new one", Boolean(second));

// ── 3. The claim ────────────────────────────────────────────────────────────────────────────────
// The exact WHERE clause `redeemReset` builds (passwordReset.ts), written out as SQL.
const CLAIM = `update password_resets set consumed_at = now()
                where id = $1 and consumed_at is null and revoked_at is null and expires_at > now() returning id`;
ok("the claim statement claims a live link once", (await rows(CLAIM, [second])).length === 1);
ok("…and the same statement a second time claims nothing", (await rows(CLAIM, [second])).length === 0);
ok("a revoked link cannot be claimed", (await rows(CLAIM, [first])).length === 0);
const expired = (
  await one(
    `insert into password_resets (org_id, user_id, token_hash, created_at, expires_at)
     values ($1,$2,$3, now() - interval '2 hours', now() - interval '1 hour') returning id`,
    [ORG, OFFICE, hash("e")],
  )
).id;
ok("an expired link cannot be claimed", (await rows(CLAIM, [expired])).length === 0);
ok("a row cannot be both consumed and revoked", await refused(`update password_resets set revoked_at = now() where id = $1`, [second]));

// ── 4. Candidates ───────────────────────────────────────────────────────────────────────────────
const cand = await rows(`select * from password_reset_candidates($1)`, ["  pavlin@SILVICOMINC.com "]);
ok(
  "candidates match the address case-insensitively, list every membership, oldest first",
  cand.length === 2 && cand[0].org_id === ORG && cand[0].role === "admin" && cand[1].org_id === SECOND,
  JSON.stringify(cand),
);
const driverCand = await rows(`select role from password_reset_candidates($1)`, ["hauler@drivers.fuelguard.app"]);
ok(
  "a driver's membership is RETURNED — refusing it is the API's verdict, not the function's",
  driverCand.length === 1 && driverCand[0].role === "driver",
);
ok("an unknown address returns nothing", (await rows(`select * from password_reset_candidates($1)`, ["nobody@example.com"])).length === 0);

// ── 5. Sign out everywhere ──────────────────────────────────────────────────────────────────────
const session = async (user) => {
  const id = (await one(`insert into auth.sessions (user_id) values ($1) returning id`, [user])).id;
  await db.query(`insert into auth.refresh_tokens (user_id, session_id) values ($1, $2)`, [user, id]);
  return id;
};
await session(OFFICE);
await session(OFFICE);
const theirs = await session(BYSTANDER);
const ended = (await one(`select revoke_user_sessions($1) as n`, [OFFICE])).n;
ok("revoke_user_sessions ends every session the person has and says how many", ended === 2, String(ended));
ok(
  "…their refresh tokens go with them, by cascade",
  Number((await one(`select count(*)::int as n from auth.refresh_tokens where user_id = $1`, [OFFICE])).n) === 0,
);
ok(
  "…and nobody else's session or refresh token is touched",
  Number((await one(`select count(*)::int as n from auth.sessions where id = $1`, [theirs])).n) === 1 &&
    Number((await one(`select count(*)::int as n from auth.refresh_tokens where session_id = $1`, [theirs])).n) === 1,
);

// ── 6. Shape ────────────────────────────────────────────────────────────────────────────────────
ok(
  "a token_hash that is not a SHA-256 hex digest is refused — the raw token cannot be stored by mistake",
  await refused(
    `insert into password_resets (org_id, user_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '1 hour')`,
    [ORG, DRIVER, "k".repeat(43)],
  ),
);
ok(
  "an expiry at or before creation is refused",
  await refused(
    `insert into password_resets (org_id, user_id, token_hash, created_at, expires_at) values ($1,$2,$3, now(), now())`,
    [ORG, DRIVER, hash("f")],
  ),
);
await db.query(`delete from memberships where user_id = $1`, [BYSTANDER]);
await db.query(`delete from auth.users where id = $1`, [BYSTANDER]);
ok(
  "deleting the auth user takes their reset rows with it (cascade)",
  Number((await one(`select count(*)::int as n from password_resets where user_id = $1`, [BYSTANDER])).n) === 0,
);

await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
