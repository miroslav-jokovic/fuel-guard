// Silvicom 360 — user_profiles + org_member_directory(): a person's name, and the one member read (0301).
//
// D-MEM1..D-MEM3, docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md step S9. The migration carries
// the argument; this matrix carries the part only the database can answer:
//
//  1. **Nobody but the service role can read or write a name.** RLS on, zero policies, and the
//     directory function is not executable by `authenticated` or `anon`. Asserted from pg_policies
//     and has_function_privilege, not by trying and hoping.
//  2. **The directory answers for ONE org and joins three sources in a fixed order.** A member with a
//     profile shows the profile's name; a driver member with no profile shows the roster's name; a
//     driver who has typed their own name shows theirs; a member with neither shows null, never the
//     email. Another org's members never appear, and a driver's roster row in another org never names
//     them here.
//  3. **The constraints hold.** A blank or over-long name is refused on both the profile and the
//     invitation, and deleting the auth user takes the profile with it.
//
// ⚠ The JWT subject must exist in auth.users, for the reason saved-views.test.mjs records.
//
// Run:  node supabase/tests/user-profiles.test.mjs
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

// Supabase-managed schemas, shimmed identically to rls.test.mjs.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
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
const BOSS = "00000000-0000-4000-8000-000000000001"; // admin, with a profile
const NAMELESS = "00000000-0000-4000-8000-000000000002"; // dispatcher, no profile — shows null
const HAULER = "00000000-0000-4000-8000-000000000003"; // driver, named by the roster
const SELF_NAMED = "00000000-0000-4000-8000-000000000004"; // driver who typed their own name
const OUTSIDER = "00000000-0000-4000-8000-000000000005"; // in another org, with a profile
await db.query(
  `insert into auth.users (id, email) values
     ($1,'boss@example.com'), ($2,'dispatch@example.com'), ($3,'hauler@example.com'),
     ($4,'named@example.com'), ($5,'outsider@example.com')`,
  [BOSS, NAMELESS, HAULER, SELF_NAMED, OUTSIDER],
);
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'U') returning id`)).id;
const member = (org, user, role, at) =>
  db.query(`insert into memberships (org_id, user_id, role, created_at) values ($1,$2,$3::user_role,$4)`, [org, user, role, at]);
await member(ORG, BOSS, "admin", "2026-01-01T00:00:00Z");
await member(ORG, NAMELESS, "dispatcher", "2026-01-02T00:00:00Z");
await member(ORG, HAULER, "driver", "2026-01-03T00:00:00Z");
await member(ORG, SELF_NAMED, "driver", "2026-01-04T00:00:00Z");
await member(OTHER_ORG, OUTSIDER, "admin", "2026-01-01T00:00:00Z");

// Roster rows: the two drivers, plus a roster row for the HAULER in the OTHER org, which must not
// name them here (the join is on org_id as well as user_id).
await db.query(`insert into drivers (org_id, user_id, full_name) values ($1,$2,'Roster Hauler')`, [ORG, HAULER]);
await db.query(`insert into drivers (org_id, user_id, full_name) values ($1,$2,'Roster Named')`, [ORG, SELF_NAMED]);
await db.query(`insert into drivers (org_id, full_name) values ($1,'Elsewhere Hauler')`, [OTHER_ORG]);

// Profiles, seeded the way the API seeds them.
await db.query(`insert into user_profiles (user_id, full_name, updated_by) values ($1,'Miki Boss',$1)`, [BOSS]);
await db.query(`insert into user_profiles (user_id, full_name, updated_by) values ($1,'Nadia Named',$1)`, [SELF_NAMED]);
await db.query(`insert into user_profiles (user_id, full_name) values ($1,'Out Sider')`, [OUTSIDER]);

/** Run one statement as `user` in `org`, holding `role`. */
async function asUser(user, org, role, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user, org_id: org, user_role: role, role: "authenticated" }),
    ]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return res;
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}
const refused = async (sql, params = []) => {
  try {
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  }
};

console.log("\n-- user_profiles + org_member_directory (0301) --");

// ── 1. Nobody but the service role ──────────────────────────────────────────────────────────────
ok(
  "user_profiles has row level security ON and zero policies — service role only (D-MEM2)",
  (await one(`select relrowsecurity as rls from pg_class where relname = 'user_profiles'`)).rls === true &&
    Number((await one(`select count(*)::int as n from pg_policies where tablename = 'user_profiles'`)).n) === 0,
);
ok(
  "an admin reading user_profiles through PostgREST sees nothing — not even their own row",
  Number((await asUser(BOSS, ORG, "admin", `select count(*)::int as n from user_profiles`)).rows?.[0]?.n) === 0,
);
ok(
  "an admin cannot rename anybody through PostgREST",
  /row-level security/i.test((await asUser(BOSS, ORG, "admin", `insert into user_profiles (user_id, full_name) values ($1,'Hacker')`, [NAMELESS])).error ?? ""),
);
const priv = await one(
  `select has_function_privilege('authenticated', 'org_member_directory(uuid)', 'execute') as auth_can,
          has_function_privilege('anon', 'org_member_directory(uuid)', 'execute') as anon_can,
          has_function_privilege('service_role', 'org_member_directory(uuid)', 'execute') as svc_can`,
);
ok(
  "org_member_directory() is executable by the service role and by nobody a browser can be",
  priv.svc_can === true && priv.auth_can === false && priv.anon_can === false,
  JSON.stringify(priv),
);

// ── 2. The directory ────────────────────────────────────────────────────────────────────────────
const dir = await rows(`select * from org_member_directory($1)`, [ORG]);
const by = Object.fromEntries(dir.map((r) => [r.user_id, r]));
ok("the directory lists every member of the org, and only them", dir.length === 4 && !by[OUTSIDER]);
ok(
  "…in the order they joined",
  dir.map((r) => r.user_id).join() === [BOSS, NAMELESS, HAULER, SELF_NAMED].join(),
);
ok(
  "a member with a profile shows the profile's name beside their email and role",
  by[BOSS]?.full_name === "Miki Boss" && by[BOSS]?.email === "boss@example.com" && by[BOSS]?.role === "admin",
  JSON.stringify(by[BOSS]),
);
ok(
  "a member with no profile and no roster row shows NULL — never the email standing in for a name",
  by[NAMELESS] && by[NAMELESS].full_name === null && by[NAMELESS].email === "dispatch@example.com",
);
ok(
  "a driver member with no profile is named by the roster (D-MEM3)",
  by[HAULER]?.full_name === "Roster Hauler",
);
ok(
  "a driver who has typed their own name is named by it, not by the roster",
  by[SELF_NAMED]?.full_name === "Nadia Named",
);
ok("joined_at is the membership's created_at", new Date(by[BOSS]?.joined_at).toISOString().startsWith("2026-01-01"));
const other = await rows(`select * from org_member_directory($1)`, [OTHER_ORG]);
ok(
  "the other org's directory is the outsider alone, with their profile",
  other.length === 1 && other[0].user_id === OUTSIDER && other[0].full_name === "Out Sider",
);
// ⚠ The first draft of this assertion gave the other org's roster row the hauler's user_id and
// checked the directory still said "Roster Hauler". It passed with the org clause DELETED from the
// join — because the update had been refused by 0098's unique index on drivers.user_id and the
// `.catch` swallowed it, so the cross-org row never existed. What the schema actually guarantees is
// stronger than the join clause: one person has at most ONE roster row anywhere, so a roster row in
// another org cannot name them by construction. That refusal is what is pinned; the org clause in
// the function stays as the belt under that brace.
ok(
  "one person has at most one roster row anywhere (0098), so another org's roster can never name them",
  await refused(`update drivers set user_id = $1 where org_id = $2 and full_name = 'Elsewhere Hauler'`, [HAULER, OTHER_ORG]),
);
ok(
  "an org nobody belongs to answers with an empty set, not an error",
  (await rows(`select * from org_member_directory(gen_random_uuid())`)).length === 0,
);

// ── 3. The constraints ──────────────────────────────────────────────────────────────────────────
ok(
  "a blank name is refused on the profile",
  await refused(`insert into user_profiles (user_id, full_name) values ($1,'   ')`, [NAMELESS]),
);
ok(
  "a name longer than a line is refused on the profile",
  await refused(`insert into user_profiles (user_id, full_name) values ($1, repeat('x', 121))`, [NAMELESS]),
);
ok(
  "a profile cannot exist for a user who does not",
  await refused(`insert into user_profiles (user_id, full_name) values (gen_random_uuid(),'Ghost')`),
);
ok(
  "an invitation may carry no name",
  !(await refused(`insert into invites (org_id, email, role, token) values ($1,'nobody@example.com','dispatcher','tok-null-name-0000')`, [ORG])),
);
ok(
  "an invitation's name obeys the same bounds",
  await refused(`insert into invites (org_id, email, role, token, full_name) values ($1,'blank@example.com','dispatcher','tok-blank-0000',' ')`, [ORG]) &&
    !(await refused(`insert into invites (org_id, email, role, token, full_name) values ($1,'named@example.com','dispatcher','tok-named-0000','Someone New')`, [ORG])),
);
await db.query(`delete from auth.users where id = $1`, [SELF_NAMED]);
ok(
  "deleting the auth user takes their profile with it (cascade)",
  Number((await one(`select count(*)::int as n from user_profiles where user_id = $1`, [SELF_NAMED])).n) === 0,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
