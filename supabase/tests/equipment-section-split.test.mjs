// Silvicom 360 — the `roster` / `equipment` section split, at the RLS layer (0277).
//
// D-ROS12, docs/plans/roster/DRIVER-ROSTER-PLAN.md step R0a. The split exists because one `fleet`
// section answered two questions, and the forcing case is a single role: a `safety_manager` owns the
// §391.51 driver qualification file and must WRITE driver rows, while having no business editing a
// tractor's plate or VIN. 0078 gave them both, because `rolesThatManage("fleet")` covered both.
//
// This matrix pins the two halves against each other, which is the only way the pair can be trusted:
// a test that only proved the revocation would pass just as happily if 0277 had accidentally revoked
// the roster write too, and THAT failure — a safety manager who can no longer maintain the
// qualification file — is worse than the leak the split closes.
//
// The reads are asserted alongside the writes on purpose. `equipment: view` is a real grant, and
// `vehicles_select` / `trailers_select` carry no role test at all, so the revocation must be visible
// in exactly one column: a safety_manager still SEES every truck and can no longer CHANGE one.
//
// Run:  node supabase/tests/equipment-section-split.test.mjs
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
const DRIVER = (
  await one(`insert into drivers (org_id, full_name, samsara_driver_id) values ($1,'A Driver','S1') returning id`, [ORG])
).id;
const VEHICLE = (
  await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,'101',150) returning id`, [ORG])
).id;
const TRAILER = (await one(`insert into trailers (org_id, unit_number) values ($1,'T-1') returning id`, [ORG])).id;

/** Run one statement as an org member holding `role` (the JWT shape rls.test.mjs uses). */
async function as(role, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ACTOR, org_id: ORG, user_role: role, role: "authenticated" }),
    ]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return res;
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}

/** An UPDATE refused by RLS affects zero rows rather than raising — that is the signal to assert. */
const updated = async (role, sql, params) => {
  const res = await as(role, sql, params);
  return res.error ? `ERROR: ${res.error}` : res.affectedRows ?? 0;
};
const counted = async (role, sql) => {
  const res = await as(role, sql);
  return res.error ? `ERROR: ${res.error}` : Number(res.rows[0].n);
};

const SET_DRIVER = "update drivers set employee_id = 'E9' where id = $1";
const SET_VEHICLE = "update vehicles set plate = 'XYZ123' where id = $1";
const SET_TRAILER = "update trailers set plate = 'XYZ123' where id = $1";

// ── The forcing case, both halves ───────────────────────────────────────────────
// If either of these two lines flips, the split has failed in one of its two directions.
ok(
  "safety_manager still writes a driver row (roster: manage — the §391.51 file stays maintainable)",
  (await updated("safety_manager", SET_DRIVER, [DRIVER])) === 1,
);
ok(
  "safety_manager can no longer write a vehicle (equipment: view — 0277's revocation)",
  (await updated("safety_manager", SET_VEHICLE, [VEHICLE])) === 0,
);
ok(
  "safety_manager can no longer write a trailer (equipment: view)",
  (await updated("safety_manager", SET_TRAILER, [TRAILER])) === 0,
);

// ── The revocation is a WRITE revocation, not a read one ────────────────────────
// `equipment: view` has to still mean something, or the split would have quietly demoted the role to
// `equipment: none` and nobody would notice until a safety manager could not see the truck list.
ok(
  "safety_manager still reads every vehicle (equipment: view is a real grant)",
  (await counted("safety_manager", "select count(*)::int as n from vehicles")) === 1,
);
ok(
  "safety_manager still reads every trailer",
  (await counted("safety_manager", "select count(*)::int as n from trailers")) === 1,
);

// ── The roles that manage equipment still do ────────────────────────────────────
// rolesThatManage('equipment') = ['admin','fleet_manager'].
for (const role of ["admin", "fleet_manager"]) {
  ok(`${role} writes a vehicle`, (await updated(role, SET_VEHICLE, [VEHICLE])) === 1);
  ok(`${role} writes a trailer`, (await updated(role, SET_TRAILER, [TRAILER])) === 1);
  ok(`${role} writes a driver`, (await updated(role, SET_DRIVER, [DRIVER])) === 1);
}

// ── Nobody gained anything ──────────────────────────────────────────────────────
// A dispatcher reads both sections and manages neither; a recruiter's by-name driver grant (0212)
// survives the rename, and is the one write that must NOT have been swept up in it.
ok("dispatcher cannot write a vehicle", (await updated("dispatcher", SET_VEHICLE, [VEHICLE])) === 0);
ok("dispatcher cannot write a driver", (await updated("dispatcher", SET_DRIVER, [DRIVER])) === 0);
ok(
  "recruiter keeps the by-name driver write 0212 granted (the split did not sweep it up)",
  (await updated("recruiter", SET_DRIVER, [DRIVER])) === 1,
);
ok("recruiter cannot write a vehicle", (await updated("recruiter", SET_VEHICLE, [VEHICLE])) === 0);
ok("driver cannot write a vehicle", (await updated("driver", SET_VEHICLE, [VEHICLE])) === 0);

await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
