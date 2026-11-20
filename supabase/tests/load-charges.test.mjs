// Silvicom 360 — load_charges (0639) and the McLeod mirror's order charges (0638).
//
// LOAD-RATES-PLAN.md R1, D-RATE2. The plan carries the argument; this matrix carries what only the
// database can answer:
//
//  1. Nobody signed in reads a price from the browser — not an admin, not a dispatcher, not a driver,
//     not anon — even with rows present. The API's service role reads them (D-RATE7 decides who sees).
//  2. A row needs McLeod's total; its parts may be blank; a negative other charge is stored as McLeod
//     recorded it (measured: 10 orders since 2026-01-01).
//  3. One row per load; it goes with its load and its organization, and never moves to another org.
//  4. The raw mirror takes the seven new columns, all nullable, so a movement synced by the VM's
//     current connector (which does not read them) is stored exactly as before.
//
// Run:  node supabase/tests/load-charges.test.mjs
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
const sqlstate = async (q, p = []) => {
  try {
    await db.query(q, p);
    return null;
  } catch (e) {
    return e.code ?? String(e.message);
  }
};

/** A query as a signed-in browser (role + JWT claims), rolled back — rls.test.mjs's `asUser`. */
async function asRole(dbRole, claims, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${dbRole}`);
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return { rows: res.rows };
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}

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
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
  "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Carrier') returning id`)).id;
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;
const load = async (org, ref) =>
  (await one(
    `insert into loads (org_id, ref, status, source, provider, external_id) values ($1, $2, 'in_transit', 'tms', 'mcleod', $2) returning id`,
    [org, ref],
  )).id;
const L1 = await load(ORG, "TMS:1001");
const L2 = await load(ORG, "TMS:1002");
const L3 = await load(ORG, "TMS:1003");
const LO = await load(OTHER, "TMS:2001");
const put = (loadId, org, total, linehaul = null, other = null, currency = "USD", miles = null, legs = 1) =>
  sqlstate(
    `insert into load_charges (load_id, org_id, total_charge, linehaul, other_charges, currency, billed_miles, order_loaded_movements)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [loadId, org, total, linehaul, other, currency, miles, legs],
  );

// ── 2. What a row holds ───────────────────────────────────────────────────────────────────────────
ok("a priced load is stored: total, linehaul, other, currency, billed miles, legs", (await put(L1, ORG, 4580.39, 4400, 180.39, "USD", 1982.5, 1)) === null);
ok("a total with blank parts is stored (McLeod's parts are nullable)", (await put(L2, ORG, 2700, null, null, null, null, null)) === null);
ok("a negative other charge is stored as McLeod recorded it", (await put(L3, ORG, 2000, 3000, -1000, "USD", 836, 2)) === null);
ok("a row needs McLeod's total (23502)", (await put(LO, OTHER, null)) === "23502");
ok("a load has one price row (23505)", (await put(L1, ORG, 1)) === "23505");
ok("a negative leg count is refused (23514)", (await put(LO, OTHER, 100, null, null, "USD", null, -1)) === "23514");
ok("a price for a load that does not exist is refused (23503)", (await put("00000000-0000-0000-0000-000000000001", ORG, 1)) === "23503");
const r1 = await one(`select total_charge::text t, other_charges::text o, billed_miles::text m from load_charges where load_id = $1`, [L1]);
ok("figures keep McLeod's precision (16,2 money, 10,1 miles)", r1.t === "4580.39" && r1.o === "180.39" && r1.m === "1982.5");
ok("an amount finer than a cent is rounded to the cent, as McLeod's decimal(16,2) holds it",
  (await sqlstate(`update load_charges set total_charge = 1.005 where load_id = $1`, [L2])) === null &&
  (await one(`select total_charge::text t from load_charges where load_id = $1`, [L2])).t === "1.01");
ok("the other carrier's load is priced on its own", (await put(LO, OTHER, 900, 900, 0)) === null);

// ── 3. Tenancy and lifetime ───────────────────────────────────────────────────────────────────────
ok("a row never moves to another organization (TG001)", (await sqlstate(`update load_charges set org_id = $1 where load_id = $2`, [OTHER, L1])) === "TG001");
await db.query(`delete from loads where id = $1`, [L3]);
ok("a price goes with its load", Number((await one(`select count(*)::int n from load_charges where load_id = $1`, [L3])).n) === 0);

// ── 1. Nobody in a browser reads a price ──────────────────────────────────────────────────────────
const count = "select count(*)::int n from load_charges";
const held = Number((await one(count)).n);
ok("rows are present for the browser checks below", held === 3, `(${held})`);
for (const role of ["admin", "fleet_manager", "dispatcher", "safety_manager", "auditor", "accountant", "recruiter", "technician"]) {
  const r = await asRole("authenticated", { org_id: ORG, user_role: role }, count);
  ok(`a signed-in ${role} reads no price from the browser`, r.rows?.[0]?.n === 0, JSON.stringify(r));
}
const drv = await asRole("authenticated", { org_id: ORG, user_role: "driver" }, count);
ok("a driver reads no price from the browser", drv.rows?.[0]?.n === 0, JSON.stringify(drv));
const anon = await asRole("anon", { role: "anon" }, count);
ok("anon reads no price", anon.rows?.[0]?.n === 0, JSON.stringify(anon));
const write = await asRole("authenticated", { org_id: ORG, user_role: "admin" },
  `insert into load_charges (load_id, org_id, total_charge) values ($1, $2, 1)`, [L3]);
ok("a signed-in admin cannot write a price from the browser", !!write.error, JSON.stringify(write));
ok("the service role reads them (the API's only path)", (await asRole("service_role", {}, count)).rows?.[0]?.n === 3);
const policies = Number((await one(`select count(*)::int n from pg_policies where tablename = 'load_charges'`)).n);
const rls = (await one(`select relrowsecurity r from pg_class where relname = 'load_charges'`)).r;
ok("RLS is on with no client policy — deny-all from the browser", policies === 0 && rls === true);

await db.query(`delete from organizations where id = $1`, [OTHER]);
ok("rows go with their organization", Number((await one(`select count(*)::int n from load_charges where org_id = $1`, [OTHER])).n) === 0);

// ── 4. The raw mirror's seven new columns ─────────────────────────────────────────────────────────
const cols = (await db.query(
  `select column_name, data_type, is_nullable, column_default from information_schema.columns
    where table_name = 'mcleod_dispatch_movements' and column_name = any($1) order by column_name`,
  [["total_charge", "freight_charge", "otherchargetotal", "total_charge_c", "bill_distance", "bill_distance_um", "order_loaded_movements"]],
)).rows;
ok("the mirror has all seven new columns", cols.length === 7, JSON.stringify(cols.map((c) => c.column_name)));
ok("…all nullable with no default, so an older connector's row reads null, never a made-up value",
  cols.every((c) => c.is_nullable === "YES" && c.column_default === null));
ok("…money and miles are numeric, the codes text, the leg count integer",
  cols.every((c) => (["total_charge_c", "bill_distance_um"].includes(c.column_name) ? c.data_type === "text"
    : c.column_name === "order_loaded_movements" ? c.data_type === "integer" : c.data_type === "numeric")));
ok("a movement written as the current connector writes it (no charge columns) is stored", (await sqlstate(
  `insert into mcleod_dispatch_movements (org_id, company_id, movement_id, order_id, movement_status, loaded)
   values ($1, 'TMS', '292459', '0135723', 'P', 'L')`, [ORG])) === null);
ok("…and a negative other charge on the mirror is stored too", (await sqlstate(
  `update mcleod_dispatch_movements set total_charge = 2000, freight_charge = 3000, otherchargetotal = -1000,
     total_charge_c = 'USD', bill_distance = 836.0, bill_distance_um = 'MI', order_loaded_movements = 2
   where org_id = $1 and movement_id = '292459'`, [ORG])) === null);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
