// Silvicom 360 — org_role_surface_access: the per-org, per-role SCREEN entitlements (0296).
//
// D-SURF1/2/6/9, docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md step S3 part 1. The plan
// carries the argument; this matrix carries the part only the database can answer.
//
// The sibling of `org-section-access.test.mjs`, and deliberately the same shape, because the two
// tables answer different questions with the same posture. That one governs which ROWS a role may
// touch; this one governs which SCREENS it may reach. Four things are load-bearing:
//
//  1. **No client may WRITE this table.** No write policy at all, on purpose: changing what a role
//     may reach must carry an audit row, and only the API writes one. A matrix proving cross-ORG
//     isolation alone would pass just as happily on a table an org admin could edit through
//     PostgREST, which is the hole this guards.
//  2. **The role lock is a CHECK constraint, not endpoint manners.** D-PERM7/D-PERM8 keep `admin`
//     and `driver` out of the table entirely — the admin so an org can always dig itself out of a
//     configuration it regrets, the driver because the router sends them to the app before any
//     surface check runs. Stated in SQL, both survive a second writer that has never read the plan.
//  3. **`surface_key` is deliberately NOT constrained to a vocabulary**, and that asymmetry with
//     0291 is the point: an unknown key grants nothing and denies nothing, because the resolver
//     looks it up in the catalogue and finds no screen. Pinning all 52 keys would mean a migration
//     per new page, paid for ever, to constrain a column whose wrong values are inert.
//  4. **Absence is not denial.** Sparse per D-SURF6: a role x surface with no row is UNCHANGED and
//     answers with the surface's own gate. SQL cannot assert a meaning, so what is asserted is the
//     shape that makes it possible — one row per (org, role, surface), other orgs invisible.
//
// ⚠ The JWT subject must exist in auth.users, for the reason saved-views.test.mjs records: a
// synthetic `sub` with no matching row fails writes on an FK, which looks exactly like an RLS
// refusal and lets a matrix "prove" a policy it never exercised.
//
// Run:  node supabase/tests/org-surface-access.test.mjs
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
// The owner's worked example: an org takes two of the three maintenance screens away from its
// technicians, and leaves Annual Inspections.
const SET = `insert into org_role_surface_access (org_id, role, surface_key, allowed, updated_by)
             values ($1,$2,$3,$4,$5)`;
await db.query(SET, [ORG, "technician", "maintenance.repair-spend", false, ACTOR]);
await db.query(SET, [ORG, "technician", "maintenance.inspectors", false, ACTOR]);
await db.query(SET, [OTHER_ORG, "technician", "maintenance.inspections", false, ACTOR]);

const countAs = async (user, org, role) => {
  const res = await asUser(user, org, role, "select count(*)::int as n from org_role_surface_access");
  return res.error ? `ERROR: ${res.error}` : Number(res.rows[0].n);
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
ok("a member reads their own org's screen overrides", (await countAs(ACTOR, ORG, "technician")) === 2);
ok("…and a colleague in a different role sees the same two", (await countAs(COLLEAGUE, ORG, "dispatcher")) === 2);
ok(
  "an outsider sees only their own org's row, never this org's",
  (await countAs(OUTSIDER, OTHER_ORG, "technician")) === 1,
);
ok(
  "…and a caller with no org claim at all sees nothing",
  (await countAs(OUTSIDER, "00000000-0000-4000-8000-0000000000ff", "technician")) === 0,
);

// ── No client writes this table, whatever role they hold ───────────────────────
// The most dangerous version of this bug is an ADMIN being able to write it directly: it would look
// like the feature working while bypassing the audit row that makes a permission change reviewable.
const INSERT = `insert into org_role_surface_access (org_id, role, surface_key, allowed)
                values ($1,'dispatcher','fuel.ifta',false)`;
ok("an admin cannot INSERT a screen override through PostgREST", await refusedAs(ACTOR, ORG, "admin", INSERT, [ORG]));
ok("…nor can a fleet manager", await refusedAs(ACTOR, ORG, "fleet_manager", INSERT, [ORG]));
ok(
  "an admin cannot UPDATE one either",
  (await asUser(ACTOR, ORG, "admin", `update org_role_surface_access set allowed = true`)).affectedRows === 0,
);
ok(
  "…nor DELETE one",
  (await asUser(ACTOR, ORG, "admin", `delete from org_role_surface_access`)).affectedRows === 0,
);

// ── The two locks, in SQL rather than in a route handler ───────────────────────
ok(
  "the ADMIN role cannot be given a screen override at all (D-PERM7)",
  await refused(SET, [ORG, "admin", "maintenance.inspectors", false, ACTOR]),
);
ok(
  "the DRIVER role cannot either (D-PERM8)",
  await refused(SET, [ORG, "driver", "fuel.log", false, ACTOR]),
);
ok(
  "…while the seven editable roles are all accepted",
  (
    await Promise.all(
      ["fleet_manager", "dispatcher", "safety_manager", "auditor", "recruiter", "accountant", "technician"].map(
        (r) => db.query(SET, [OTHER_ORG, r, "fuel.ifta", false, ACTOR]).then(() => true).catch(() => false),
      ),
    )
  ).every(Boolean),
);

// ── The shape that makes "absence is not denial" possible ──────────────────────
ok(
  "one row per (org, role, surface) — a second is refused by the primary key",
  await refused(SET, [ORG, "technician", "maintenance.inspectors", true, ACTOR]),
);
ok(
  "the same surface can be answered differently for a different role",
  await db
    .query(SET, [ORG, "dispatcher", "maintenance.inspectors", false, ACTOR])
    .then(() => true)
    .catch(() => false),
);
ok(
  "an unknown surface_key is storable and inert — no vocabulary CHECK, by design",
  await db
    .query(SET, [ORG, "auditor", "not.a.real.surface", false, ACTOR])
    .then(() => true)
    .catch(() => false),
);
ok("…but an empty one is not", await refused(SET, [ORG, "auditor", "   ", false, ACTOR]));

// ── A row cannot be walked into another tenant ─────────────────────────────────
ok(
  "the org_id of an existing row is immutable (0161's invariant)",
  await refused(`update org_role_surface_access set org_id = $1 where org_id = $2`, [OTHER_ORG, ORG]),
);
ok(
  "deleting the org takes its overrides with it",
  await (async () => {
    const doomed = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'X') returning id`)).id;
    await db.query(SET, [doomed, "technician", "fuel.ifta", false, ACTOR]);
    await db.query(`delete from organizations where id = $1`, [doomed]);
    return (await one(`select count(*)::int as n from org_role_surface_access where org_id = $1`, [doomed])).n === 0;
  })(),
);

// ── No reader ships with this migration (D-SURF9) ──────────────────────────────
// `/api/me` is fetched on every page load, so a reader deployed nine minutes before its table would
// break bootstrap for the whole org. The table stands alone until part 2, and this asserts the state
// that makes that safe: the rows exist and nothing in SQL consults them yet.
ok(
  "no policy anywhere reads this table — it is inert until the API is taught to (part 2)",
  (
    await one(
      `select count(*)::int as n from pg_policies
        where schemaname = 'public'
          and (qual like '%org_role_surface_access%' or with_check like '%org_role_surface_access%')
          and tablename <> 'org_role_surface_access'`,
    )
  ).n === 0,
);

await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
