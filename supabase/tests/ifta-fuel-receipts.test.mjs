// Silvicom 360 — driver-paid fuel uploaded for IFTA (migration 0436, ifta_fuel_receipt_uploads +
// ifta_fuel_receipts). IFTA-PRECISION-PLAN IP8.
//
// A tax-paid gallon is evidence, so both tables must refuse every edit except a one-time void, and
// refuse every delete. The same file uploaded twice must land once (one live row per fingerprint),
// and a voided row must free its fingerprint so the corrected file can land. A receipt with no
// truck, a lower-case or long state, zero gallons, or a void with no reason is refused.
//
// Run: node supabase/tests/ifta-fuel-receipts.test.mjs
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
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const TRUCK = (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,'512',150) returning id`, [ORG])).id;
const SHA = "a".repeat(64);
const UPLOAD = (await one(
  `insert into ifta_fuel_receipt_uploads (org_id, file_name, file_sha256, format, rows_in_file, rows_imported, rows_already_present, rows_refused)
   values ($1,'IFTA Report_report.csv',$2,'fuel_app_csv',40,40,0,0) returning id`, [ORG, SHA])).id;

const receipt = (fp, over = {}) => {
  const r = { vehicle: TRUCK, state: "OK", gallons: 75.595, ...over };
  return sqlstate(
    `insert into ifta_fuel_receipts (org_id, upload_id, vehicle_id, truck_basis, jurisdiction, fueled_on, gallons, fingerprint, raw)
     values ($1,$2,$3,'driver_assignment',$4,'2026-09-26',$5,$6,'{}'::jsonb)`,
    [ORG, UPLOAD, r.vehicle, r.state, r.gallons, fp],
  );
};

ok("a receipt lands", (await receipt("fuel_app:T466756665132")) === null);
ok("the same row uploaded again is refused while the first is live (one live row per fingerprint)",
  (await receipt("fuel_app:T466756665132")) === "23505");
ok("gallons keep the file's third decimal",
  Number((await one(`select gallons from ifta_fuel_receipts where fingerprint = 'fuel_app:T466756665132'`)).gallons) === 75.595);

ok("a receipt with no truck is refused", (await receipt("nt", { vehicle: null })) === "23502");
ok("a lower-case state is refused", (await receipt("lc", { state: "ok" })) === "23514");
ok("a state name instead of a code is refused", (await receipt("long", { state: "Oklahoma" })) === "23514");
ok("zero gallons are refused (a credit for nothing)", (await receipt("zero", { gallons: 0 })) === "23514");

ok("editing gallons is refused (append-only)",
  (await sqlstate(`update ifta_fuel_receipts set gallons = 80 where fingerprint = 'fuel_app:T466756665132'`)) === "IF012");
ok("voiding while also editing gallons is refused",
  (await sqlstate(`update ifta_fuel_receipts set gallons = 80, voided_at = now(), void_reason = 'x' where fingerprint = 'fuel_app:T466756665132'`)) === "IF012");
ok("a void with no reason is refused",
  (await sqlstate(`update ifta_fuel_receipts set voided_at = now() where fingerprint = 'fuel_app:T466756665132'`)) === "23514");
ok("deleting a receipt is refused",
  (await sqlstate(`delete from ifta_fuel_receipts where fingerprint = 'fuel_app:T466756665132'`)) === "IF010");

ok("voiding a receipt is the one change allowed",
  (await sqlstate(`update ifta_fuel_receipts set voided_at = now(), void_reason = 'wrong truck' where fingerprint = 'fuel_app:T466756665132'`)) === null);
ok("a void row cannot be voided again or un-voided",
  (await sqlstate(`update ifta_fuel_receipts set voided_at = null, void_reason = null where fingerprint = 'fuel_app:T466756665132'`)) === "IF011");
ok("a voided row frees its fingerprint, so the corrected file lands",
  (await receipt("fuel_app:T466756665132")) === null &&
  (await one(`select count(*)::int n from ifta_fuel_receipts where fingerprint = 'fuel_app:T466756665132'`)).n === 2);

ok("an upload's counts cannot be edited",
  (await sqlstate(`update ifta_fuel_receipt_uploads set rows_imported = 1 where id = $1`, [UPLOAD])) === "IF012");
ok("an upload with receipts cannot be deleted",
  (await sqlstate(`delete from ifta_fuel_receipt_uploads where id = $1`, [UPLOAD])) === "IF010");
ok("an upload can be voided, once",
  (await sqlstate(`update ifta_fuel_receipt_uploads set voided_at = now(), void_reason = 'wrong file' where id = $1`, [UPLOAD])) === null);
ok("an unknown file format is refused",
  (await sqlstate(`insert into ifta_fuel_receipt_uploads (org_id, file_name, file_sha256, format, rows_in_file, rows_imported, rows_already_present, rows_refused)
     values ($1,'x.pdf',$2,'pdf',0,0,0,0)`, [ORG, SHA])) === "23514");
ok("a malformed file hash is refused",
  (await sqlstate(`insert into ifta_fuel_receipt_uploads (org_id, file_name, file_sha256, format, rows_in_file, rows_imported, rows_already_present, rows_refused)
     values ($1,'x.csv','abc','fuel_app_csv',0,0,0,0)`, [ORG])) === "23514");
// Read from the catalog rather than by attempting a delete: other guards on `vehicles` refuse a delete
// before the foreign key is consulted, so a refused delete would prove nothing about THIS table.
ok("a truck with tax evidence cannot be deleted out from under it (vehicle_id is ON DELETE RESTRICT)",
  (await one(`select confdeltype from pg_constraint where conrelid = 'ifta_fuel_receipts'::regclass
     and contype = 'f' and confrelid = 'vehicles'::regclass`)).confdeltype === "r");

for (const t of ["ifta_fuel_receipt_uploads", "ifta_fuel_receipts"]) {
  ok(`${t}: row level security is on, with no client policy (service-role only)`,
    (await one(`select relrowsecurity r from pg_class where relname = $1`, [t])).r === true &&
    (await one(`select count(*)::int n from pg_policies where tablename = $1`, [t])).n === 0);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
