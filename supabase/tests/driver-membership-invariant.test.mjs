// Silvicom 360 — a driver's membership is roster-owned (migration 0329, DC10).
//
// The defect this pins cost a driver eight days of lockout and was invisible from every screen:
// `custom_access_token_hook` mints `org_id` from `memberships` and nothing else, so for a driver
// that row is the CREDENTIAL, not a permission. The Users page listed it, offered Remove, and the
// delete succeeded — leaving a live auth user, a roster row still advertising app access, and an app
// stuck on "Account almost ready" with no way back through the UI.
//
// Two halves are proved here, and only a matrix can prove either:
//
//  1. **The backfill against the real broken shape.** Migrations up to 0328 apply, the wedge is then
//     built exactly as production held it (a `drivers` row with `user_id` set and NO membership),
//     and only THEN does 0329 apply. Asserting an INSERT…SELECT over an empty table would pass
//     without touching the case it exists for — the trap driver-identity-source.test.mjs records.
//  2. **The trigger against every path that reaches the table**, including the one no application
//     code goes through: `memberships.user_id` cascades from `auth.users`, so deleting the auth user
//     deletes the membership without any of our handlers running, and an invariant that only the
//     handlers respect is not an invariant.
//
// ⚠ What this file does NOT prove, said plainly because the first draft of it claimed otherwise:
// nothing here discriminates `security definer` from `security invoker`. A row trigger fired by a
// referential CASCADE runs as the owner of the referencing table, not as the role issuing the
// delete (measured 2026-09-08 — `current_user` came back `postgres`), so RLS on `drivers` is out of
// the picture on that path and both declarations pass every case below. The declaration is a
// deliberate choice about not depending on the caller's visibility, not something proved here.
//
// Run:  node supabase/tests/driver-membership-invariant.test.mjs
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
const CUTOVER = "0329_driver_membership_is_roster_owned.sql";
const before = MIGRATIONS.filter((f) => f < CUTOVER);
const after = MIGRATIONS.filter((f) => f >= CUTOVER);

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
/**
 * Execute a statement as a signed-in org ADMIN's browser JWT — `authenticated` + claims, the way
 * rls.test.mjs models PostgREST. This is not a flourish: `memberships_write` is FOR ALL to public
 * `using ((org_id = auth_org_id()) and (auth_role() = 'admin'))`, so an admin's own token can DELETE
 * a membership straight through PostgREST with no API handler in the path at all. Verified against
 * production 2026-09-08 (`pg_policies`), and it is the single clearest reason the refusal cannot
 * live only in `routes/members.ts`.
 */
async function asAdmin(sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "authenticated", sub: ADMIN_UID, org_id: ORG, user_role: "admin" }),
    ]);
    await db.query(sql, params);
    await db.exec("rollback");
    return null;
  } catch (e) {
    await db.exec("rollback");
    return e.message;
  }
}
const err = (p) => p.then(() => null, (e) => e.message);
/** The raised error itself, for the assertions that are about SQLSTATE rather than wording. */
const errOf = (p) => p.then(() => null, (e) => e);

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

// Supabase's real default privileges, installed BEFORE the migrations run — which is when the
// platform installs them, and why the order matters here exactly as it does in rls.test.mjs. Without
// them `authenticated` holds no DML at all and the PostgREST assertions below would pass for the
// wrong reason: "permission denied" reads like a refusal but proves nothing about the trigger.
await db.exec(
  "grant usage on schema public to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of before)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// ── The pre-0329 world, built as production actually held it on 2026-09-07 ────────────────────
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other Carrier') returning id`)).id;

const authUser = async (email) =>
  (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;

// The wedge: a driver whose login was issued (auth user + roster link) and whose membership was
// then removed from the Users page. This is aaron's exact shape.
const WEDGED = await authUser("aaron@drivers.fuelguard.app");
await db.query(`insert into drivers (org_id, full_name, app_username, user_id) values ($1,'AARON ROTHENBERG','aaron',$2)`, [ORG, WEDGED]);

// A driver whose login is intact — the backfill must leave them exactly as they are, not churn them.
const HEALTHY = await authUser("dana@drivers.fuelguard.app");
await db.query(`insert into drivers (org_id, full_name, app_username, user_id) values ($1,'DANA WEST','dana',$2)`, [ORG, HEALTHY]);
await db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,'driver')`, [ORG, HEALTHY]);

// An office member: everything the Users page is FOR must keep working untouched.
const OFFICE = await authUser("dispatch@silvicominc.com");
await db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,'dispatcher')`, [ORG, OFFICE]);

// The admin whose browser token `asAdmin` above speaks with.
const ADMIN_UID = await authUser("miki@silvicominc.com");
await db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,'admin')`, [ORG, ADMIN_UID]);

// A SECOND office member, existing only so the PostgREST control below deletes a row that is
// actually there. Reusing OFFICE would have made it delete nothing and pass vacuously — an
// assertion that cannot fail, which is the failure mode this repo has paid for before.
const OFFICE2 = await authUser("billing@silvicominc.com");
await db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,'accountant')`, [ORG, OFFICE2]);

// A driver on ANOTHER tenant's roster, holding an office membership HERE. The trigger's roster read
// is org-scoped, so this membership is not roster-owned in this org and must stay removable — an
// unscoped `exists (select 1 from drivers where user_id = …)` would freeze it and pass every other
// assertion in this file.
const CROSS = await authUser("contractor@silvicominc.com");
await db.query(`insert into drivers (org_id, full_name, user_id) values ($1,'CONTRACT DRIVER',$2)`, [OTHER_ORG, CROSS]);
await db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,'safety_manager')`, [ORG, CROSS]);

const memberships = async (user) =>
  (await db.query(`select role from memberships where org_id = $1 and user_id = $2`, [ORG, user])).rows;

ok("pre-0329: the wedged driver has a roster link and NO membership", (await memberships(WEDGED)).length === 0);

for (const f of after)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// ── 1. The backfill ───────────────────────────────────────────────────────────────────────────
ok(
  "backfill: the wedged driver gets the `driver` membership back — this is the row that mints org_id",
  (await memberships(WEDGED)).map((r) => r.role).join() === "driver",
);
ok("backfill: the healthy driver keeps exactly one membership, unchanged", (await memberships(HEALTHY)).map((r) => r.role).join() === "driver");
ok("backfill: the office member is untouched", (await memberships(OFFICE)).map((r) => r.role).join() === "dispatcher");
ok(
  "backfill: the other tenant's driver does not gain a membership in THIS org",
  (await db.query(`select 1 from memberships where org_id = $1 and user_id = $2`, [ORG, CROSS])).rows.length === 1 &&
    (await memberships(CROSS)).map((r) => r.role).join() === "safety_manager",
);
ok(
  "backfill: it is idempotent — running the same statement again inserts nothing",
  (
    await db.query(
      `insert into memberships (org_id, user_id, role)
       select d.org_id, d.user_id, 'driver'::user_role from drivers d where d.user_id is not null
       on conflict (org_id, user_id) do nothing`,
    )
  ).affectedRows === 0,
);

// ── 2. The trigger: the Users page's delete, which is what caused the incident ─────────────────
const delMembership = (user, org = ORG) =>
  err(db.query(`delete from memberships where org_id = $1 and user_id = $2`, [org, user]));

ok(
  "DELETE of a linked driver's membership is refused",
  /roster/i.test((await delMembership(WEDGED)) ?? ""),
  await delMembership(WEDGED),
);
ok("…and the row is still there afterwards", (await memberships(WEDGED)).length === 1);
// The wording above is the message an admin would eventually read; this is what a caller can BRANCH
// on. `forbid_org_change` (0161) set the precedent of a named SQLSTATE for a tenant-invariant
// refusal, and a refusal that is indistinguishable from a connection fault is one nothing can handle.
const tg002 = await errOf(db.query(`delete from memberships where org_id = $1 and user_id = $2`, [ORG, WEDGED]));
ok("the refusal carries SQLSTATE TG002, so a caller can tell it from a generic failure", tg002?.code === "TG002", JSON.stringify(tg002?.code));

// ── 3. The trigger: re-roling, which breaks the app just as completely ────────────────────────
ok(
  "UPDATE that re-roles a linked driver is refused — the app would show its 'wrong app' screen",
  /credential, not a permission/i.test(
    (await err(db.query(`update memberships set role = 'dispatcher' where org_id = $1 and user_id = $2`, [ORG, WEDGED]))) ?? "",
  ),
);
ok(
  "UPDATE that moves a linked driver's row to another user is refused",
  /cannot be moved/i.test(
    (await err(db.query(`update memberships set user_id = $3 where org_id = $1 and user_id = $2`, [ORG, WEDGED, OFFICE]))) ?? "",
  ),
);
ok(
  "a no-op UPDATE on a linked driver still passes — the guard is about CHANGE, not about writes",
  (await err(db.query(`update memberships set updated_at = now() where org_id = $1 and user_id = $2`, [ORG, WEDGED]))) === null,
);

// ── 4. The paths that must keep working ───────────────────────────────────────────────────────
ok("the office member can still be removed — the Users page is unbroken", (await delMembership(OFFICE)) === null);
ok(
  "the other tenant's driver can still be removed HERE — the roster read is org-scoped",
  (await delMembership(CROSS)) === null,
);

// ── 4b. The path the API cannot guard at all: an admin's own JWT through PostgREST ────────────
ok(
  "an org admin's browser token cannot delete a driver's membership either — the guard is in the DB",
  /roster/i.test((await asAdmin(`delete from memberships where org_id = $1 and user_id = $2`, [ORG, WEDGED])) ?? ""),
);
// ⚠ Deliberately inside one transaction: `asAdmin` rolls back, so the row must still be there for
// the count to mean anything. The check is that the DELETE reported a row, not that it vanished.
ok(
  "…while the same token can still remove an office member, which is what that policy is for",
  (await asAdmin(
    `do $$ declare n int; begin delete from memberships where org_id = '${ORG}' and user_id = '${OFFICE2}'; get diagnostics n = row_count; if n <> 1 then raise exception 'deleted % rows, expected 1', n; end if; end $$`,
  )) === null,
);

// revokeDriverLogin's order: unlink the roster row FIRST, then drop the membership. This is the ONE
// legitimate way to end a driver's app access, and it has always been written this way.
await db.query(`update drivers set user_id = null where org_id = $1 and user_id = $2`, [ORG, HEALTHY]);
ok("revokeDriverLogin's order works: unlink the roster row, then the membership deletes cleanly", (await delMembership(HEALTHY)) === null);

// createDriverLogin's order: membership inserted BEFORE `drivers.user_id` is written, and its
// rollback deletes the auth user while the roster row is still unlinked.
const FRESH = await authUser("new@drivers.fuelguard.app");
const FRESH_DRIVER = (await one(`insert into drivers (org_id, full_name, app_username) values ($1,'NEW HIRE','new') returning id`, [ORG])).id;
ok(
  "createDriverLogin's order works: the membership inserts before the roster link exists",
  (await err(db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,'driver')`, [ORG, FRESH]))) === null,
);
ok(
  "…and its rollback can still delete that membership, because nothing links it yet",
  (await delMembership(FRESH)) === null,
);
await db.query(`insert into memberships (org_id, user_id, role) values ($1,$2,'driver')`, [ORG, FRESH]);
await db.query(`update drivers set user_id = $2 where id = $1`, [FRESH_DRIVER, FRESH]);

// ── 5. The path no application code goes through — why the function is SECURITY DEFINER ───────
// `memberships.user_id` references auth.users ON DELETE CASCADE. Deleting the auth user deletes the
// membership with none of our handlers running, so the invariant has to hold here too.
ok(
  "deleting the auth user is refused while the roster link stands — the cascade is covered",
  /roster/i.test((await err(db.query(`delete from auth.users where id = $1`, [FRESH]))) ?? ""),
);
ok("…and both the membership and the login survive that attempt", (await memberships(FRESH)).length === 1);

// …and when the delete is issued by the role that actually issues it in production. GoTrue deletes a
// user as `supabase_auth_admin`, so the cascade is exercised from a role that holds no privileges on
// `memberships` at all and cannot see `drivers` through RLS. The refusal has to survive that, and it
// does — because the cascade's row trigger runs as the referencing table's owner rather than as the
// caller (measured; see the header). Asserted from the role rather than assumed from the mechanism.
await db.exec(`
  grant usage on schema auth to supabase_auth_admin;
  grant select, delete on auth.users to supabase_auth_admin;
`);
const asAuthAdmin = await err(
  db.exec(`set role supabase_auth_admin; delete from auth.users where id = '${FRESH}'; reset role;`),
);
await db.exec(`reset role`);
ok("…and refused when supabase_auth_admin is the one deleting the login", /roster/i.test(asAuthAdmin ?? ""), asAuthAdmin);
ok("…leaving the login intact after that attempt as well", (await memberships(FRESH)).length === 1);

await db.query(`update drivers set user_id = null where id = $1`, [FRESH_DRIVER]);
ok(
  "…while the same delete succeeds once the roster has let go, taking the membership with it",
  (await err(db.query(`delete from auth.users where id = $1`, [FRESH]))) === null && (await memberships(FRESH)).length === 0,
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
