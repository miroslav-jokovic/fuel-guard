// FuelGuard — migration 0359, unit 732 is one truck in two rows (FLEET-CENSUS-AND-IDLE-TRUTH-PLAN F4, Q-9).
//
// A data migration against the carrier's production roster, applied by `migrate.yml` on merge with
// nobody watching. It runs once, so this is where it is run first: every migration UP TO 0359 is
// applied, production's two rows and their collisions are seeded in the shapes measured on
// 2026-09-22, and then the subject runs. What must hold afterwards:
//
//   1. One row named `732`, McLeod-linked, carrying the LIVE Samsara device and the VIN — and it is
//      the HISTORY row, so its id, its tank and its fuel evidence never moved.
//   2. The serial-named row is retired, has no link, device or VIN, and nothing references it.
//   3. Each collision is resolved the way the header says: spend-days dropped (derived, rebuilt),
//      engine seconds summed with coverage capped, the later odometer reading kept, the live
//      device's position kept, BOTH devices' IFTA miles kept (0357/0358).
//   4. The office claims nothing: `identity_source` is `mcleod`, not `manual`.
//   5. One audit row names what happened.
//   6. An unrelated truck is untouched, and a second application changes nothing.
//
// Run: node supabase/tests/merge-unit-732.test.mjs

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
const SUBJECT = "0359_merge_unit_732.sql";
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
const H = "de57e742-22bd-4b93-887f-fb538fce4cf1"; // `732`, history row
const N = "698c08f1-4a30-4567-bc67-e20427120ddf"; // `G6AA-5HS-XTC`, McLeod-linked
const OLD_DEVICE = "281474996337444";
const LIVE_DEVICE = "281475005971830";
const VIN = "3HSDZAPR3TN519824";

const ins = async (table, cols) => {
  const keys = Object.keys(cols);
  const ph = keys.map((_, i) => `$${i + 1}`).join(",");
  return one(`insert into ${table} (${keys.join(",")}) values (${ph}) returning *`, Object.values(cols));
};

// ── production's two rows, 2026-09-22 ───────────────────────────────────────────────────────────
await ins("vehicles", {
  id: H, org_id: ORG, unit_number: "732", status: "retired", identity_source: "samsara",
  samsara_vehicle_id: OLD_DEVICE, tank_capacity_gal: 240, baseline_mpg: 7.9, current_odometer: 143453.1,
  idle_capability: "unknown", idle_evidence_status: "insufficient", idle_evidence_sessions: 3,
});
await ins("vehicles", {
  id: N, org_id: ORG, unit_number: "G6AA-5HS-XTC", status: "active", identity_source: "mcleod",
  mcleod_tractor_id: "732", mcleod_company_id: "TMS", vin: VIN, make: "INTERNATIONAL", model: "LT625",
  year: 2026, plate: "P732", plate_state: "IL", dot_annual_inspection_expires_at: "2027-07-13",
  samsara_vehicle_id: LIVE_DEVICE, tank_capacity_gal: 0, current_odometer: 153921.5,
  idle_capability: "apu", idle_evidence_status: "sufficient", idle_evidence_sessions: 86,
});
// An unrelated truck, to prove the fleet is not touched.
const OTHER = (await ins("vehicles", {
  org_id: ORG, unit_number: "579", status: "maintenance", identity_source: "mcleod",
  mcleod_tractor_id: "579", tank_capacity_gal: 200, samsara_vehicle_id: "281475000000001",
})).id;

// ── children: evidence on the history row, telemetry on both, collisions where production has them ─
await ins("fuel_cards", { org_id: ORG, vehicle_id: H, card_ref: "7321" }).catch((e) => {
  throw new Error(`seed fuel_cards: ${e.message}`);
});
const SWAP = "2026-08-24";
// 40,000 + 50,000 s of coverage: two devices overlapping a little around the swap, so the cap engages.
for (const [v, drive, cov] of [[H, 3000, 40000], [N, 5000, 50000]]) {
  await ins("vehicle_engine_days", { org_id: ORG, vehicle_id: v, day: SWAP, drive_sec: drive, idle_sec: 100, off_sec: 200, coverage_sec: cov });
}
await ins("vehicle_engine_days", { org_id: ORG, vehicle_id: N, day: "2026-09-01", drive_sec: 7000, idle_sec: 1, off_sec: 1, coverage_sec: 86400 });
for (const v of [H, N]) await ins("fuel_spend_days", { org_id: ORG, vehicle_id: v, day: "2026-09-01" });
await ins("samsara_odometer_readings", { org_id: ORG, vehicle_id: H, source: "obd", day: SWAP, reading_at: `${SWAP}T09:00:00Z`, meters: 230000000 });
await ins("samsara_odometer_readings", { org_id: ORG, vehicle_id: N, source: "obd", day: SWAP, reading_at: `${SWAP}T20:00:00Z`, meters: 230100000 });
await ins("samsara_odometer_readings", { org_id: ORG, vehicle_id: N, source: "obd", day: "2026-09-01", reading_at: "2026-09-01T20:00:00Z", meters: 240000000 });
const FETCH = (await ins("samsara_ifta_fetches", { org_id: ORG, period_year: 2026, period_month: 8 })).id;
for (const [v, dev, m] of [[H, OLD_DEVICE, 1000], [N, LIVE_DEVICE, 400]]) {
  await ins("samsara_ifta_jurisdiction_miles", {
    org_id: ORG, vehicle_id: v, samsara_vehicle_id: dev, period_year: 2026, period_month: 8,
    jurisdiction: "IL", recognised: true, taxable_meters: m, total_meters: m, tax_paid_liters: 0, fetch_id: FETCH,
  });
}
for (const [v, lat] of [[H, 41.0], [N, 42.5]]) {
  await ins("vehicle_positions", { org_id: ORG, vehicle_id: v, lat, lng: -88.0, sampled_at: "2026-09-22T12:00:00Z" });
}

// ═══ apply the subject ═════════════════════════════════════════════════════════════════════════
const sub = read(join("migrations", SUBJECT));
let applied = null;
try {
  await db.exec(sub);
} catch (e) {
  applied = e.message;
}
ok("0359 applies without raising", applied === null, applied ?? "");

const h = await one(`select * from vehicles where id = $1`, [H]);
const n = await one(`select * from vehicles where id = $1`, [N]);

// 1 — the history row survives, as 732, McLeod-linked, on the live device
ok("the survivor is the history row, still named 732", h.unit_number === "732");
ok("…active, as McLeod reports it", h.status === "active", h.status);
ok("…McLeod-linked", h.mcleod_tractor_id === "732" && h.mcleod_company_id === "TMS");
ok("…carrying the VIN", h.vin === VIN);
ok("…and the LIVE Samsara device, not the pulled one", h.samsara_vehicle_id === LIVE_DEVICE, h.samsara_vehicle_id);
ok("…with the idle learning from the live device", h.idle_capability === "apu" && Number(h.idle_evidence_sessions) === 86);
ok("…keeping its own learned 240-gal tank", Number(h.tank_capacity_gal) === 240, h.tank_capacity_gal);
ok("…and the higher odometer", Number(h.current_odometer) === 153921.5, h.current_odometer);
ok("…taking McLeod's inspection date", String(h.dot_annual_inspection_expires_at).startsWith("2027-07-13") || new Date(h.dot_annual_inspection_expires_at).toISOString().startsWith("2027-07-13"));

// 4 — no office claim
ok("the office claims nothing — identity_source is mcleod, not manual", h.identity_source === "mcleod", h.identity_source);

// 2 — the serial-named row is a husk
ok("the serial-named row is retired", n.status === "retired");
ok("…no longer named after a gateway serial", !n.unit_number.includes("G6AA"), n.unit_number);
ok("…with no link, device or VIN left to match", n.mcleod_tractor_id === null && n.samsara_vehicle_id === null && n.vin === null);
const fks = (await db.query(`
  select c.conrelid::regclass::text tbl, a.attname col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.contype = 'f' and c.confrelid = 'public.vehicles'::regclass`)).rows;
let refs = 0;
for (const f of fks) refs += await num(`select count(*) n from ${f.tbl} where ${f.col} = $1`, [N]);
ok("…and nothing references it, across every foreign key into vehicles", refs === 0, `refs=${refs}`);

// Evidence did not move
ok("the fuel card stayed on the history row", (await num(`select count(*) n from fuel_cards where vehicle_id = $1`, [H])) === 1);

// 3 — collisions
const eng = await one(`select * from vehicle_engine_days where vehicle_id = $1 and day = $2`, [H, SWAP]);
ok("engine seconds from the two devices ADD on the swap day", eng.drive_sec === 8000, JSON.stringify(eng));
ok("…with coverage capped at one day", eng.coverage_sec === 86400, String(eng.coverage_sec));
ok("a non-colliding engine day moves across", (await num(`select count(*) n from vehicle_engine_days where vehicle_id = $1 and day = '2026-09-01'`, [H])) === 1);
ok("the newer row's spend-days are dropped, the history row's kept", (await num(`select count(*) n from fuel_spend_days where vehicle_id = $1`, [H])) === 1);
const odo = await one(`select * from samsara_odometer_readings where vehicle_id = $1 and day = $2`, [H, SWAP]);
ok("the LATER odometer reading wins the swap day", Number(odo.meters) === 230100000, String(odo.meters));
ok("a non-colliding odometer reading moves across", (await num(`select count(*) n from samsara_odometer_readings where vehicle_id = $1`, [H])) === 2);
const ifta = (await db.query(`select samsara_vehicle_id, total_meters from samsara_ifta_jurisdiction_miles where vehicle_id = $1 order by 1`, [H])).rows;
ok("BOTH devices' August IFTA miles are on the one truck", ifta.length === 2, JSON.stringify(ifta));
ok("…summing to the whole month", ifta.reduce((s, r) => s + Number(r.total_meters), 0) === 1400);
const pos = (await db.query(`select lat from vehicle_positions where vehicle_id = $1`, [H])).rows;
ok("the live device's position is the truck's position", pos.length === 1 && Number(pos[0].lat) === 42.5, JSON.stringify(pos));

// 5 — audit
const audits = (await db.query(`select * from audit_logs where action = 'roster.vehicle_merged'`)).rows;
ok("one audit row names the merge", audits.length === 1, String(audits.length));
ok("…on the survivor, naming the row it absorbed", audits[0]?.entity_id === H && audits[0]?.meta?.merged_from === N, JSON.stringify(audits[0]?.meta));

// 6 — untouched and idempotent
const o = await one(`select status, mcleod_tractor_id from vehicles where id = $1`, [OTHER]);
ok("an unrelated truck is untouched", o.status === "maintenance" && o.mcleod_tractor_id === "579");

let second = null;
try {
  await db.exec(sub);
} catch (e) {
  second = e.message;
}
ok("applying it a second time does not raise", second === null, second ?? "");
ok("…and writes no second audit row", (await num(`select count(*) n from audit_logs where action = 'roster.vehicle_merged'`)) === 1);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
