// FuelGuard — migration 0403, a truck's idle equipment declared with its source and its long-park
// behaviour measured beside it (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md IE1, D-IE7, R7, Q-IE1).
//
// Every migration before 0403 is applied, the carrier's organisation is seeded with one truck per
// branch of the ruling (as production stood 2026-10-02), then the subject runs. What must hold:
//
//   1. The ruling: 723–753 and every MY 2027 truck → battery APU, Optimized Idle kept only where it
//      was already true; 500–635, 637–711, 718, 727, 769–783 → none/false/false, even where battery
//      was entered (769–783). Source `owner_ruling_2026-10-01`, one summary audit row with the counts.
//   2. Left alone: 719–722 (Q-IE5), on-order rows with no model year (Q-IE6), `- OLD` record rows,
//      another organisation's trucks. A value entered before 0403 and not ruled keeps its value and
//      is named `manual`.
//   3. The stamp: an equipment edit that does not name its source becomes `manual`; one that does
//      keeps it; an edit of any other column leaves the source alone.
//   4. The measurement counts long parks, mostly-running and mostly-off parks per truck, inside the
//      window and the org only, and is callable by the service role alone.
//
// Run: node supabase/tests/vehicle-equipment-declared.test.mjs

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
const SUBJECT = "0403_vehicle_equipment_declared.sql";
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

const ORG = "86d6b3ea-4361-4f71-877f-e8373615769b";
await db.query(`insert into organizations (id, name) values ($1, 'Silvicom')`, [ORG]);
const OTHER = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Other') returning id`)).id;

// unit, year, status, has_apu, apu_type, has_optimized_idle — as entered before 0403.
const SEED = [
  ["506", 2020, "active", false, "none", false],
  ["654", 2024, "active", null, null, null],
  ["652", 2023, "active", false, "none", true], // Optimized Idle entered on a ruled no-OI truck
  ["595", 2021, "retired", null, null, null], // a sold truck is still ruled
  ["712", 2025, "active", false, "none", false], // §1.6 "entered none → keep"
  ["719", 2025, "active", false, "none", false], // Q-IE5
  ["722", 2025, "active", null, null, null], // Q-IE5
  ["723", 2025, "active", false, "none", true], // battery; OI entered true → kept
  ["728", 2026, "active", null, null, null],
  ["754", 2020, "active", true, "battery_hvac", true], // not ruled, entered → manual
  ["764", 2027, "active", null, null, null], // MY 2027 by year
  ["775", 2026, "active", true, "battery_hvac", true], // ruled no APU over an entered battery
  ["790", 2027, "active", null, null, null],
  ["805", 2027, "ordered", null, null, null], // on order WITH a model year → battery
  ["830", null, "ordered", null, null, null], // Q-IE6
  ["751 - OLD", 2026, "retired", null, null, null],
];
for (const [unit, year, status, apu, type, oi] of SEED) {
  await db.query(
    `insert into vehicles (org_id, unit_number, year, status, has_apu, apu_type, has_optimized_idle, tank_capacity_gal)
     values ($1, $2, $3, $4::vehicle_status, $5, $6, $7, 200)`,
    [ORG, unit, year, status, apu, type, oi],
  );
}
await db.query(`insert into vehicles (org_id, unit_number, year, tank_capacity_gal) values ($1, '506', 2020, 200)`, [OTHER]);

// ═══ apply the subject ═════════════════════════════════════════════════════════════════════════
await db.exec(read(join("migrations", SUBJECT)));

const eq = async (unit, org = ORG) =>
  one(
    `select has_apu, apu_type, has_optimized_idle oi, equipment_source src from vehicles where org_id = $1 and unit_number = $2`,
    [org, unit],
  );
const is = (r, apu, type, oi, src) => r.has_apu === apu && r.apu_type === type && r.oi === oi && r.src === src;
const RULED = "owner_ruling_2026-10-01";

// ── 1. the ruling ──────────────────────────────────────────────────────────────────────────────
for (const u of ["728", "764", "790", "805"]) {
  ok(`${u} is declared battery APU without Optimized Idle`, is(await eq(u), true, "battery_hvac", false, RULED), JSON.stringify(await eq(u)));
}
ok("723 keeps the Optimized Idle entered on it, now a battery-APU truck", is(await eq("723"), true, "battery_hvac", true, RULED), JSON.stringify(await eq("723")));
for (const u of ["506", "654", "652", "595", "775"]) {
  ok(`${u} is declared no APU, no Optimized Idle`, is(await eq(u), false, "none", false, RULED), JSON.stringify(await eq(u)));
}
const summary = await one(`select * from audit_logs where action = 'roster.vehicle_equipment_declared'`);
ok(
  "one summary audit row carries the counts",
  summary?.org_id === ORG && summary.meta.battery_apu === 5 && summary.meta.no_apu_no_oi === 5 && summary.meta.entered_kept_as_manual === 3,
  JSON.stringify(summary?.meta),
);
ok(
  "the summary row keeps every value it replaced, and only those",
  JSON.stringify(summary?.meta.replaced?.["775"]) === JSON.stringify({ has_apu: true, apu_type: "battery_hvac", has_optimized_idle: true }) &&
    JSON.stringify(summary?.meta.replaced?.["654"]) === JSON.stringify({ has_apu: null, apu_type: null, has_optimized_idle: null }) &&
    !("506" in (summary?.meta.replaced ?? {})) && !("712" in (summary?.meta.replaced ?? {})),
  JSON.stringify(summary?.meta.replaced),
);

// ── 2. left alone ──────────────────────────────────────────────────────────────────────────────
ok("712, entered and not ruled, keeps its value as manual", is(await eq("712"), false, "none", false, "manual"));
ok("754, entered and not ruled, keeps its battery APU as manual", is(await eq("754"), true, "battery_hvac", true, "manual"));
ok("719 keeps what is entered (Q-IE5)", is(await eq("719"), false, "none", false, "manual"));
ok("722 stays undeclared (Q-IE5)", is(await eq("722"), null, null, null, null));
ok("830, on order with no model year, stays undeclared (Q-IE6)", is(await eq("830"), null, null, null, null));
ok("a `- OLD` record row is not the truck and is untouched", is(await eq("751 - OLD"), null, null, null, null));
ok("another organisation's 506 is untouched", is(await eq("506", OTHER), null, null, null, null));

// ── 3. the stamp ───────────────────────────────────────────────────────────────────────────────
await db.query(`update vehicles set has_apu = true, apu_type = 'battery_hvac' where org_id = $1 and unit_number = '506'`, [ORG]);
ok("an equipment edit that names no source is a manual edit", (await eq("506")).src === "manual");
await db.query(`update vehicles set apu_type = 'none', equipment_source = $2 where org_id = $1 and unit_number = '506'`, [ORG, RULED]);
ok("an equipment edit that names its source keeps it", (await eq("506")).src === RULED);
await db.query(`update vehicles set plate = 'X1' where org_id = $1 and unit_number = '654'`, [ORG]);
ok("editing another column leaves the source alone", (await eq("654")).src === RULED);
await db.query(`update vehicles set has_optimized_idle = false where org_id = $1 and unit_number = '654'`, [ORG]);
ok("re-saving the same equipment value is not an edit", (await eq("654")).src === RULED);
await db.query(`insert into vehicles (org_id, unit_number, has_apu, tank_capacity_gal) values ($1, '999', false, 200)`, [ORG]);
ok("a new truck created with equipment is manual", (await eq("999")).src === "manual");
await db.query(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1, '998', 200)`, [ORG]);
ok("a new truck created without equipment declares nothing", (await eq("998")).src === null);

// ── 4. the measurement ─────────────────────────────────────────────────────────────────────────
const vid = async (unit, org = ORG) => (await one(`select id from vehicles where org_id = $1 and unit_number = $2`, [org, unit])).id;
const park = (org, v, at, dur, idle) =>
  db.query(
    `insert into idle_park_sessions (org_id, vehicle_id, started_at, ended_at, duration_sec, idle_sec, off_sec, mode)
     values ($1, $2, $3::timestamptz, $3::timestamptz + make_interval(secs => $4::int), $4::int, $5::int, $4::int - $5::int, 'unknown')`,
    [org, v, at, dur, Math.round(idle)],
  );
const H4 = 14400;
const v719 = await vid("719");
await park(ORG, v719, "2026-09-01T00:00Z", H4, H4 * 0.9); // mostly running
await park(ORG, v719, "2026-09-02T00:00Z", H4, H4 * 0.1); // mostly off
await park(ORG, v719, "2026-09-03T00:00Z", H4, H4 * 0.5); // neither
await park(ORG, v719, "2026-09-04T00:00Z", H4 - 1, 0); // too short
await park(ORG, v719, "2026-07-01T00:00Z", H4, 0); // before the window
await park(OTHER, await vid("506", OTHER), "2026-09-01T00:00Z", H4, 0); // another org
const behaviour = (await db.query(
  `select * from vehicle_long_park_behaviour($1, '2026-08-15', '2026-10-01', 14400, 0.8, 0.2)`,
  [ORG],
)).rows;
ok(
  "the measurement counts long parks in the window, mostly running and mostly off",
  behaviour.length === 1 && behaviour[0].vehicle_id === v719 && behaviour[0].parks === 3 && behaviour[0].idling_parks === 1 && behaviour[0].off_parks === 1,
  JSON.stringify(behaviour),
);
const grants = await one(`
  select has_function_privilege('authenticated', p.oid, 'execute') auth,
         has_function_privilege('anon', p.oid, 'execute') anon,
         has_function_privilege('service_role', p.oid, 'execute') svc
    from pg_proc p where p.proname = 'vehicle_long_park_behaviour'`);
ok("the measurement is callable by the service role only", grants.svc === true && grants.auth === false && grants.anon === false, JSON.stringify(grants));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
