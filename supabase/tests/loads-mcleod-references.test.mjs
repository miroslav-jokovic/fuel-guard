// Silvicom 360 — a McLeod stop's reference numbers (raw and core), a load's BOL number and its
// unmatched equipment codes (migrations 0658 raw and 0659 core, spec B §3.2, T1 N-2).
//
// Schema only, so what can be wrong is the SHAPE:
//
//   · MISSING IS NULL. Every new column is nullable with no default, so the loads and stops that
//     already exist read null until McLeod is asked, rather than a value nobody stated.
//   · AN ARRAY OR NOTHING. Each jsonb column carries a CHECK refusing anything but an array or
//     null, so the readers that follow never meet an object or a scalar. One test per CHECK.
//
// Run:  node supabase/tests/loads-mcleod-references.test.mjs
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
const refused = async (q, p = []) => {
  try { await db.query(q, p); return false; } catch (e) { return /check constraint/i.test(String(e.message)); }
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

// Everything before 0658 first, with a load, its stop and a raw stop seeded, so the matrix sees
// what the migrations do to rows that already exist.
const apply = async (fs) => {
  for (const f of fs) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
};
await apply(MIGRATIONS.filter((f) => f < "0658"));
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier A') returning id`)).id;
const LOAD = (await one(
  `insert into loads (org_id, ref, status, source, provider, customer_code)
   values ($1, 'LD-1', 'pending_approval', 'tms', 'mcleod', 'BATSOLWI') returning id`, [ORG])).id;
const STOP = (await one(
  `insert into load_stops (org_id, load_id, seq, kind, name) values ($1, $2, 1, 'pickup', 'Shipper') returning id`,
  [ORG, LOAD])).id;
await db.query(
  `insert into mcleod_dispatch_movements (org_id, company_id, movement_id) values ($1, 'TMS', '291013')`, [ORG]);
await db.query(
  `insert into mcleod_dispatch_stops (org_id, company_id, stop_id, movement_id) values ($1, 'TMS', 'S1', '291013')`,
  [ORG]);
await apply(MIGRATIONS.filter((f) => f >= "0658"));

const load = await one(`select bol_number, external_unmatched from loads where id = $1`, [LOAD]);
ok("existing loads read null for bol_number and external_unmatched",
  load.bol_number === null && load.external_unmatched === null, JSON.stringify(load));

const ARRAY = JSON.stringify([{ qualifier: "P8", value: "4471" }]);
const OBJECT = JSON.stringify({ qualifier: "P8", value: "4471" });
const STOPS = [
  { table: "load_stops", where: "id = $2", key: STOP },
  { table: "mcleod_dispatch_stops", where: "stop_id = $2", key: "S1" },
];
for (const s of STOPS) {
  const before = await one(`select reference_numbers from ${s.table} where org_id = $1 and ${s.where}`, [ORG, s.key]);
  await db.query(`update ${s.table} set reference_numbers = $3::jsonb where org_id = $1 and ${s.where}`, [ORG, s.key, ARRAY]);
  const after = await one(`select reference_numbers from ${s.table} where org_id = $1 and ${s.where}`, [ORG, s.key]);
  await db.query(`update ${s.table} set reference_numbers = null where org_id = $1 and ${s.where}`, [ORG, s.key]);
  const cleared = await one(`select reference_numbers from ${s.table} where org_id = $1 and ${s.where}`, [ORG, s.key]);
  ok(`a stop's reference_numbers accepts an array and null (${s.table})`,
    before.reference_numbers === null && after.reference_numbers?.[0]?.value === "4471" && cleared.reference_numbers === null,
    JSON.stringify({ before, after, cleared }));
  ok(`a stop's reference_numbers refuses an object (${s.table})`,
    await refused(`update ${s.table} set reference_numbers = $3::jsonb where org_id = $1 and ${s.where}`, [ORG, s.key, OBJECT]));
}
ok("a stop's reference_numbers refuses an object (loads.external_unmatched)",
  await refused(`update loads set external_unmatched = $2::jsonb where id = $1`,
    [LOAD, JSON.stringify({ role: "truck", code: "512", reason: "unknown" })]));

const cols = (await db.query(
  `select table_name, column_name, column_default from information_schema.columns
    where (table_name, column_name) in (('mcleod_dispatch_stops','reference_numbers'), ('loads','bol_number'),
          ('loads','external_unmatched'), ('load_stops','reference_numbers'))`)).rows;
ok("no new column has a default",
  cols.length === 4 && cols.every((c) => c.column_default === null), JSON.stringify(cols));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
