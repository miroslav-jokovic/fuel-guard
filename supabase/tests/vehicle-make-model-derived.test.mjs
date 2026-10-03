// FuelGuard — migration 0399, a truck's make and model are derived from one catalogue (FUEL-SAVINGS-AND-
// IDLE-ENGINE-PLAN.md FL1, D-FL1, Q-FL3).
//
// The migration rewrites make/model on every vehicle in production and installs a trigger that every
// later write passes through, so it is run here first: every migration before 0399 is applied, the
// spellings measured on 2026-10-01 are seeded, and then the subject runs. What must hold afterwards:
//
//   1. Every spelling of one make or model reads as one value, and the spelling stays in *_reported.
//   2. The VIN wins: 787's Samsara `LT625` on a Freightliner Cascadia VIN reads Cascadia, and an
//      ordered unit with only a VIN gets a make and model.
//   3. Nothing uncatalogued is blanked: an unknown spelling and a truck with nothing stay as they are.
//   4. The next sweep re-sending McLeod's spelling changes nothing, and Samsara re-sending `LT625` for
//      787 does not bring the typo back.
//   5. An office edit is still claimed for the office (the claim trigger fires first); a re-save of the
//      stored value is not an edit.
//   6. The catalogue is deny-all to clients, one audit row is written, and a re-run of the backfill
//      changes nothing.
//
// Run: node supabase/tests/vehicle-make-model-derived.test.mjs

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
const SUBJECT = "0399_vehicle_make_model_derived.sql";
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
const ins = async (cols) => {
  const keys = Object.keys(cols);
  const ph = keys.map((_, i) => `$${i + 1}`).join(",");
  return one(`insert into vehicles (${keys.join(",")}) values (${ph}) returning *`, Object.values(cols));
};
const truck = (unit, vin, make, model, extra = {}) =>
  ins({ org_id: ORG, unit_number: unit, vin, make, model, tank_capacity_gal: 200, identity_source: "mcleod", ...extra });
const row = (unit) => one(`select * from vehicles where org_id = $1 and unit_number = $2`, [ORG, unit]);

// ── production's spellings, 2026-10-01 ──────────────────────────────────────────────────────────
await truck("506", "3AKJHHDR0LSLL7398", "FRHT", "CA");
await truck("512", "3AKJHHDR1MSMS9601", "FREIGHTLINER", "CA");
await truck("664", "3AKJHHDR9PSNA0001", "FRHT", "CA126SLP");
await truck("764", "3AKJJHDR5TSAA0001", "FRHT", "PJ126");
await truck("787", "3AKJHHDR3VSXJ2106", "FRHT", "LT625");
await truck("712", "3HSDZAPR1RN000712", "INTERNATIONAL", "LT 625");
await truck("632", "3HSDZAPR0NN232816", "INTERNATIONAL", "LT-625", { status: "retired" });
await truck("810", "3HSDZAPR8TN000810", "INTERNATIONAL", "lt625");
await truck("814", "3HSDZAPR4TN000814", null, null, { status: "ordered" });
await truck("567 - OLD", null, "FREIGHTLINER", "CASCADIA", { identity_source: "samsara", status: "retired" });
await truck("733 - OLD", null, "international", "LT-625", { identity_source: "samsara", status: "retired" });
await truck("752", null, "INTERNATIONAL", "LT62F", { identity_source: "samsara", status: "retired" });
await truck("751 - OLD", null, null, null, { identity_source: "samsara", status: "retired" });
await truck("900", "1XKYD49X0XX000900", "KENWORTH", "T680");

// ═══ apply the subject ═════════════════════════════════════════════════════════════════════════
const sub = read(join("migrations", SUBJECT));
await db.exec(sub);

const expect = [
  ["506", "Freightliner", "Cascadia", "FRHT", "CA"],
  ["512", "Freightliner", "Cascadia", "FREIGHTLINER", "CA"],
  ["664", "Freightliner", "Cascadia", "FRHT", "CA126SLP"],
  ["764", "Freightliner", "Cascadia", "FRHT", "PJ126"],
  ["787", "Freightliner", "Cascadia", "FRHT", "LT625"],
  ["712", "International", "LT625", "INTERNATIONAL", "LT 625"],
  ["632", "International", "LT625", "INTERNATIONAL", "LT-625"],
  ["810", "International", "LT625", "INTERNATIONAL", "lt625"],
  ["814", "International", "LT625", null, null],
  ["567 - OLD", "Freightliner", "Cascadia", "FREIGHTLINER", "CASCADIA"],
  ["733 - OLD", "International", "LT625", "international", "LT-625"],
  ["752", "International", "LT62F", "INTERNATIONAL", "LT62F"],
  ["751 - OLD", null, null, null, null],
  ["900", "KENWORTH", "T680", "KENWORTH", "T680"],
];
for (const [unit, make, model, mr, mdr] of expect) {
  const r = await row(unit);
  ok(
    `${unit}: ${make ?? "∅"} ${model ?? "∅"}, reported ${mr ?? "∅"} ${mdr ?? "∅"}`,
    r.make === make && r.model === model && r.make_reported === mr && r.model_reported === mdr,
    JSON.stringify({ make: r.make, model: r.model, make_reported: r.make_reported, model_reported: r.model_reported }),
  );
}
ok("no row changed owner during the backfill", (await num(`select count(*) n from vehicles where identity_source = 'manual'`)) === 0);
ok(
  "one audit row, counting the rows whose stored value now differs from the report",
  (await num(`select count(*) n from audit_logs where action = 'roster.vehicle_make_model_derived'`)) === 1 &&
    Number((await one(`select meta->>'rows_now_differing_from_report' n from audit_logs where action = 'roster.vehicle_make_model_derived'`)).n) === 12,
);

// ── the next McLeod sweep re-sends its spelling; Samsara re-sends the typo ────────────────────────
const before506 = await row("506");
await db.query(`update vehicles set make = 'FRHT', model = 'CA' where unit_number = '506'`);
const after506 = await row("506");
ok("a sweep re-sending FRHT / CA changes nothing", after506.make === "Freightliner" && after506.model === "Cascadia" && after506.make_reported === "FRHT" && before506.make === after506.make);
await db.query(`update vehicles set model = 'LT625' where unit_number = '787'`);
ok("Samsara re-sending LT625 for 787 does not bring the typo back", (await row("787")).model === "Cascadia");
await db.query(`update vehicles set model = 'CA126' where unit_number = '506'`);
ok("a NEW spelling is recorded as the report", (await row("506")).model_reported === "CA126" && (await row("506")).model === "Cascadia");
await db.query(`update vehicles set vin = '3HSDZAPR5TN000900' where unit_number = '900'`);
ok("a VIN change alone re-derives", (await row("900")).make === "International" && (await row("900")).model === "LT625");
const ordered = await ins({ org_id: ORG, unit_number: "815", vin: "3hsdzapr6tn000815", tank_capacity_gal: 0, status: "ordered" });
ok("an insert derives too, and the VIN's case does not matter", ordered.make === "International" && ordered.model === "LT625");

// ── an office user edits through the browser JWT; the claim trigger must still see what they typed ─
async function asOffice(sql) {
  await db.exec("begin");
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "authenticated", org_id: ORG, user_role: "admin" })]);
  await db.query(sql);
  const r = await row("752");
  const r2 = await row("712");
  await db.exec("rollback");
  return { r, r2 };
}
let office = await asOffice(`update vehicles set model = 'LT 62F' where unit_number = '752'`);
ok("an office edit of the model claims the row for the office", office.r.identity_source === "manual" && office.r.model === "LT 62F");
office = await asOffice(`update vehicles set make = 'International', model = 'LT625' where unit_number = '712'`);
ok("re-saving the stored (derived) value is not an edit and claims nothing", office.r2.identity_source === "mcleod" && office.r2.model_reported === "LT 625");
office = await asOffice(`update vehicles set model = 'LT-625' where unit_number = '712'`);
ok(
  "typing another spelling of the stored model IS an edit: claimed, derived back, the typing kept as the report",
  office.r2.identity_source === "manual" && office.r2.model === "LT625" && office.r2.model_reported === "LT-625",
  JSON.stringify(office.r2),
);

// ── the catalogue ───────────────────────────────────────────────────────────────────────────────
ok("RLS is enabled on the catalogue", (await one(`select relrowsecurity r from pg_class where relname = 'vehicle_make_model_catalog'`)).r === true);
ok("…with no policies (deny-all to clients)", (await num(`select count(*) n from pg_policies where tablename = 'vehicle_make_model_catalog'`)) === 0);

// ── a second run of the backfill statements changes nothing ─────────────────────────────────────
const snap = JSON.stringify((await db.query(`select unit_number, make, model, make_reported, model_reported from vehicles order by unit_number`)).rows);
await db.exec(`update public.vehicles set make = make`);
ok("touching every row again changes nothing", JSON.stringify((await db.query(`select unit_number, make, model, make_reported, model_reported from vehicles order by unit_number`)).rows) === snap);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
