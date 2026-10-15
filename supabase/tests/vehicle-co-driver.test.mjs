// FuelGuard — migration 0475, the second driver of a team truck (seats audit, 2026-10-15).
//
// Every migration before 0475 is applied, team truck 729 is seeded with Leroy Feagin in its one seat,
// then the subject runs. What must hold afterwards:
//
//   1. The column exists, is a nullable uuid, and is null on every existing row.
//   2. The seat sync (a service-role write) can set it without claiming the row from McLeod.
//   3. It must name a real driver, and clears on delete like assigned_driver_id.
//   4. A driver merge clears it instead of failing or carrying a stale placement (exempt from
//      roster's move list; check-driver-references says why).
//
// Run: node supabase/tests/vehicle-co-driver.test.mjs

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
const SUBJECT = "0475_vehicle_co_driver.sql";
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
    owner uuid, owner_id text,
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
const driver = async (name) =>
  (await one(`insert into drivers (org_id, full_name, status) values ($1, $2, 'active') returning id`, [ORG, name])).id;
const SITAL = await driver("CHRISTOPHER SITAL");
const FEAGIN = await driver("LEROY FEAGIN");
await db.query(
  `insert into vehicles (org_id, unit_number, vin, tank_capacity_gal, identity_source, assigned_driver_id)
   values ($1, '729', '3AKJHHDR5MSMS0729', 240, 'mcleod', $2)`,
  [ORG, FEAGIN],
);
const row = () => one(`select * from vehicles where org_id = $1 and unit_number = '729'`, [ORG]);

// ═══ apply the subject ═════════════════════════════════════════════════════════════════════════
await db.exec(read(join("migrations", SUBJECT)));

const col = await one(
  `select data_type, is_nullable from information_schema.columns where table_name = 'vehicles' and column_name = 'co_driver_id'`,
);
ok("vehicles.co_driver_id exists as nullable uuid", col?.data_type === "uuid" && col?.is_nullable === "YES", JSON.stringify(col));
ok("the migration fills nothing: existing rows read null", (await row()).co_driver_id === null);

// ── the seat sync (service role) writes the teammate without claiming the row ───────────────────
await db.query(`update vehicles set co_driver_id = $2 where org_id = $1 and unit_number = '729'`, [ORG, SITAL]);
let r = await row();
ok("a sync write sets the teammate and leaves the row McLeod's", r.co_driver_id === SITAL && r.identity_source === "mcleod" && r.assigned_driver_id === FEAGIN);

// ── it points at a driver, and a deleted driver clears it rather than blocking ─────────────────
let refused = false;
try {
  await db.query(`update vehicles set co_driver_id = gen_random_uuid() where org_id = $1 and unit_number = '729'`, [ORG]);
} catch {
  refused = true;
}
ok("a co-driver that is not a driver is refused", refused);

// ── a merge clears it (exempt from the move list) and leaves the truck's seat alone ──────────────
const DUP = await driver("SITAL, CHRISTOPHER");
await db.query(`update vehicles set co_driver_id = $2 where org_id = $1 and unit_number = '729'`, [ORG, DUP]);
await db.query(`select public.merge_driver_v2($1, $2, $3, '[]'::jsonb)`, [ORG, DUP, SITAL]);
r = await row();
ok("a merge clears the duplicate's co-driver seat for the next sync to refill", r.co_driver_id === null && r.assigned_driver_id === FEAGIN, JSON.stringify({ co: r.co_driver_id, a: r.assigned_driver_id }));

const fk = await one(
  `select confdeltype from pg_constraint where conrelid = 'public.vehicles'::regclass and contype = 'f'
     and conkey = array[(select attnum from pg_attribute where attrelid = 'public.vehicles'::regclass and attname = 'co_driver_id')]`,
);
ok("the foreign key clears on delete, as assigned_driver_id's does", fk?.confdeltype === "n", JSON.stringify(fk));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
