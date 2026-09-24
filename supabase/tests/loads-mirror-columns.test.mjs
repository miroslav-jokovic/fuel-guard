// Silvicom 360 — the McLeod mirror's core columns on loads / load_stops (migration 0366,
// LOADS-MIRROR-PLAN.md LR2).
//
// Schema only, so what can be wrong is the SHAPE, and three parts of it are promises a later
// reader relies on:
//
//   · MISSING IS NULL, NEVER ZERO. Every new column is nullable with no default: a load McLeod has
//     no weight for is not a weightless load, and a stop with no ETA is not due at the epoch. A
//     default would also silently stamp every existing row with a fact nobody asserted.
//   · McLEOD'S ARRIVAL IS ITS OWN COLUMN. `arrived_at` is the driver app's witness; the McLeod actual
//     goes beside it, never into it, so Q-LMR2 can be ruled either way without losing a fact.
//   · THE TYPES THE PROJECTION WILL WRITE: times are instants, weight is numeric, `loaded` a boolean.
//
// Run:  node supabase/tests/loads-mirror-columns.test.mjs
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

// Apply everything BEFORE 0366 first and seed a load, so the matrix can prove what the migration
// does to rows that already exist — production holds 303 loads and 629 stops when it lands.
const BEFORE = MIGRATIONS.filter((f) => f < "0366");
const REST = MIGRATIONS.filter((f) => f >= "0366");
const apply = async (fs) => {
  for (const f of fs) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
};
await apply(BEFORE);
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier A') returning id`)).id;
const LOAD = (await one(
  `insert into loads (org_id, ref, status, source, provider) values ($1, 'LD-1', 'pending_approval', 'tms', 'mcleod')
   returning id`, [ORG])).id;
const ARRIVED = "2026-09-24T14:05:00Z";
await db.query(
  `insert into load_stops (org_id, load_id, seq, kind, name, arrived_at) values ($1, $2, 1, 'pickup', 'MILWAUKEE, WI', $3)`,
  [ORG, LOAD, ARRIVED]);
await apply(REST);

const EXPECT = {
  loads: {
    customer_code: "text", weight_lbs: "numeric", pieces: "integer", pickup_number: "text",
    consignee_ref: "text", loaded: "boolean", external_closed_at: "timestamp with time zone",
  },
  load_stops: {
    location_name: "text", location_code: "text", external_status: "text",
    actual_arrival_at: "timestamp with time zone", actual_departure_at: "timestamp with time zone",
    eta_at: "timestamp with time zone", contact_name: "text", contact_phone: "text", po_number: "text",
  },
};

for (const [table, cols] of Object.entries(EXPECT)) {
  const rows = (await db.query(
    `select column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_name = $1 and column_name = any($2)`, [table, Object.keys(cols)])).rows;
  const got = Object.fromEntries(rows.map((r) => [r.column_name, r]));
  for (const [col, type] of Object.entries(cols)) {
    const r = got[col];
    ok(`${table}.${col} exists as ${type}`, r?.data_type === type, JSON.stringify(r ?? null));
    ok(`${table}.${col} is nullable with NO default — missing is null, never zero`,
      r?.is_nullable === "YES" && r?.column_default === null, JSON.stringify(r ?? null));
  }
}

const load = await one(`select customer_code, weight_lbs, pieces, loaded, external_closed_at from loads where id = $1`, [LOAD]);
ok("an existing load reads null in every new column — nobody has asked McLeod yet",
  Object.values(load).every((v) => v === null), JSON.stringify(load));
const stop = await one(
  `select arrived_at, actual_arrival_at, eta_at, location_name, external_status from load_stops where load_id = $1`, [LOAD]);
ok("the driver's arrived_at is untouched by the migration",
  new Date(stop.arrived_at).toISOString() === new Date(ARRIVED).toISOString(), String(stop.arrived_at));
ok("and McLeod's actual sits beside it, empty, not copied from it (Q-LMR2 stays open)",
  stop.actual_arrival_at === null && stop.eta_at === null && stop.location_name === null && stop.external_status === null,
  JSON.stringify(stop));

await db.query(`update load_stops set actual_arrival_at = '2026-09-24T15:00:00Z' where load_id = $1`, [LOAD]);
const both = await one(`select arrived_at, actual_arrival_at from load_stops where load_id = $1`, [LOAD]);
ok("writing McLeod's arrival leaves the driver's standing — two witnesses, two columns",
  new Date(both.arrived_at).toISOString() === new Date(ARRIVED).toISOString() &&
    new Date(both.actual_arrival_at).toISOString() === "2026-09-24T15:00:00.000Z", JSON.stringify(both));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
