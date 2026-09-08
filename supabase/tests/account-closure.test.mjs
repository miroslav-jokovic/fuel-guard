// Silvicom 360 — driver account-closure request matrix (migration 0330).
//
// The behaviour this file pins is the half of P4 that is NOT in the API: what the DATABASE
// guarantees about a closure request, whoever is asking and however the code above it changes.
//
// Seven rules, each a fact here rather than a comment in the migration:
//
//   1. AC010 — the REQUEST half is frozen. What a driver asked, and when, is not editable, by
//      anybody, including the service role.
//   2. AC010 again — a resolved request is FINAL. `open → completed` is allowed once; nothing
//      leaves `completed` or `declined`. Reopening would let a fleet satisfy an auditor and then
//      quietly move the row back.
//   3. ⚠ `driver_id` is deliberately NOT frozen, so `merge_driver_v2` can carry the row. This is
//      the case the cascade trap produces: the FK is `on delete restrict`, so an unhandled merge
//      does not strand the row — it ABORTS the whole merge.
//   4. One OPEN request per driver, enforced by a partial unique index, because the driver's
//      request rides the offline outbox and is therefore retried. A second open request is the
//      retry, not a second driver.
//   5. ...but a CLOSED-then-rehired driver may ask again. The index is partial for that reason.
//   6. The driver row cannot be deleted out from under a request — though NOT by the FK, which is
//      the measurement that corrected this file's first draft. See section 7.
//   7. RLS is deny-all: no client policy, so neither the driver who asked nor the admin resolving
//      it can touch the table from a browser session. Both sides go through the API.
//
// Run:  node supabase/tests/account-closure.test.mjs
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
const count = async (q, p = []) => Number((await one(q, p)).n);

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
// Supabase's real default privileges, installed BEFORE the migrations run — same modelling (and the
// same reasoning) as rls.test.mjs: full DML granted, RLS is the gate.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ACTOR = "00000000-0000-4000-8000-000000000001";
const DRIVER_USER = "00000000-0000-4000-8000-000000000002";
await db.query(`insert into auth.users (id, email) values ($1, 'admin@test') on conflict do nothing`, [ACTOR]);
await db.query(`insert into auth.users (id, email) values ($1, 'driver@test') on conflict do nothing`, [DRIVER_USER]);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
// A second org, used ONLY to prove org_id is frozen. Setting a column to the value it already holds
// is not a change — `is distinct from` is false — so a first draft of that assertion passed against
// a guard that does nothing. The tenant it would be moved to has to be a real, different one.
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'O') returning id`)).id;
const driver = async (name, org = ORG) =>
  (await one(`insert into drivers (org_id,full_name) values ($1,$2) returning id`, [org, name])).id;

const DRIVER = await driver("Leaving Soon");

const request = async (driverId = DRIVER, org = ORG, user = DRIVER_USER) =>
  one(
    `insert into driver_account_closure_requests (org_id, driver_id, user_id)
     values ($1,$2,$3) returning id, status, requested_at`,
    [org, driverId, user],
  );

const attempt = async (sql, params = []) => {
  try {
    await db.query(sql, params);
    return "OK";
  } catch (e) {
    return e.code ?? `ERROR: ${e.message}`;
  }
};

// ── 1. It records, and it starts open ─────────────────────────────────────────────────────────
const REQ = await request();
ok("a request is recorded", (await count(`select count(*)::int as n from driver_account_closure_requests where id = $1`, [REQ.id])) === 1);
ok("it starts open", REQ.status === "open");

// ── 2. The vocabulary is closed ───────────────────────────────────────────────────────────────
ok(
  "an unknown status is refused",
  (await attempt(
    `insert into driver_account_closure_requests (org_id, driver_id, user_id, status, resolved_by, resolved_at)
     values ($1,$2,$3,'archived',$4,now())`,
    [ORG, await driver("Bad Status"), DRIVER_USER, ACTOR],
  )) === "23514",
);

// ── 3. A resolved request names its resolver AND its moment ───────────────────────────────────
// The constraint is one statement rather than two nullable columns, because "completed by nobody at
// no time" is the shape an audit finding takes.
ok(
  "completed with no resolver is refused",
  (await attempt(`update driver_account_closure_requests set status = 'completed', resolved_at = now() where id = $1`, [REQ.id])) ===
    "23514",
);
ok(
  "open with a resolver is refused",
  (await attempt(`update driver_account_closure_requests set resolved_by = $2, resolved_at = now() where id = $1`, [REQ.id, ACTOR])) ===
    "23514",
);

// ── 4. AC010 — the request half is frozen ─────────────────────────────────────────────────────
for (const [col, value] of [
  ["org_id", OTHER],
  ["user_id", ACTOR],
  ["requested_at", "2020-01-01"],
]) {
  const code = await attempt(`update driver_account_closure_requests set ${col} = $2 where id = $1`, [REQ.id, value]);
  ok(`${col} cannot be edited (AC010)`, code === "AC010", `got ${code}`);
}

// ⚠ …but driver_id CAN move, or merge_driver_v2 would abort at the trigger instead of at the FK.
const SURVIVOR = await driver("Canonical");
ok(
  "driver_id is NOT frozen, so a merge can carry the request",
  (await attempt(`update driver_account_closure_requests set driver_id = $2 where id = $1`, [REQ.id, SURVIVOR])) === "OK",
);
await db.query(`update driver_account_closure_requests set driver_id = $2 where id = $1`, [REQ.id, DRIVER]);

// ── 5. Resolution happens once, and is final ──────────────────────────────────────────────────
ok(
  "a fleet manager can complete an open request",
  (await attempt(
    `update driver_account_closure_requests set status = 'completed', resolved_by = $2, resolved_at = now() where id = $1`,
    [REQ.id, ACTOR],
  )) === "OK",
);
ok(
  "a completed request cannot be reopened (AC010)",
  (await attempt(`update driver_account_closure_requests set status = 'open', resolved_by = null, resolved_at = null where id = $1`, [
    REQ.id,
  ])) === "AC010",
);
ok(
  "a completed request cannot be flipped to declined (AC010)",
  (await attempt(`update driver_account_closure_requests set status = 'declined' where id = $1`, [REQ.id])) === "AC010",
);
// The note stays writable on a resolved row: the fleet records WHY after the fact, and nothing about
// that rewrites what the driver asked or when it was honoured.
ok(
  "the note can still be written on a resolved request",
  (await attempt(`update driver_account_closure_requests set note = 'DQ file retained per 391.51' where id = $1`, [REQ.id])) === "OK",
);

// ── 6. One OPEN request per driver — the outbox retry, not a second driver ────────────────────
const RETRIER = await driver("Bad Signal");
await request(RETRIER);
ok(
  "a second open request for the same driver is refused",
  (await attempt(`insert into driver_account_closure_requests (org_id, driver_id, user_id) values ($1,$2,$3)`, [
    ORG,
    RETRIER,
    DRIVER_USER,
  ])) === "23505",
);
// …and the driver whose earlier request is RESOLVED may ask again: rehired, second departure.
ok(
  "a driver whose request was resolved may ask again",
  (await attempt(`insert into driver_account_closure_requests (org_id, driver_id, user_id) values ($1,$2,$3)`, [ORG, DRIVER, DRIVER_USER])) ===
    "OK",
);

// ── 7. The driver row cannot be deleted out from under a request ──────────────────────────────
/*
 * ⚠ MEASURED, NOT ASSUMED — and the first draft of this assertion was wrong in an instructive way.
 *
 * It expected `23503`, the foreign-key violation, on the theory that `on delete restrict` is what
 * stops the delete. It is not: 0235's `DR010` guard refuses a hard delete of ANY driver and fires
 * first, so the FK is never consulted. Both are true and the order matters — the FK is the BACKSTOP,
 * the thing that would still refuse if the roster guard were ever relaxed, and it is also the reason
 * an unhandled `merge_driver_v2` move aborts the whole merge loudly instead of stranding the row.
 *
 * Asserting the code that actually comes back is the point. An assertion written against the
 * mechanism you assumed, rather than the one that runs, passes for the wrong reason the day the
 * other mechanism is removed.
 */
const deleteCode = await attempt(`delete from drivers where id = $1`, [RETRIER]);
ok("deleting a driver with a closure request is refused", deleteCode !== "OK", `got ${deleteCode}`);
ok(
  "…refused by the roster's own hard-delete guard (DR010), before the FK is ever consulted",
  deleteCode === "DR010",
  `got ${deleteCode}`,
);

// ── 8. RLS is deny-all for a browser session ──────────────────────────────────────────────────
// No client policies, by design. Note WHICH session this is: the driver who filed the request, with
// a valid JWT for their own org. Even they cannot read their own row directly — the API is the only
// door, and a client that could UPDATE here could mark its own closure completed without a fleet
// ever deleting anything.
await db.exec("begin");
await db.exec("set local role authenticated");
await db.query("select set_config('request.jwt.claims', $1, true)", [
  JSON.stringify({ sub: DRIVER_USER, org_id: ORG, user_role: "driver", role: "authenticated" }),
]);
const asDriver = Number((await db.query(`select count(*)::int as n from driver_account_closure_requests`)).rows[0].n);
const driverInsert = await attempt(`insert into driver_account_closure_requests (org_id, driver_id, user_id) values ($1,$2,$3)`, [
  ORG,
  SURVIVOR,
  DRIVER_USER,
]);
await db.exec("rollback");
ok("the driver who asked cannot read the table directly", asDriver === 0);
ok("the driver who asked cannot write to it directly", driverInsert === "42501", `got ${driverInsert}`);

await db.exec("begin");
await db.exec("set local role authenticated");
await db.query("select set_config('request.jwt.claims', $1, true)", [
  JSON.stringify({ sub: ACTOR, org_id: ORG, user_role: "admin", role: "authenticated" }),
]);
const asAdmin = Number((await db.query(`select count(*)::int as n from driver_account_closure_requests`)).rows[0].n);
await db.exec("rollback");
ok("even an admin's browser session reads nothing directly — the API is the only door", asAdmin === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
