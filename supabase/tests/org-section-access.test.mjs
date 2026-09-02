// Silvicom 360 — org_section_access: the per-org permission overrides (0291).
//
// D-PERM1/4/7/8, docs/plans/permissions/EDITABLE-PERMISSIONS-PLAN.md step P1; owner rulings
// 2026-09-02. The plan carries the argument; this matrix carries the part only the database can
// answer.
//
// Three things are load-bearing here, and each one is a rule that would be cheap to lose:
//
//  1. **No client may WRITE this table.** There is no write policy at all, on purpose: changing what
//     a role may do must carry an audit row, and only the API writes one. A matrix that proved
//     cross-ORG isolation alone would pass just as happily on a table an org admin could edit
//     through PostgREST, which is precisely the hole this is guarding.
//  2. **The two locks are CHECK constraints, not endpoint manners.** D-PERM7 forbids granting the
//     `admin` section to anybody and D-PERM8 forbids editing the `driver` role. Stated in SQL, they
//     survive a second writer that has never read the plan — which is the whole reason they are here
//     rather than only in the route handler.
//  3. **Absence is not denial.** The table is a sparse delta (D-PERM4): a role x section with no row
//     is UNCHANGED, and its answer is the shipped default. Nothing in SQL can assert a meaning, so
//     what is asserted instead is the shape that makes the meaning possible — the primary key allows
//     exactly one row per (org, role, section), and rows for other orgs are invisible.
//
// ⚠ The JWT subject must exist in auth.users, for the reason saved-views.test.mjs records: a
// synthetic `sub` with no matching row fails writes on an FK, which looks exactly like an RLS
// refusal and lets a matrix "prove" a policy it never exercised.
//
// Run:  node supabase/tests/org-section-access.test.mjs
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
// Supabase's real default privileges, installed BEFORE the migrations run — full DML granted so that
// RLS is provably the only gate. Without this block a passing test proves nothing: the write would be
// refused by a missing GRANT rather than by the policy under test.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// The JWT subject must exist in auth.users. `drivers` and `vehicles` carry audit triggers whose
// audit_logs.actor_id is a real FK, so a synthetic `sub` with no matching row makes every write to
// those two tables fail on the FK — which looks exactly like an RLS refusal and would have let this
// matrix "prove" a revocation that had not happened. (`trailers` has no such trigger, which is how
// the discrepancy surfaced: it was the only table passing.) Modelling the user makes the policy the
// only thing under test, the same reason the default-privileges block above exists.
const ACTOR = "00000000-0000-4000-8000-000000000001";
await db.query(`insert into auth.users (id, email) values ($1, 'tester@example.com')`, [ACTOR]);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'U') returning id`)).id;

// A second person in the SAME org, and a person in another org entirely.
const COLLEAGUE = "00000000-0000-4000-8000-000000000002";
const OUTSIDER = "00000000-0000-4000-8000-000000000003";
await db.query(`insert into auth.users (id, email) values ($1,'colleague@example.com'), ($2,'outsider@example.com')`, [
  COLLEAGUE,
  OUTSIDER,
]);

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


// ── Seeded with the service role, standing in for the API's own writes ──────────
const SET = `insert into org_section_access (org_id, role, section, access, updated_by)
             values ($1,$2,$3,$4,$5)`;
await db.query(SET, [ORG, "dispatcher", "safety", "view", ACTOR]);
await db.query(SET, [OTHER_ORG, "dispatcher", "safety", "manage", ACTOR]);

const countAs = async (user, org, role) => {
  const res = await asUser(user, org, role, "select count(*)::int as n from org_section_access");
  return res.error ? `ERROR: ${res.error}` : Number(res.rows[0].n);
};
const affected = async (user, org, role, sql, params) => {
  const res = await asUser(user, org, role, sql, params);
  return res.error ? `ERROR: ${res.error}` : (res.affectedRows ?? 0);
};
/** Refused for a CLIENT: an insert with no INSERT policy RAISES rather than affecting zero rows,
 *  so asserting `affected === 0` would quietly pass on an error of any other kind too. */
const refusedAs = async (user, org, role, sql, params = []) => {
  const res = await asUser(user, org, role, sql, params);
  return typeof res.error === "string" && /row-level security/i.test(res.error);
};
const refused = async (sql, params = []) => {
  try {
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  }
};

// ── Reads are org-wide, and stop at the org boundary ────────────────────────────
// Org-wide on purpose: the shipped matrix is already compiled into the web bundle every member
// downloads, so the overrides are not a secret from them, and the permissions page shows a member
// what their own access is.
ok("an admin sees their own org's overrides", (await countAs(ACTOR, ORG, "admin")) === 1);
ok(
  "a non-admin member sees them too — a member may know their own access",
  (await countAs(COLLEAGUE, ORG, "dispatcher")) === 1,
);
ok(
  "another org's overrides are invisible, so one tenant cannot read another's policy",
  (await countAs(OUTSIDER, OTHER_ORG, "admin")) === 1,
);

// ── Nobody writes through PostgREST. Not even an admin. ─────────────────────────
// This is the assertion the file exists for. Read + no write policy = deny-all writes, which is the
// only arrangement under which every change to this table is guaranteed to carry its audit row.
ok(
  "an admin cannot INSERT an override directly — writes go through the API, which audits",
  await refusedAs(ACTOR, ORG, "admin", SET, [ORG, "recruiter", "fuel", "view", ACTOR]),
);
ok(
  "an admin cannot UPDATE an override directly",
  (await affected(ACTOR, ORG, "admin", `update org_section_access set access = 'manage'`)) === 0,
);
ok(
  "an admin cannot DELETE an override directly",
  (await affected(ACTOR, ORG, "admin", `delete from org_section_access`)) === 0,
);
ok(
  "a dispatcher cannot grant themselves anything",
  await refusedAs(COLLEAGUE, ORG, "dispatcher", SET, [ORG, "dispatcher", "fuel", "manage", COLLEAGUE]),
);

// ── D-PERM7: the `admin` SECTION is not grantable to anybody ────────────────────
// Granting the section that carries user management is a privilege-escalation path the product does
// not have today. An org that wants a second administrator promotes a member to the `admin` ROLE.
ok(
  "the admin section cannot be granted to any role",
  await refused(SET, [ORG, "fleet_manager", "admin", "manage", ACTOR]),
);
ok(
  "…not even as view",
  await refused(SET, [ORG, "auditor", "admin", "view", ACTOR]),
);

// ── D-PERM7/8: the `admin` and `driver` ROLES are not editable ──────────────────
ok(
  "the admin role cannot be edited, so an org always has a way back",
  await refused(SET, [ORG, "admin", "fuel", "none", ACTOR]),
);
ok(
  "the driver role cannot be edited — the web guard sends drivers to the app before any section check",
  await refused(SET, [ORG, "driver", "fuel", "view", ACTOR]),
);

// ── The vocabularies are closed ─────────────────────────────────────────────────
ok("an unknown role is refused", await refused(SET, [ORG, "wizard", "fuel", "view", ACTOR]));
ok("an unknown section is refused", await refused(SET, [ORG, "dispatcher", "unicorns", "view", ACTOR]));
ok("an unknown access level is refused", await refused(SET, [ORG, "dispatcher", "fuel", "sudo", ACTOR]));

// `none` is a real, storable value and not a synonym for "no row": narrowing a role below its
// shipped default is the common case, and absence already means "unchanged" (D-PERM4).
ok(
  "`none` is storable — narrowing below the default is a row, not a deletion",
  !(await refused(SET, [ORG, "auditor", "billing", "none", ACTOR])),
);

// ── One answer per (org, role, section) ─────────────────────────────────────────
ok(
  "a second override for the same role and section is refused by the primary key",
  await refused(SET, [ORG, "dispatcher", "safety", "manage", ACTOR]),
);

// ── Org immutability (0161's invariant) ─────────────────────────────────────────
ok(
  "an override cannot be walked into another organisation by an update",
  await refused(`update org_section_access set org_id = $1 where org_id = $2`, [OTHER_ORG, ORG]),
);

// ── Lifecycle ───────────────────────────────────────────────────────────────────
// Not evidence: an override is live configuration, not a §391.51 record, so it is deliberately NOT
// in RETENTION_FORBIDDEN and goes when its org does.
await db.query(`delete from organizations where id = $1`, [OTHER_ORG]);
ok(
  "deleting an org takes its overrides with it",
  (await one(`select count(*)::int as n from org_section_access where org_id = $1`, [OTHER_ORG])).n === 0,
);

// `updated_by` is nullable and set null on delete, so losing the actor's account cannot orphan or
// erase the override itself — the audit row beside it is the record of record.
await db.query(`delete from auth.users where id = $1`, [COLLEAGUE]);
ok(
  "an override survives the deletion of the account that last changed it",
  (await one(`select count(*)::int as n from org_section_access where org_id = $1`, [ORG])).n === 2,
);

// ══════════════════════════════════════════════════════════════════════════════
// The claim (0292, step P2) — where an override becomes authority.
// ══════════════════════════════════════════════════════════════════════════════
//
// `custom_access_token_hook` is the only thing that turns a row in this table into something a
// policy can act on, so its behaviour is what the rest of the program rests on. Four properties
// matter, and each would be silently wrong in a different way:
//
//  · the claim is SPARSE — an absent section means "unchanged", never "denied" (D-PERM4);
//  · an org that has overridden nothing mints EXACTLY the token it does today, so applying this
//    migration to a live project cannot change anyone's access;
//  · the locks hold here too, because this is the last place that can decline to honour a row that
//    should not exist, and the only one whose failure is an escalation rather than a bad row;
//  · `auth_section()` reads what the hook wrote, or NULL — the value P4's policies branch on.

const claimsFor = async (userId) =>
  (await one(`select public.custom_access_token_hook(jsonb_build_object('user_id', $1::text, 'claims', '{}'::jsonb)) as e`, [userId]))
    .e.claims;

// Two members of ORG: a dispatcher (who has one override, seeded above) and a fleet_manager (who
// has none). Both roles are editable, so any difference between them is the overrides and nothing
// else.
// ⚠ Fresh subjects, not COLLEAGUE: the lifecycle assertion above DELETES that account to prove an
// override outlives the person who set it, so reusing it here fails on the memberships FK — which
// reads exactly like a hook that returned nothing.
const DISPATCHER = "00000000-0000-4000-8000-000000000004";
const MANAGER = "00000000-0000-4000-8000-000000000005";
const BOSS = "00000000-0000-4000-8000-000000000006";
const HAULER = "00000000-0000-4000-8000-000000000007";
await db.query(
  `insert into auth.users (id, email)
   values ($1,'dispatcher@example.com'), ($2,'manager@example.com'), ($3,'boss@example.com'), ($4,'hauler@example.com')`,
  [DISPATCHER, MANAGER, BOSS, HAULER],
);
await db.query(
  `insert into memberships (org_id, user_id, role) values ($1,$2,'dispatcher'), ($1,$3,'fleet_manager'), ($1,$4,'admin'), ($1,$5,'driver')`,
  [ORG, DISPATCHER, MANAGER, BOSS, HAULER],
);

const dispatcherClaims = await claimsFor(DISPATCHER);
ok(
  "the hook still injects org_id and user_role, unchanged from 0006",
  dispatcherClaims.org_id === ORG && dispatcherClaims.user_role === "dispatcher",
);
ok(
  "an overridden role carries a SPARSE sections claim — only what the org changed",
  JSON.stringify(dispatcherClaims.sections) === JSON.stringify({ safety: "view" }),
);

const managerClaims = await claimsFor(MANAGER);
ok(
  "a role with no overrides carries no sections claim at all, so its token is byte-identical to today's",
  managerClaims.sections === undefined && managerClaims.user_role === "fleet_manager",
);

// ── The locks, applied where honouring a bad row would be an escalation ────────
// These rows cannot be inserted through the endpoint or past 0291's CHECK constraints, so they are
// forced in with the constraints disabled — the point is what the HOOK does if one ever exists.
await db.exec(`alter table org_section_access drop constraint org_section_access_role_check`);
await db.exec(`alter table org_section_access drop constraint org_section_access_section_check`);
await db.query(SET, [ORG, "admin", "fuel", "none", ACTOR]);
await db.query(SET, [ORG, "driver", "fuel", "manage", ACTOR]);
await db.query(SET, [ORG, "dispatcher", "admin", "manage", ACTOR]);

ok(
  "a smuggled override for the admin role is not honoured — an org always has a way back",
  (await claimsFor(BOSS)).sections === undefined,
);
ok(
  "a smuggled override for the driver role is not honoured",
  (await claimsFor(HAULER)).sections === undefined,
);
ok(
  "a smuggled grant of the admin SECTION is dropped from the claim, and the rest survives",
  JSON.stringify((await claimsFor(DISPATCHER)).sections) === JSON.stringify({ safety: "view" }),
);

// ── auth_section(): what a policy will actually branch on at P4 ────────────────
const asClaims = async (claims, sql) => {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const r = await db.query(sql);
    await db.exec("rollback");
    return r.rows[0];
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
};

const withSections = { sub: DISPATCHER, org_id: ORG, user_role: "dispatcher", sections: { safety: "view" } };
ok(
  "auth_section returns the override where there is one",
  (await asClaims(withSections, `select auth_section('safety') as v`)).v === "view",
);
ok(
  "auth_section returns NULL for a section the org has not touched — 'unchanged', not 'denied'",
  (await asClaims(withSections, `select auth_section('fuel') as v`)).v === null,
);
ok(
  "auth_section_view is true for an override of view",
  (await asClaims(withSections, `select auth_section_view('safety') as v`)).v === true,
);
ok(
  "auth_section_manage is FALSE for an override of view — view does not imply manage",
  (await asClaims(withSections, `select auth_section_manage('safety') as v`)).v === false,
);
ok(
  "auth_section_view is true for an override of manage — manage implies view",
  (await asClaims({ ...withSections, sections: { safety: "manage" } }, `select auth_section_view('safety') as v`)).v === true,
);

// The property the whole rollout rests on: a token minted before any of this existed carries no
// `sections` key, so every policy takes its default branch and no live session loses access.
ok(
  "a token with no sections claim answers NULL, so P4's policies fall through to their role list",
  (await asClaims({ sub: ACTOR, org_id: ORG, user_role: "dispatcher" }, `select auth_section('safety') as v`)).v === null,
);
// SQL is three-valued, and this is where that bites. `null in ('view','manage')` and
// `null = 'manage'` both evaluate to NULL, not false — and RLS reads a NULL predicate as a refusal.
// Without the `coalesce` in 0292, a bare `using (auth_section_view('fuel'))` would have denied every
// token minted before the migration, which is every token in existence on the day it applies.
const noClaim = await asClaims(
  { sub: ACTOR, org_id: ORG, user_role: "dispatcher" },
  `select auth_section_view('safety') as a, auth_section_manage('safety') as b`,
);
ok("…and the view wrapper answers false, not NULL, so a policy using it does not deny", noClaim.a === false);
ok("…and so does the manage wrapper", noClaim.b === false);

// An empty claims setting is what a rolled-back `set_local` leaves behind. `auth_role()` raised
// 22P02 on exactly this until 0213 added the nullif guard, and every policy in the product calls
// these functions — so the guard is copied, and pinned.
ok(
  "an EMPTY claims setting reads as 'no override' rather than raising 22P02 (0213's bug, not repeated)",
  (await asClaims("", `select auth_section('safety') as v`)).v === null,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
