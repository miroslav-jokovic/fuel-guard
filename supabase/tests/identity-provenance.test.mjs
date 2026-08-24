// FuelGuard — identity provenance matrix (migration 0241).
//
// D-MR6 lets the carrier's TMS refresh the licence, plate and registration fields on every sweep. The
// only thing standing between that and an office edit being silently reverted is `identity_source`,
// and before 0241 it did not work on any of the three paths that actually write:
//
//   · the column DEFAULTS to 'samsara', so every hand-created row claimed telematics provenance
//     (production: 194 vehicles and 211 trailers, all 'samsara', not one 'manual');
//   · `apps/web` writes vehicles and trailers straight through PostgREST, where nothing ever set it;
//   · `DriversPage.vue` does the same for drivers via `useUpdateDriver`, bypassing resolveDriverUpdate.
//
// So the rows below are all about ONE question: after this write, who owns the row? The service-role
// cases matter as much as the office ones — a trigger that claimed rows for the syncs would freeze
// the entire roster on its first sweep.
//
// Applies EVERY migration, like its siblings, so the function under test is the one production runs.
//
// Run:  node supabase/tests/identity-provenance.test.mjs
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

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text)
  returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
// These tables already carry `audit_row_change()`, whose insert into audit_logs has an FK onto
// auth.users. The office actor has to exist before it can edit anything.
const ACTOR = "11111111-2222-4333-8444-555555555555";
await db.query(`insert into auth.users (id, email) values ($1, 'office@example.test')`, [ACTOR]);

/**
 * One write as a signed-in office user. Only the JWT CLAIMS are set, not the database role: the
 * trigger's decision rests entirely on `auth_role()`, and switching role here would drag every RLS
 * policy on these tables into a test that is not about them.
 */
const asOffice = async (sql, params = []) => {
  await db.exec("begin");
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: ACTOR, org_id: ORG, user_role: "fleet_manager", role: "authenticated" }),
  ]);
  await db.query(sql, params);
  await db.exec("commit");
};
/** One write as the API / a sync: the service role, which carries no JWT claims. */
const asService = (sql, params = []) => db.query(sql, params);

const sourceOf = async (table, id) => (await one(`select identity_source from ${table} where id = $1`, [id])).identity_source;

// `uq_drivers_org_mcleod` is real and partial, so every fixture needs its own McLeod id.
let seq = 0;
const newDriver = async (src = "mcleod") =>
  (await one(`insert into drivers (org_id, full_name, identity_source, status, cdl_number, mcleod_driver_id)
              values ($1,'Angel Cora',$2,'active',$3,$4) returning id`,
             [ORG, src, `X${++seq}`, `D${String(seq).padStart(4, "0")}`])).id;
const newVehicle = async (src = "mcleod", unit = "104") =>
  (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal, identity_source, plate, mcleod_tractor_id)
              values ($1,$2,150,$3,'ABC123',$2) returning id`, [ORG, unit, src])).id;
const newTrailer = async (src = "mcleod", unit = "R532159") =>
  (await one(`insert into trailers (org_id, unit_number, reefer_tank_capacity_gal, identity_source, is_reefer, mcleod_trailer_id)
              values ($1,$2,50,$3,true,$2) returning id`, [ORG, unit, src])).id;

// ── 1. The office edit claims the row ────────────────────────────────────────────────────────────
{
  const d = await newDriver();
  await asOffice(`update drivers set full_name = 'Angel Cora Jr' where id = $1`, [d]);
  ok("a name corrected through PostgREST claims the driver for the office", (await sourceOf("drivers", d)) === "manual");

  const v = await newVehicle();
  await asOffice(`update vehicles set plate = 'NEW999' where id = $1`, [v]);
  ok("a plate corrected on a vehicle claims it — the path that had no claim at all", (await sourceOf("vehicles", v)) === "manual");

  const t = await newTrailer();
  await asOffice(`update trailers set is_reefer = false where id = $1`, [t]);
  ok("re-typing a trailer claims it, so McLeod's trailer_type stops overruling the correction", (await sourceOf("trailers", t)) === "manual");
}

// ── 2. The syncs are untouched, which is the half that must not break ────────────────────────────
{
  const d = await newDriver();
  await asService(`update drivers set full_name = 'ANGEL CORA' where id = $1`, [d]);
  ok("the McLeod sweep refreshing a name does NOT claim the driver", (await sourceOf("drivers", d)) === "mcleod");

  const v = await newVehicle("mcleod", "105");
  await asService(`update vehicles set plate = 'MCL111' where id = $1`, [v]);
  ok("the McLeod sweep refreshing a plate does NOT claim the vehicle", (await sourceOf("vehicles", v)) === "mcleod");
}

// ── 3. What is NOT an identity edit ──────────────────────────────────────────────────────────────
{
  const d = await newDriver();
  await asOffice(`update drivers set cdl_number = 'CORRECTED' where id = $1`, [d]);
  ok(
    "correcting a LICENCE does not claim the row — D-MR6 decided that reverts, and the trigger must not overturn it",
    (await sourceOf("drivers", d)) === "mcleod",
  );

  const v = await newVehicle("mcleod", "106");
  await asOffice(`update vehicles set status = 'retired' where id = $1`, [v]);
  ok("retiring a truck is a lifecycle act, not an identity correction", (await sourceOf("vehicles", v)) === "mcleod");

  const v2 = await newVehicle("mcleod", "107");
  await asOffice(`update vehicles set tank_capacity_gal = 200 where id = $1`, [v2]);
  ok("tank capacity is learned, not roster identity — editing it leaves McLeod in charge", (await sourceOf("vehicles", v2)) === "mcleod");
}

// ── 4. Creation ──────────────────────────────────────────────────────────────────────────────────
{
  const v = (await one(
    `insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,'201',150) returning id`, [ORG],
  )).id;
  ok("a sync-created vehicle keeps the 'samsara' default — the three Samsara syncs insert without naming the column",
     (await sourceOf("vehicles", v)) === "samsara");

  let officeId;
  await asOffice(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,'202',150)`, [ORG]);
  officeId = (await one(`select id from vehicles where unit_number = '202'`)).id;
  ok("a vehicle a person typed is 'manual', not the 'samsara' the default would have given it",
     (await sourceOf("vehicles", officeId)) === "manual");

  await asOffice(
    `insert into vehicles (org_id, unit_number, tank_capacity_gal, identity_source) values ($1,'203',150,'mcleod')`, [ORG],
  );
  const spoofed = (await one(`select id from vehicles where unit_number = '203'`)).id;
  ok("a client cannot assert TMS provenance for a row the TMS has never seen",
     (await sourceOf("vehicles", spoofed)) === "manual");
}

// ── 5. The un-claim path stays open ──────────────────────────────────────────────────────────────
{
  const v = await newVehicle("manual", "301");
  await asOffice(`update vehicles set identity_source = 'mcleod', plate = 'HANDBACK' where id = $1`, [v]);
  ok("handing a corrected row back to McLeod is respected — otherwise a claim would be permanent",
     (await sourceOf("vehicles", v)) === "mcleod");

  const v2 = await newVehicle("manual", "302");
  await asOffice(`update vehicles set plate = 'STILLMINE' where id = $1`, [v2]);
  ok("editing an already-claimed row is a no-op for provenance", (await sourceOf("vehicles", v2)) === "manual");
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
