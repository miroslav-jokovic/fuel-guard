// Silvicom 360 — production and the migrations describe one schema again (migration 0422,
// RELEASE-TRAIN-PLAN Q-REL6).
//
// Until 0422 these were true on production and false on every database rebuilt from migrations
// (staging, these matrices, a disaster-recovery restore), or the other way round. Each block pins
// the promise on the migrations-built side, where it used to be missing:
//
//   · A driver reads no memberships and no other driver's fills — the restrictive denials.
//   · The bucket's first-shape `load-photos` policies are gone; 0085's narrower three remain.
//   · A duty session holds at most one open equipment segment.
//   · The leftover columns and stale overloads are gone, so the first shift can start.
//
// Run:  node supabase/tests/schema-drift-reconciled.test.mjs
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
// Supabase's default privileges, before the migrations, as rls.test.mjs installs them: RLS is the gate.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
const user = async (email, role) => {
  const id = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, $3)`, [ORG, id, role]);
  return id;
};
const OFFICE = await user("office@carrier.test", "admin");
const DRIVER_USER = await user("one@carrier.test", "driver");
const D1 = (await one(`insert into drivers (org_id, full_name, user_id) values ($1, 'Driver One', $2) returning id`,
  [ORG, DRIVER_USER])).id;
const D2 = (await one(`insert into drivers (org_id, full_name) values ($1, 'Driver Two') returning id`, [ORG])).id;
const V1 = (await one(`insert into vehicles (org_id, unit_number, fuel_type, tank_capacity_gal) values ($1, '214', 'diesel', 120) returning id`, [ORG])).id;
const fill = async (driver) => (await one(
  `insert into fuel_transactions (org_id, fueled_at, business_date, state, gallons, total_cost, tank_type,
     vehicle_id, driver_id, is_canonical, card_ref)
   values ($1, now(), current_date, 'TX', 100, 400, 'tractor', $2, $3, true, gen_random_uuid()::text) returning id`,
  [ORG, V1, driver])).id;
const OWN_FILL = await fill(D1);
await fill(D2);

/** Rows a client sees for `q`, under the given JWT claims, inside a rolled-back transaction. */
const seenAs = async (claims, q) => {
  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
  try { return (await db.query(q)).rows; } finally { await db.exec("rollback"); }
};
const AS_DRIVER = { sub: DRIVER_USER, org_id: ORG, user_role: "driver" };
const AS_OFFICE = { sub: OFFICE, org_id: ORG, user_role: "admin" };

// ── 1. restrictive driver denials ────────────────────────────────────────────────────────────────
// 0422 restored six. 0447 (F02-F04 chunk 12b) dropped the sixth, `ftxn_driver_insert`, with every other
// write policy on fills: a restrictive policy only narrows a permissive one, and none is left, so a driver's
// insert is refused outright — asserted per role in `fuel-ledger-section-gate.test.mjs`.
const restrictive = (await db.query(
  `select tablename || '.' || policyname p from pg_policies where permissive = 'RESTRICTIVE'
     and policyname in ('anomalies_driver_deny','thresholds_driver_deny','memberships_driver_deny',
                        'tms_movements_driver_deny','ftxn_driver_select')`)).rows.map((r) => r.p);
ok("all five driver denials exist, and as RESTRICTIVE", restrictive.length === 5, JSON.stringify(restrictive));
const insertPolicies = (await db.query(
  `select policyname from pg_policies where tablename = 'fuel_transactions' and cmd <> 'SELECT'`)).rows.map((r) => r.policyname);
ok("fuel_transactions holds no write policy at all since 0447", insertPolicies.length === 0, JSON.stringify(insertPolicies));

const officeMembers = (await seenAs(AS_OFFICE, `select id from memberships`)).length;
const driverMembers = (await seenAs(AS_DRIVER, `select id from memberships`)).length;
ok("the office still reads its org's memberships", officeMembers >= 2, `saw ${officeMembers}`);
ok("a driver reads no memberships — not even their own", driverMembers === 0, `saw ${driverMembers}`);

const driverFills = (await seenAs(AS_DRIVER, `select id from fuel_transactions`)).map((r) => r.id);
const officeFills = (await seenAs(AS_OFFICE, `select id from fuel_transactions`)).length;
ok("the office reads both drivers' fills", officeFills === 2, `saw ${officeFills}`);
ok("a driver reads their own fill and not the other driver's",
  driverFills.length === 1 && driverFills[0] === OWN_FILL, JSON.stringify(driverFills));

// ── 2. load-photos storage policies ──────────────────────────────────────────────────────────────
const photoPolicies = (await db.query(
  `select policyname from pg_policies where schemaname = 'storage' and policyname like 'load_photos%' order by 1`))
  .rows.map((r) => r.policyname);
ok("the bucket's first-shape read/insert/delete policies are gone",
  !photoPolicies.some((p) => ["load_photos_read", "load_photos_insert", "load_photos_delete"].includes(p)),
  JSON.stringify(photoPolicies));
ok("0085's manager-read, driver-read and driver-write remain",
  ["load_photos_driver_read", "load_photos_driver_write", "load_photos_manager_read"].every((p) => photoPolicies.includes(p)),
  JSON.stringify(photoPolicies));

// ── 3. one open segment per duty session ─────────────────────────────────────────────────────────
const SESSION = "00000000-0000-4000-8000-000000000001";
ok("the first shift starts — no NOT NULL driver_id on its segment stops it",
  (await sqlstate(`select start_duty_session($1,$2,$3,$4,$5,null,null,null,null,false)`,
    [ORG, D1, SESSION, "00000000-0000-4000-8000-000000000002", V1])) === null);
// A DIFFERENT truck, and the co-driver seat, so neither per-vehicle unique can be what refuses it.
const V2 = (await one(`insert into vehicles (org_id, unit_number, fuel_type, tank_capacity_gal) values ($1, '219', 'diesel', 120) returning id`, [ORG])).id;
const secondOpen = await sqlstate(
  `insert into duty_equipment_segments (id, org_id, session_id, vehicle_id, seat, from_at, confirmed_by)
   values (gen_random_uuid(), $1, $2, $3, 'co_driver', now(), 'driver')`, [ORG, SESSION, V2]);
ok("a second open segment in the same session is refused (23505)", secondOpen === "23505", `got ${secondOpen}`);

// ── 4. leftovers ─────────────────────────────────────────────────────────────────────────────────
const leftovers = (await db.query(
  `select table_name || '.' || column_name c from information_schema.columns where table_schema = 'public'
     and (table_name, column_name) in (('duty_equipment_segments','driver_id'), ('driver_duty_sessions','start_lat'),
       ('driver_duty_sessions','start_lon'), ('load_events','actor_driver_id'), ('load_stop_photos','created_at'))`))
  .rows.map((r) => r.c);
ok("none of production's five leftover columns exists", leftovers.length === 0, JSON.stringify(leftovers));
const overloads = (await db.query(
  `select oid::regprocedure::text f from pg_proc where proname in ('resolve_driver_type','start_duty_session')`))
  .rows.map((r) => r.f);
ok("the two stale overloads are gone and one of each name remains",
  overloads.length === 2 && overloads.some((f) => f === "resolve_driver_type(uuid)"), JSON.stringify(overloads));
ok("idx_hazmat_runs_org_created exists",
  (await one(`select count(*)::int c from pg_indexes where indexname = 'idx_hazmat_runs_org_created'`)).c === 1);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
