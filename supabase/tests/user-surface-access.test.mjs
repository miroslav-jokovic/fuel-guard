// Silvicom 360 — user_surface_access: the per-MEMBER SCREEN entitlements (0298).
//
// D-SURF6/D-SURF7, docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md step S4. The plan carries the
// argument; this matrix carries the part only the database can answer.
//
// The sibling of `org-surface-access.test.mjs`, and it is the DIFFERENCES between the two tables
// that this file exists to pin, because every one of them is a decision somebody could mistake for
// an oversight:
//
//  1. **There is no role CHECK here, and 0296 has one.** That asymmetry is deliberate and it is
//     asserted below rather than left as a hole: this table is keyed by `user_id`, and a row does
//     not know its member's role — that lives in `memberships` and can change after the row is
//     written. A CHECK cannot read another table and a trigger that did would enforce a rule that
//     goes stale on the next promotion. So D-PERM7/D-PERM8 live in the API's write path and in
//     `surfaceClaimFor`, which answers `{}` for a locked role before reading either table, and the
//     assertion here is that SQL does NOT stop it — so a reader who expects the CHECK finds the
//     reason instead of assuming one exists.
//  2. **BOTH booleans are real answers.** At the role layer a `true` is inert (the surface's own
//     gate is checked first, so an allow can never widen past the section — D-SURF2) and the API
//     deletes the row instead of storing it. Here `true` is how ONE technician keeps a screen the
//     org took from `technician`, which is the row 0296's boolean column was added for.
//  3. **The membership is a foreign key, not endpoint manners.** `memberships` carries
//     UNIQUE (org_id, user_id), so an override cannot name a non-member, deleting the org cascades
//     through the membership, and removing a member takes their overrides with them.
//  4. **No client may WRITE this table.** No write policy at all: changing what a PERSON may reach
//     is the most audit-worthy act in this programme, and only the API writes an audit row. A matrix
//     proving cross-ORG isolation alone would pass just as happily on a table an org admin could
//     edit through PostgREST, which is the hole this guards.
//
// ⚠ The JWT subject must exist in auth.users, for the reason saved-views.test.mjs records: a
// synthetic `sub` with no matching row fails writes on an FK, which looks exactly like an RLS
// refusal and lets a matrix "prove" a policy it never exercised. Here it is doubly true — the
// composite FK to `memberships` means an unmodelled member fails every insert.
//
// Run:  node supabase/tests/user-surface-access.test.mjs
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

// ── The cast: one org with three members, and an outsider in another org ────────
const SHOP_LEAD = "00000000-0000-4000-8000-000000000001"; // technician, the person the owner named
const OTHER_TECH = "00000000-0000-4000-8000-000000000002"; // technician, and must stay unaffected
const BOSS = "00000000-0000-4000-8000-000000000003"; // admin — the role SQL here cannot lock
const OUTSIDER = "00000000-0000-4000-8000-000000000004";
await db.query(
  `insert into auth.users (id, email) values
     ($1,'lead@example.com'), ($2,'tech@example.com'), ($3,'boss@example.com'), ($4,'outsider@example.com')`,
  [SHOP_LEAD, OTHER_TECH, BOSS, OUTSIDER],
);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'U') returning id`)).id;

const member = (org, user, role) =>
  db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,$3::user_role)`, [org, user, role]);
await member(ORG, SHOP_LEAD, "technician");
await member(ORG, OTHER_TECH, "technician");
await member(ORG, BOSS, "admin");
await member(OTHER_ORG, OUTSIDER, "technician");

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
// The owner's worked example, one layer down: the org has already taken Inspectors from every
// technician (0296's table), and now the shop lead alone keeps it while losing Repair spend.
const SET = `insert into user_surface_access (org_id, user_id, surface_key, allowed, updated_by)
             values ($1,$2,$3,$4,$5)`;
await db.query(SET, [ORG, SHOP_LEAD, "maintenance.inspectors", true, BOSS]);
await db.query(SET, [ORG, SHOP_LEAD, "maintenance.repair-spend", false, BOSS]);
await db.query(SET, [OTHER_ORG, OUTSIDER, "maintenance.inspections", false, null]);

const countAs = async (user, org, role) => {
  const res = await asUser(user, org, role, "select count(*)::int as n from user_surface_access");
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
ok("a member reads their own org's per-person overrides", (await countAs(SHOP_LEAD, ORG, "technician")) === 2);
ok(
  "…and so does a colleague the rows are not about",
  (await countAs(OTHER_TECH, ORG, "technician")) === 2,
);
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
const INSERT = `insert into user_surface_access (org_id, user_id, surface_key, allowed)
                values ($1,$2,'fuel.ifta',false)`;
ok(
  "an admin cannot INSERT a per-person override through PostgREST",
  await refusedAs(BOSS, ORG, "admin", INSERT, [ORG, OTHER_TECH]),
);
ok(
  "…nor can the member it is about write their own",
  await refusedAs(SHOP_LEAD, ORG, "technician", INSERT, [ORG, SHOP_LEAD]),
);
ok(
  "an admin cannot UPDATE one either",
  (await asUser(BOSS, ORG, "admin", `update user_surface_access set allowed = true`)).affectedRows === 0,
);
ok("…nor DELETE one", (await asUser(BOSS, ORG, "admin", `delete from user_surface_access`)).affectedRows === 0);

// ── The lock that is NOT here, asserted so the gap reads as a decision ──────────
// ⚠ 0296 refuses `admin` and `driver` in a CHECK constraint. This table cannot: a row does not know
// its member's role. The API refuses the write and `surfaceClaimFor` refuses to honour the row, and
// this assertion exists so that a reader who goes looking for the missing CHECK finds the reason
// beside the proof that it really is missing — rather than concluding the lock is enforced here and
// removing one of the two places it actually lives.
ok(
  "SQL does NOT stop a row for an admin — the D-PERM7 lock lives in the API and the resolver",
  await db
    .query(SET, [ORG, BOSS, "maintenance.inspectors", false, BOSS])
    .then(() => true)
    .catch(() => false),
);

// ── Membership is a foreign key, not endpoint manners ──────────────────────────
ok(
  "an override cannot name somebody who is not a member of that org",
  await refused(SET, [ORG, OUTSIDER, "maintenance.inspectors", false, BOSS]),
);
ok(
  "…nor a user who exists in no org at all",
  await refused(SET, [ORG, "00000000-0000-4000-8000-00000000dead", "maintenance.inspectors", false, BOSS]),
);
ok(
  "removing the member takes their overrides with them",
  await (async () => {
    const LEAVER = "00000000-0000-4000-8000-000000000009";
    await db.query(`insert into auth.users (id,email) values ($1,'leaver@example.com')`, [LEAVER]);
    await member(ORG, LEAVER, "dispatcher");
    await db.query(SET, [ORG, LEAVER, "fuel.ifta", false, BOSS]);
    await db.query(`delete from memberships where org_id = $1 and user_id = $2`, [ORG, LEAVER]);
    return (await one(`select count(*)::int as n from user_surface_access where user_id = $1`, [LEAVER])).n === 0;
  })(),
);
ok(
  "deleting the org takes its per-person overrides with it",
  await (async () => {
    const doomed = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'X') returning id`)).id;
    await member(doomed, OTHER_TECH, "technician");
    await db.query(SET, [doomed, OTHER_TECH, "fuel.ifta", false, BOSS]);
    await db.query(`delete from organizations where id = $1`, [doomed]);
    return (await one(`select count(*)::int as n from user_surface_access where org_id = $1`, [doomed])).n === 0;
  })(),
);

// ── The shape that makes "absence is not denial" possible ──────────────────────
ok(
  "one row per (org, user, surface) — a second is refused by the primary key",
  await refused(SET, [ORG, SHOP_LEAD, "maintenance.inspectors", false, BOSS]),
);
ok(
  "the same surface can be answered differently for a different member",
  await db
    .query(SET, [ORG, OTHER_TECH, "maintenance.inspectors", false, BOSS])
    .then(() => true)
    .catch(() => false),
);
ok(
  "BOTH answers are storable — `true` is how one member keeps a screen their role has lost",
  (await one(`select count(*)::int as n from user_surface_access where org_id = $1 and allowed`, [ORG])).n === 1,
);
ok(
  "an unknown surface_key is storable and inert — no vocabulary CHECK, by design",
  await db
    .query(SET, [ORG, OTHER_TECH, "not.a.real.surface", false, BOSS])
    .then(() => true)
    .catch(() => false),
);
ok("…but an empty one is not", await refused(SET, [ORG, OTHER_TECH, "   ", false, BOSS]));

// ── A row cannot be walked into another tenant ─────────────────────────────────
// ⚠ The subject of this assertion is a member of BOTH orgs, and that is not incidental. Written the
// obvious way — move the shop lead's row to the other org — it passed with the trigger DROPPED,
// because the composite membership FK refused the update instead: the shop lead is not a member
// there. That is the failure mode this programme keeps catching by mutation and only by mutation
// (an assertion passing for a reason other than the one it names), so the row is moved between two
// orgs the person actually belongs to, leaving the trigger as the only thing that can refuse, and
// the error code is checked rather than the mere fact of an error.
const DUAL = "00000000-0000-4000-8000-00000000d0a1";
await db.query(`insert into auth.users (id,email) values ($1,'dual@example.com')`, [DUAL]);
await member(ORG, DUAL, "dispatcher");
await member(OTHER_ORG, DUAL, "dispatcher");
await db.query(SET, [ORG, DUAL, "fuel.ifta", false, BOSS]);
ok(
  "the org_id of an existing row is immutable, refused by the trigger rather than by a foreign key",
  await (async () => {
    try {
      await db.query(`update user_surface_access set org_id = $1 where org_id = $2 and user_id = $3`, [
        OTHER_ORG,
        ORG,
        DUAL,
      ]);
      return false;
    } catch (e) {
      return /org_id is immutable/.test(e.message);
    }
  })(),
);

// ── Nothing in SQL consults this table ─────────────────────────────────────────
// The resolution happens in the API (D-SURF4: a surface answer never travels in the JWT, because
// nothing in RLS reads one — and putting it there would cost the hour of staleness `jwt_expiry`
// implies for nothing). If a policy ever grew a reference to this table, that decision would have
// been reversed by accident.
ok(
  "no policy anywhere reads this table — surfaces are resolved by the API, never by RLS",
  (
    await one(
      `select count(*)::int as n from pg_policies
        where schemaname = 'public'
          and (qual like '%user_surface_access%' or with_check like '%user_surface_access%')
          and tablename <> 'user_surface_access'`,
    )
  ).n === 0,
);

await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
