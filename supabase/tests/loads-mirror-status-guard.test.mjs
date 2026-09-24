// Silvicom 360 — loads_status_guard and the driver scopes for McLeod loads (migration 0368,
// LOADS-MIRROR-PLAN.md LR4a; D-LMR2, D-LMR5, D-LMR7).
//
// Three promises, each held by the DATABASE because the projection and the office paths that call it
// are the things most likely to be wrong:
//
//   · A `tms` load goes where McLeod says. Into pending_approval / approved / in_transit / delivered /
//     canceled from any status, on insert or update, with no approver and no readiness checks —
//     while a MANUAL load keeps 0142's chain exactly.
//   · `source` cannot change, because the first promise trusts it.
//   · A `tms` load is invisible to its driver until it has been SENT (released_at), whatever McLeod's
//     status — the owner's ruling that a load reaches a driver when Silvicom's dispatcher sends it.
//
// Run:  node supabase/tests/loads-mirror-status-guard.test.mjs
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

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier') returning id`)).id;
const USER = (await one(`insert into auth.users (email) values ('driver@carrier.test') returning id`)).id;
await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'driver')`, [ORG, USER]);
const DRIVER = (await one(
  `insert into drivers (org_id, full_name, user_id, status) values ($1, 'Dana Kelly', $2, 'active') returning id`,
  [ORG, USER])).id;

let n = 0;
const tms = async (status, extra = {}) => {
  n++;
  const cols = ["org_id", "ref", "status", "source", "provider", "external_id", "driver_id", ...Object.keys(extra)];
  const vals = [ORG, `MC-${n}`, status, "tms", "mcleod", `TMS:${n}`, DRIVER, ...Object.values(extra)];
  return (await one(
    `insert into loads (${cols.join(",")}) values (${vals.map((_, i) => `$${i + 1}`).join(",")}) returning id`, vals)).id;
};
const status = async (id) => (await one(`select status from loads where id = $1`, [id])).status;
const set = (id, s) => sqlstate(`update loads set status = $2 where id = $1`, [id, s]);

// ── 1. the guard: McLeod's word for a tms load ───────────────────────────────────────────────────
for (const s of ["pending_approval", "approved", "in_transit", "delivered", "canceled"]) {
  n++;
  ok(`a tms load may be CREATED as ${s} — a movement first seen already under way`,
    (await sqlstate(`insert into loads (org_id, ref, status, source, provider, external_id) values ($1, $2, $3, 'tms', 'mcleod', $2)`,
      [ORG, `NEW-${n}`, s])) === null);
}
const A = await tms("pending_approval");
ok("uncovered → dispatched with NO approver and no stops (McLeod dispatched it; 0142 would say DL011)",
  (await set(A, "approved")) === null && (await status(A)) === "approved");
ok("dispatched → in transit, skipping offered and accepted", (await set(A, "in_transit")) === null);
ok("in transit → delivered", (await set(A, "delivered")) === null);
ok("McLeod's delivery does NOT stamp completed_at — that is the driver's",
  (await one(`select completed_at from loads where id = $1`, [A])).completed_at === null);
ok("a voided load McLeod reopens is reopened (canceled → pending_approval)",
  (await set(A, "canceled")) === null && (await set(A, "pending_approval")) === null);
ok("but a tms load still cannot jump into the office's statuses: pending_approval → offered is refused",
  (await set(A, "offered")) === "DL010");

// ── 1b. manual loads are exactly 0142 ────────────────────────────────────────────────────────────
ok("a MANUAL load still may not be created in transit",
  (await sqlstate(`insert into loads (org_id, ref, status) values ($1, 'MAN-1', 'in_transit')`, [ORG])) === "DL010");
const M = (await one(`insert into loads (org_id, ref, status, driver_id) values ($1, 'MAN-2', 'pending_approval', $2) returning id`,
  [ORG, DRIVER])).id;
ok("a manual approval still needs an approver (DL011)", (await set(M, "approved")) === "DL011");
ok("and a manual load still cannot skip to in transit (DL010)", (await set(M, "in_transit")) === "DL010");

// ── 2. source is fixed ───────────────────────────────────────────────────────────────────────────
ok("a manual load cannot be turned into a tms load to borrow its freedom",
  (await sqlstate(`update loads set source = 'tms' where id = $1`, [M])) === "DL010");
ok("nor a tms load into a manual one", (await sqlstate(`update loads set source = 'manual' where id = $1`, [A])) === "DL010");

// ── 3. the driver scope: a tms load reaches its driver only once it has been sent ────────────────
const claims = JSON.stringify({ sub: USER, org_id: ORG, user_role: "driver" });
const asDriver = async (sql, params = []) => {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("rollback");
  }
};
const T = await tms("in_transit");
await db.query(`insert into load_stops (org_id, load_id, seq, kind, name) values ($1, $2, 1, 'pickup', 'Shipper')`, [ORG, T]);
await db.query(`insert into load_events (org_id, load_id, kind, to_status) values ($1, $2, 'created', 'in_transit')`, [ORG, T]);
const MAN = (await one(`insert into loads (org_id, ref, status, driver_id) values ($1, 'MAN-3', 'pending_approval', $2) returning id`,
  [ORG, DRIVER])).id;
const APPROVER = (await one(`insert into auth.users (email) values ('dispatch@carrier.test') returning id`)).id;

ok("the driver resolves as themselves (harness check)",
  (await asDriver(`select auth_driver_id() id`))[0]?.id === DRIVER);
ok("an UNSENT tms load in transit is invisible to its own driver",
  (await asDriver(`select id from loads where id = $1`, [T])).length === 0);
// The stop and event assertions hold through `loads_driver_scope` (the policies' `exists` reads `loads`
// under the driver's RLS); their own copy of the predicate is defence in depth that no row here can
// isolate — see 0368's section 3.
ok("…and so are its stops", (await asDriver(`select id from load_stops where load_id = $1`, [T])).length === 0);
ok("…and its events", (await asDriver(`select id from load_events where load_id = $1`, [T])).length === 0);
await db.query(`update loads set released_at = now() where id = $1`, [T]);
ok("once it has been sent, the driver sees the load", (await asDriver(`select id from loads where id = $1`, [T])).length === 1);
ok("…and its stops", (await asDriver(`select id from load_stops where load_id = $1`, [T])).length === 1);
ok("…and its events", (await asDriver(`select id from load_events where load_id = $1`, [T])).length === 1);

// A manual load needs no released_at beyond its status — 0087's rule, unchanged.
await db.query(`insert into load_stops (org_id, load_id, seq, kind, name, appointment_start, appointment_end) values
  ($1, $2, 1, 'pickup', 'S', now(), now()), ($1, $2, 2, 'dropoff', 'C', now(), now())`, [ORG, MAN]);
const V = (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1, '702', 150) returning id`, [ORG])).id;
await db.query(`update loads set vehicle_id = $2 where id = $1`, [MAN, V]);
await db.query(`update loads set status = 'approved', approved_by = $2 where id = $1`, [MAN, APPROVER]);
await db.query(`update loads set status = 'offered' where id = $1`, [MAN]);
ok("a manual load the office released is visible to its driver, as before",
  (await asDriver(`select id from loads where id = $1`, [MAN])).length === 1);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
