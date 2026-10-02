// FuelGuard — migration 0401, the Samsara vehicle record's name kept on the truck (FUEL-SAVINGS-AND-
// IDLE-ENGINE-PLAN.md FL2, Q-FL8).
//
// Every migration before 0401 is applied, a truck the McLeod sweep owns is seeded, then the subject
// runs. What must hold afterwards:
//
//   1. The column exists, is text and nullable, and is null on every existing row ("Samsara has not
//      said") — the migration fills nothing.
//   2. The vehicle sync (a service-role write) can set it without changing who owns the row or any
//      derived identity field.
//   3. It is NOT identity: an office user editing only the name does not claim the row, so McLeod
//      keeps refreshing it (0241's list is untouched).
//   4. A rename is audited — a truck being renamed `- SOLD` leaves a trace — and re-sending the same
//      name writes nothing.
//
// Run: node supabase/tests/vehicle-samsara-name.test.mjs

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const ALL = readdirSync(join(SUPA, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const SUBJECT = "0401_vehicle_samsara_name.sql";
const BEFORE = ALL.filter((f) => f < SUBJECT);

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
const num = async (q, p = []) => Number((await one(q, p)).n);

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
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$
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

for (const f of BEFORE) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
await db.query(
  `insert into vehicles (org_id, unit_number, vin, make, model, tank_capacity_gal, identity_source, samsara_vehicle_id)
   values ($1, '568', '3AKJHHDR5MSMS9642', 'FRHT', 'CA', 240, 'mcleod', '281475006145500')`,
  [ORG],
);
const row = () => one(`select * from vehicles where org_id = $1 and unit_number = '568'`, [ORG]);
const audits = () =>
  num(`select count(*) n from audit_logs where org_id = $1 and action = 'vehicle.update'`, [ORG]);

// ═══ apply the subject ═════════════════════════════════════════════════════════════════════════
await db.exec(read(join("migrations", SUBJECT)));

const col = await one(
  `select data_type, is_nullable from information_schema.columns where table_name = 'vehicles' and column_name = 'samsara_name'`,
);
ok("vehicles.samsara_name exists as nullable text", col?.data_type === "text" && col?.is_nullable === "YES", JSON.stringify(col));
ok("the migration fills nothing: existing rows read null", (await row()).samsara_name === null);

// ── the vehicle sync writes the name (service role: no JWT claims) ──────────────────────────────
const auditsBefore = await audits();
await db.query(`update vehicles set samsara_name = '568 - SOLD' where org_id = $1 and unit_number = '568'`, [ORG]);
let r = await row();
ok(
  "a sync write sets the name and changes neither owner nor derived identity",
  r.samsara_name === "568 - SOLD" && r.identity_source === "mcleod" && r.make === "Freightliner" && r.model === "Cascadia",
  JSON.stringify({ n: r.samsara_name, s: r.identity_source, make: r.make, model: r.model }),
);
ok("a rename is audited", (await audits()) === auditsBefore + 1, `audits ${auditsBefore} → ${await audits()}`);
await db.query(`update vehicles set samsara_name = '568 - SOLD' where org_id = $1 and unit_number = '568'`, [ORG]);
ok("re-sending the same name writes no audit row", (await audits()) === auditsBefore + 1);

// ── an office user edits only the name through the browser JWT ──────────────────────────────────
await db.exec("begin");
await db.query("select set_config('request.jwt.claims', $1, true)", [
  JSON.stringify({ role: "authenticated", org_id: ORG, user_role: "admin" }),
]);
await db.query(`update vehicles set samsara_name = '568' where org_id = $1 and unit_number = '568'`, [ORG]);
r = await row();
await db.exec("rollback");
ok("editing only the Samsara name is not an identity edit: the row stays McLeod's", r.samsara_name === "568" && r.identity_source === "mcleod");

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
