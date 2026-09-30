// Silvicom 360 — 0396: the pre-0260 role-literal policies read their section (SETTINGS-PERMISSIONS-PLAN
// SP11, owner's ruling Q-SET11 (a), 2026-09-30).
//
// Two claims, and this matrix asserts both for every policy 0396 touched:
//
//  1. **Nothing moved for a token with no overrides.** Every role in the `user_role` enum — read from
//     the enum, not listed, so a role added later is covered — gets exactly the answer the literal
//     gave it. That is every token in existence until an admin edits the matrix.
//  2. **The org's answer now reaches the policy.** A role outside the list, granted the section, gets
//     in; a role inside it, revoked, is refused; `view` is not `manage`; and the admin's answer cannot
//     be narrowed (D-PERM7).
//
// ⚠ PRODUCTION-SHAPED ON PURPOSE. Production holds three policies no migration ever created —
// `duty_sessions_write`, `duty_segments_write`, `load_events_insert` — byte-for-byte duplicates of
// their migrated twins (re-read 2026-09-30; 0396's header). A permissive duplicate ORs with its wrapped
// twin, so if 0396 failed to drop one, the revoke cases here would still see the literal admit the
// caller. They are therefore re-created below exactly as production has them, BEFORE 0396 runs. A
// matrix built from the migrations alone would pass whether or not 0396 dropped anything.
//
// Two policies are pinned as NOT section reads. `hazmat_policies_admin_write` is admin only by
// Q-SET11, and an org grant must not move it. `reports_admin_read` became `reports_own_read` by
// Q-SET13 (c): its list equalled no section's set and nothing read the queue, so the role half went and
// only "a reporter reads their own" is left — no role and no grant reads anybody else's report.
//
// Run:  node supabase/tests/sp11-role-literal-policies.test.mjs
//
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();
const SP11 = "0396";

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

// Supabase-managed schemas, shimmed identically to org-section-access.test.mjs.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false, file_size_limit bigint,
    allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);
// Full DML granted before the migrations, so RLS is provably the only gate under test.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);

const DRIFT = `
  create policy duty_sessions_write on driver_duty_sessions for all
    using ((org_id = auth_org_id()) and (auth_role() = any (array['admin','fleet_manager','dispatcher'])))
    with check ((org_id = auth_org_id()) and (auth_role() = any (array['admin','fleet_manager','dispatcher'])));
  create policy duty_segments_write on duty_equipment_segments for all
    using ((org_id = auth_org_id()) and (auth_role() = any (array['admin','fleet_manager','dispatcher'])))
    with check ((org_id = auth_org_id()) and (auth_role() = any (array['admin','fleet_manager','dispatcher'])));
  create policy load_events_insert on load_events for insert
    with check ((org_id = auth_org_id()) and (auth_role() = any (array['admin','fleet_manager','dispatcher'])));
`;
let drifted = false;
for (const f of MIGRATIONS) {
  if (!drifted && f.slice(0, 4) >= SP11) {
    await db.exec(DRIFT);
    drifted = true;
  }
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}
ok(`the production drift was modelled before ${SP11} ran`, drifted);

// ── fixtures (as the superuser, which bypasses RLS) ─────────────────────────────────────────────
const USER = "00000000-0000-4000-8000-0000000000a1";
const REPORTER = "00000000-0000-4000-8000-0000000000a2";
await db.query(`insert into auth.users (id, email) values ($1,'u@example.com'), ($2,'r@example.com')`, [USER, REPORTER]);
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const DRIVER = (await one(`insert into drivers (org_id, full_name) values ($1,'Driver One') returning id`, [ORG])).id;
const VEHICLE = (await one(
  `insert into vehicles (org_id, unit_number, fuel_type, tank_capacity_gal) values ($1,'SP11','diesel',120) returning id`,
  [ORG],
)).id;
const SESSION = (await one(`insert into driver_duty_sessions (id, org_id, driver_id) values (gen_random_uuid(),$1,$2) returning id`, [ORG, DRIVER])).id;
const SEGMENT = (await one(
  `insert into duty_equipment_segments (id, org_id, session_id, vehicle_id) values (gen_random_uuid(),$1,$2,$3) returning id`,
  [ORG, SESSION, VEHICLE],
)).id;
const HOS = (await one(
  `insert into hos_duty_segments (org_id, samsara_driver_id, status, started_at) values ($1,'s-1','on_duty',now()) returning id`,
  [ORG],
)).id;
const LOAD = (await one(
  `insert into loads (org_id, ref, equipment, commodity) values ($1,'SP11-REF','Dry van','General freight') returning id`,
  [ORG],
)).id;
await db.query(`insert into load_external_payloads (load_id, org_id, provider) values ($1,$2,'mcleod')`, [LOAD, ORG]);
const THREAD = (await one(`insert into message_threads (org_id) values ($1) returning id`, [ORG])).id;
const MESSAGE = (await one(`insert into messages (id, org_id, thread_id, body) values (gen_random_uuid(),$1,$2,'hi') returning id`, [ORG, THREAD])).id;
await db.query(`insert into message_reports (org_id, message_id, reported_by, reason) values ($1,$2,$3,'spam')`, [ORG, MESSAGE, REPORTER]);
await db.query(`insert into org_modules (org_id, module_key, enabled) values ($1,'hazmatguard',true)`, [ORG]);
await db.query(`insert into hazmat_policies (org_id, policy) values ($1,'{}'::jsonb)`, [ORG]);

const ROLES = (await db.query(`select unnest(enum_range(null::user_role))::text as r`)).rows.map((x) => x.r);
ok("the user_role enum is read, not listed (9 roles or more)", ROLES.length >= 9, JSON.stringify(ROLES));

/** Run one statement as a caller in ORG holding `role`, optionally with a `sections` claim. */
async function as(role, sections, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    const claims = { sub: USER, org_id: ORG, user_role: role, role: "authenticated" };
    if (sections) claims.sections = sections;
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const res = await db.query(sql, params);
    return res;
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec("rollback");
  }
}
const wrote = async (role, sections, sql, params) => {
  const res = await as(role, sections, sql, params);
  return !res.error && (res.affectedRows ?? 0) > 0;
};
const seen = async (role, sections, sql, params) => {
  const res = await as(role, sections, sql, params);
  return res.error ? -1 : (res.rows?.length ?? 0);
};

/**
 * One policy, both claims. `act(role, sections)` answers true when the caller got through; `list` is
 * the literal the policy carried; `grant`/`revoke` are one role outside and one inside it.
 */
async function pin(name, act, { list, section, level, grant, revoke }) {
  for (const r of ROLES) {
    const expected = list.includes(r);
    ok(`${name}: ${r} with no override is ${expected ? "admitted" : "refused"}, as before`, (await act(r, null)) === expected);
  }
  ok(`${name}: ${grant} granted ${section}: ${level} is admitted`, await act(grant, { [section]: level }));
  ok(`${name}: ${revoke} with ${section}: none is refused`, !(await act(revoke, { [section]: "none" })));
  if (level === "manage")
    ok(`${name}: ${revoke} narrowed to ${section}: view is refused — view is not manage`, !(await act(revoke, { [section]: "view" })));
  ok(`${name}: the admin cannot be narrowed out (D-PERM7)`, await act("admin", { [section]: "none" }));
}

// ── driver_duty_sessions · dispatch manage ──────────────────────────────────────────────────────
await pin(
  "duty_sessions_manager_write",
  (r, s) => wrote(r, s, `update driver_duty_sessions set device_id = 'sp11' where id = $1`, [SESSION]),
  { list: ["admin", "fleet_manager", "dispatcher"], section: "dispatch", level: "manage", grant: "safety_manager", revoke: "dispatcher" },
);
// ── duty_equipment_segments · dispatch manage ───────────────────────────────────────────────────
await pin(
  "duty_segments_manager_write",
  (r, s) => wrote(r, s, `update duty_equipment_segments set note = 'sp11' where id = $1`, [SEGMENT]),
  { list: ["admin", "fleet_manager", "dispatcher"], section: "dispatch", level: "manage", grant: "technician", revoke: "fleet_manager" },
);
// ── hos_duty_segments · settings manage ─────────────────────────────────────────────────────────
await pin(
  "hos_duty_segments_write",
  (r, s) => wrote(r, s, `update hos_duty_segments set status = status where id = $1`, [HOS]),
  { list: ["admin", "fleet_manager"], section: "settings", level: "manage", grant: "dispatcher", revoke: "fleet_manager" },
);
// ── load_events · dispatch manage (0293's policy, now the only door) ────────────────────────────
await pin(
  "load_events (manager insert, drift twin dropped)",
  (r, s) => wrote(r, s, `insert into load_events (org_id, load_id, kind) values ($1,$2,'created')`, [ORG, LOAD]),
  { list: ["admin", "fleet_manager", "dispatcher"], section: "dispatch", level: "manage", grant: "recruiter", revoke: "dispatcher" },
);
// ── load_external_payloads · dispatch view ──────────────────────────────────────────────────────
await pin(
  "load_external_payloads_select",
  async (r, s) => (await seen(r, s, `select load_id from load_external_payloads where load_id = $1`, [LOAD])) === 1,
  { list: ["admin", "fleet_manager", "dispatcher", "auditor"], section: "dispatch", level: "view", grant: "accountant", revoke: "auditor" },
);

// ── message_reports · a reporter reads their own, and NOBODY reads the queue by role (Q-SET13 (c)) ─
// The fixture report was filed by REPORTER; every `as()` caller is USER, somebody else. Before 0396
// the admin and the safety manager read it; now no role does, and no section grant brings it back.
const reportsSeen = (r, s) => seen(r, s, `select id from message_reports where message_id = $1`, [MESSAGE]);
for (const r of ROLES)
  ok(`reports_own_read: ${r} does not read somebody else's report (the role half is gone)`, (await reportsSeen(r, null)) === 0);
ok("reports_own_read: an admin granted every section still reads no one else's report", (await reportsSeen("admin", { safety: "manage", settings: "manage" })) === 0);
ok("reports_own_read: a safety manager granted safety: manage reads no one else's report", (await reportsSeen("safety_manager", { safety: "manage" })) === 0);
/** Run one statement as REPORTER — the person who filed the fixture report. */
async function asReporter(role, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: REPORTER, org_id: ORG, user_role: role, role: "authenticated" }),
    ]);
    return await db.query(sql, params);
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec("rollback");
  }
}
for (const r of ["dispatcher", "driver", "admin"]) {
  const own = await asReporter(r, `select id from message_reports where message_id = $1`, [MESSAGE]);
  ok(`reports_own_read: the reporter (as ${r}) still reads their own report`, own.rows?.length === 1, own.error ?? "");
}
{
  // Why the own half stays: an INSERT … RETURNING must pass a SELECT policy for the row it returns.
  const res = await asReporter("dispatcher", `insert into message_reports (org_id, message_id, reported_by, reason) values ($1,$2,$3,'other') returning id`, [ORG, MESSAGE, REPORTER]);
  ok("reports_own_read: a reporter's INSERT … RETURNING gets its row back", res.rows?.length === 1, res.error ?? "");
}

// ── hazmat_policies · admin only, by ruling ─────────────────────────────────────────────────────
const policyWrite = (r, s) => wrote(r, s, `update hazmat_policies set policy = policy where org_id = $1`, [ORG]);
for (const r of ROLES) {
  const expected = r === "admin";
  ok(`hazmat_policies_admin_write: ${r} is ${expected ? "admitted" : "refused"}`, (await policyWrite(r, null)) === expected);
}
ok("hazmat_policies_admin_write: hazmat: manage granted to a fleet manager does NOT reach it", !(await policyWrite("fleet_manager", { hazmat: "manage" })));

// ── the shape production ends up in ─────────────────────────────────────────────────────────────
const policies = async (table) =>
  (await db.query(`select policyname from pg_policies where tablename = $1 order by 1`, [table])).rows.map((x) => x.policyname);
ok("the three drift duplicates are gone", (await db.query(
  `select 1 from pg_policies where policyname in ('duty_sessions_write','duty_segments_write','load_events_insert')`,
)).rows.length === 0);
ok(
  "driver_duty_sessions keeps its select, its three restrictive driver policies and one write",
  JSON.stringify(await policies("driver_duty_sessions")) ===
    JSON.stringify(["duty_sessions_driver_no_update", "duty_sessions_driver_no_write", "duty_sessions_driver_scope", "duty_sessions_manager_write", "duty_sessions_select"]),
  JSON.stringify(await policies("driver_duty_sessions")),
);
const wrappedNow = (await db.query(
  `select policyname from pg_policies
    where policyname in ('duty_sessions_manager_write','duty_segments_manager_write','hos_duty_segments_write','load_external_payloads_select','load_events_manager_insert')
      and coalesce(qual, with_check) like '%auth_section_or_default%'`,
)).rows.length;
ok("all five section policies read auth_section_or_default", wrappedNow === 5, String(wrappedNow));
ok(
  "message_reports holds the reporter's insert and the reporter's read, and nothing named admin",
  JSON.stringify(await policies("message_reports")) === JSON.stringify(["reports_own", "reports_own_read"]),
  JSON.stringify(await policies("message_reports")),
);

await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
