// FuelGuard — the audit trigger records changes, not measurements (migration 0352, D-LIFE4/Q5(a)).
//
// `audit_logs` is 10.2 GB/year and is the one table retention may never touch (RETENTION_FORBIDDEN:
// pruning it is evidence destruction). 97% of it was `vehicle.update` — 20.2 rows per vehicle per
// hour, 272 of 272 vehicles, zero inserts or deletes in a week — because `vehicles` and `drivers`
// carry live telemetry beside identity, and `audit_row_change` could not tell the two apart.
//
// This matrix exists because every way of getting 0352 wrong is SILENT. A filter that is slightly too
// wide stops recording a VIN change and nobody finds out until an auditor asks; a filter that never
// fires leaves the 10 GB/year in place while looking like a fix. Neither shows up as an error.
//
//   1. TELEMETRY IS NOT AUDITED. The rows this migration exists to stop.
//   2. IDENTITY AND COMPLIANCE STILL ARE — including when a MACHINE writes them. The tempting rule
//      ("ignore what the sync writes") would have silenced `vin`, `plate`, `unit_number` and
//      `cdl_number`, all of which the Samsara syncs write. A VIN changing by itself is exactly the
//      event this ledger is for.
//   3. A MIXED UPDATE AUDITS. Telemetry travelling in the same statement as a real change must not
//      launder it.
//   4. INSERT AND DELETE ARE NEVER FILTERED.
//   5. THE `updated_at` TRAP. `set_updated_at()` is a BEFORE UPDATE trigger setting `updated_at =
//      now()` unconditionally, so a guard comparing whole rows can NEVER fire. If `updated_at` ever
//      leaves the ignore list this matrix goes red rather than the fix silently becoming a no-op.
//   6. THE ADMIN IDLE FLAGS STAY AUDITED. `has_apu` / `has_optimized_idle` / `apu_type` sit among ~30
//      machine-derived `idle_*` columns and grant idle avoidability to a truck. Who set one and when
//      is a real question, so they must not be swept up by an `idle_%` pattern.
//
// Applies EVERY migration, same as rls.test.mjs, so the trigger under test is the one production runs.
//
// Run:  node supabase/tests/audit-telemetry-ignored.test.mjs
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
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;

/** Audit rows for one entity, newest first — the whole assertion surface of this matrix. */
const auditCount = async (entityId, action) =>
  Number(
    (await one(`select count(*)::int as n from audit_logs where entity_id = $1 and action = $2`, [entityId, action])).n,
  );

/** Run an update and return how many audit rows it produced. Counting the DELTA rather than the total
 *  is what lets each case below stand alone regardless of what ran before it. */
const updateAndCount = async (table, entity, id, sql, params) => {
  const before = await auditCount(id, `${entity}.update`);
  await db.query(`update ${table} set ${sql} where id = $1`, [id, ...params]);
  return (await auditCount(id, `${entity}.update`)) - before;
};

const TRUCK = (
  await one(`insert into vehicles (org_id, unit_number, vin, tank_capacity_gal) values ($1,'754','1FUJGLD59HLJS1234',150) returning id`, [ORG])
).id;
const DRIVER = (await one(`insert into drivers (org_id, full_name) values ($1,'A Driver') returning id`, [ORG])).id;

// ── 1. telemetry is not audited ──────────────────────────────────────────────────────────────────
ok("odometer change writes no audit row", (await updateAndCount("vehicles", "vehicle", TRUCK, "current_odometer = $2", [123456])) === 0);
ok(
  "fuel level + its timestamp write no audit row",
  (await updateAndCount("vehicles", "vehicle", TRUCK, "samsara_fuel_percent = $2, samsara_fuel_at = now()", [61])) === 0,
);
ok(
  "learned tank calibration writes no audit row",
  (await updateAndCount("vehicles", "vehicle", TRUCK, "observed_max_fill_gal = $2, tank_capacity_source = $3", [148.2, "observed"])) === 0,
);
ok(
  "derived idle evidence writes no audit row",
  (await updateAndCount("vehicles", "vehicle", TRUCK, "idle_capability = $2, idle_evidence_status = $3", ["apu", "sufficient"])) === 0,
);
ok(
  "driver HOS position writes no audit row",
  (await updateAndCount("drivers", "driver", DRIVER, "current_hos_status = $2, current_location = $3", ["driving", "Joliet, IL"])) === 0,
);

// ── 2. identity and compliance still audit — including when a machine writes them ────────────────
ok("VIN change audits", (await updateAndCount("vehicles", "vehicle", TRUCK, "vin = $2", ["1FUJGLD59HLJS9999"])) === 1);
ok("unit number change audits", (await updateAndCount("vehicles", "vehicle", TRUCK, "unit_number = $2", ["755"])) === 1);
ok("plate change audits", (await updateAndCount("vehicles", "vehicle", TRUCK, "plate = $2", ["IL-99999"])) === 1);
ok(
  "annual inspection expiry audits (§396.17)",
  (await updateAndCount("vehicles", "vehicle", TRUCK, "dot_annual_inspection_expires_at = $2", ["2027-01-31"])) === 1,
);
ok("CDL number change audits", (await updateAndCount("drivers", "driver", DRIVER, "cdl_number = $2", ["D123-4567"])) === 1);
ok(
  "medical card expiry audits",
  (await updateAndCount("drivers", "driver", DRIVER, "medical_card_expires_at = $2", ["2027-06-30"])) === 1,
);

// ── 3. a mixed update audits — telemetry must not launder a real change ──────────────────────────
ok(
  "odometer + VIN in one statement still audits",
  (await updateAndCount("vehicles", "vehicle", TRUCK, "current_odometer = $2, vin = $3", [222222, "1FUJGLD59HLJS0001"])) === 1,
);

// ── 4. insert and delete are never filtered ──────────────────────────────────────────────────────
const TRUCK2 = (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,'800',150) returning id`, [ORG])).id;
ok("insert audits", (await auditCount(TRUCK2, "vehicle.insert")) === 1);
await db.query(`delete from vehicles where id = $1`, [TRUCK2]);
ok("delete audits", (await auditCount(TRUCK2, "vehicle.delete")) === 1);

// ── 5. the updated_at trap ───────────────────────────────────────────────────────────────────────
// A whole-row comparison cannot work here: set_updated_at() bumps updated_at on EVERY update, before
// this trigger sees the row. If updated_at leaves the ignore list, case 1 goes red — this case pins
// the mechanism directly so the reason is legible rather than inferred from five other failures.
const IGNORED = (
  await one(`
    select string_agg(t.tgargs_text, '|') as args from (
      select encode(tgargs, 'escape') as tgargs_text from pg_trigger
      where tgname in ('audit_vehicles','audit_drivers')
    ) t`)
).args;
ok("updated_at is in both ignore lists", (IGNORED.match(/updated_at/g) ?? []).length === 2, IGNORED);

// ── 6. the admin idle flags are NOT swept up with the derived idle_* family ──────────────────────
ok(
  "has_apu change audits — it grants avoidability and is admin-set",
  (await updateAndCount("vehicles", "vehicle", TRUCK, "has_apu = $2", [true])) === 1,
);
ok(
  "has_optimized_idle change audits",
  (await updateAndCount("vehicles", "vehicle", TRUCK, "has_optimized_idle = $2", [true])) === 1,
);
ok("apu_type change audits", (await updateAndCount("vehicles", "vehicle", TRUCK, "apu_type = $2", ["diesel"])) === 1);
ok(
  "none of the three admin flags appears in the vehicles ignore list",
  !/has_apu|has_optimized_idle|apu_type/.test(IGNORED),
  IGNORED,
);

// ── 7. a no-op update produces nothing, and the row still exists ─────────────────────────────────
ok(
  "setting a telemetry column to its current value audits nothing",
  (await updateAndCount("vehicles", "vehicle", TRUCK, "current_odometer = current_odometer", [])) === 0,
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
