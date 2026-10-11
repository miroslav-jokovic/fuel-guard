// FuelGuard — migration 0400, unit 568 is one truck in two rows (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md
// FL1b, Q-FL5, Q-FL6 (a)). The 0359 pattern, so the 0359 matrix's shape.
//
// A data migration against production, applied by `migrate.yml` on merge with nobody watching, so it is
// run here first: every migration before 0400 is applied, production's two rows and their collisions
// are seeded in the shapes measured on 2026-10-01, then the subject runs. What must hold afterwards:
//
//   1. One row named `568`, McLeod-linked, active, carrying the VIN — the HISTORY row, keeping its own
//      device, tank and idle learning; its fuel evidence never moved.
//   2. The other row is retired under a new name, with no link, device or VIN (Q-FL6 (a)), and nothing
//      references it.
//   3. Collisions resolve as the header says: spend-days dropped, the rollup day summed, the duplicated
//      IFTA miles kept ONCE (the later fetch), the survivor's position kept.
//   4. The office claims nothing; make/model are derived (0399).
//   5. One audit row names what happened; an unrelated truck is untouched; a second run does nothing.
//
// Run: node supabase/tests/merge-unit-568.test.mjs

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
const SUBJECT = "0400_merge_unit_568.sql";
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
const H = "759ef27a-124d-4b22-8429-bca6a8b0c6cf"; // `568`, history row
const N = "990128aa-6994-49fe-800c-f3365bcdee64"; // `568 - OLD`, McLeod-linked
const H_DEVICE = "281475006145500";
const N_DEVICE = "281474977689800";
const VIN = "3AKJHHDR5MSMS9642";

const ins = async (table, cols) => {
  const keys = Object.keys(cols);
  const ph = keys.map((_, i) => `$${i + 1}`).join(",");
  return one(`insert into ${table} (${keys.join(",")}) values (${ph}) returning *`, Object.values(cols));
};

// ── production's two rows, 2026-10-01 ───────────────────────────────────────────────────────────
await ins("vehicles", {
  id: H, org_id: ORG, unit_number: "568", status: "retired", identity_source: "samsara",
  samsara_vehicle_id: H_DEVICE, tank_capacity_gal: 240, baseline_mpg: 7.63, current_odometer: 588587.0,
  idle_capability: "apu", idle_evidence_status: "sufficient", idle_evidence_sessions: 19,
});
await ins("vehicles", {
  id: N, org_id: ORG, unit_number: "568 - OLD", status: "active", identity_source: "mcleod",
  mcleod_tractor_id: "568", mcleod_company_id: "TMS", vin: VIN, make: "FRHT", model: "CA", year: 2021,
  plate: "P1005705", plate_state: "IL", purchased_at: "2020-12-21", dot_annual_inspection_expires_at: "2027-02-26",
  samsara_vehicle_id: N_DEVICE, tank_capacity_gal: 0, current_odometer: 586881.1,
  idle_capability: "unknown", idle_evidence_status: "insufficient", idle_evidence_sessions: 0,
});
const OTHER = (await ins("vehicles", {
  org_id: ORG, unit_number: "579", status: "maintenance", identity_source: "mcleod",
  mcleod_tractor_id: "579", tank_capacity_gal: 200, samsara_vehicle_id: "281475000000001",
})).id;

// ── children ────────────────────────────────────────────────────────────────────────────────────
await ins("fuel_cards", { org_id: ORG, vehicle_id: H, card_ref: "5681" });
for (const v of [H, N]) await ins("fuel_spend_days", { org_id: ORG, vehicle_id: v, day: "2026-08-03" });
await ins("fuel_spend_days", { org_id: ORG, vehicle_id: N, day: "2026-08-04" });
// 08/02: the history row covered none of the day, the other row 19,681 s.
await ins("idle_rollup_days", { org_id: ORG, vehicle_id: H, day: "2026-08-02", coverage_sec: 0, idle_sec: 0 });
await ins("idle_rollup_days", { org_id: ORG, vehicle_id: N, day: "2026-08-02", coverage_sec: 19681, idle_sec: 459 });
await ins("idle_rollup_days", { org_id: ORG, vehicle_id: N, day: "2026-08-20", coverage_sec: 86400, idle_sec: 100 });
await ins("vehicle_engine_days", { org_id: ORG, vehicle_id: N, day: "2026-08-20", drive_sec: 1, idle_sec: 1, off_sec: 1, coverage_sec: 3 });
const FETCH = (await ins("samsara_ifta_fetches", { org_id: ORG, period_year: 2026, period_month: 7 })).id;
// The SAME device's July miles on both rows (identical values, fetched 08/31 and 09/30), and August on N only.
for (const [v, fetched] of [[H, "2026-08-31T23:59:01Z"], [N, "2026-09-30T23:54:39Z"]]) {
  await ins("samsara_ifta_jurisdiction_miles", {
    org_id: ORG, vehicle_id: v, samsara_vehicle_id: N_DEVICE, period_year: 2026, period_month: 7,
    jurisdiction: "IL", recognised: true, taxable_meters: 500, total_meters: 500, tax_paid_liters: 0, fetch_id: FETCH, fetched_at: fetched,
  });
}
await ins("samsara_ifta_jurisdiction_miles", {
  org_id: ORG, vehicle_id: N, samsara_vehicle_id: N_DEVICE, period_year: 2026, period_month: 8,
  jurisdiction: "IN", recognised: true, taxable_meters: 300, total_meters: 300, tax_paid_liters: 0, fetch_id: FETCH,
});
for (const [v, lat] of [[H, 41.0], [N, 42.5]]) {
  await ins("vehicle_positions", { org_id: ORG, vehicle_id: v, lat, lng: -88.0, sampled_at: "2026-09-16T00:00:00Z" });
}

// ═══ apply the subject ═════════════════════════════════════════════════════════════════════════
const sub = read(join("migrations", SUBJECT));

// A row changed since the measurement is not merged: rename the other row, run, inspect, roll back.
await db.exec("begin");
await db.query(`update vehicles set unit_number = '568B' where id = $1`, [N]);
await db.exec(sub);
const guarded = await one(`select status, samsara_vehicle_id from vehicles where id = $1`, [N]);
const guardAudits = await num(`select count(*) n from audit_logs where action = 'roster.vehicle_merged'`);
await db.exec("rollback");
ok("a row renamed since 2026-10-01 is left alone", guarded.status === "active" && guarded.samsara_vehicle_id === N_DEVICE && guardAudits === 0);

let applied = null;
try {
  await db.exec(sub);
} catch (e) {
  applied = e.message;
}
ok("0400 applies without raising", applied === null, applied ?? "");

const h = await one(`select * from vehicles where id = $1`, [H]);
const n = await one(`select * from vehicles where id = $1`, [N]);

// 1 — the history row survives
ok("the survivor is the history row, still named 568", h.unit_number === "568");
ok("…active, as McLeod reports it", h.status === "active", h.status);
ok("…McLeod-linked", h.mcleod_tractor_id === "568" && h.mcleod_company_id === "TMS");
ok("…carrying the VIN and McLeod's plate", h.vin === VIN && h.plate === "P1005705");
ok("…keeping its OWN device, the later one", h.samsara_vehicle_id === H_DEVICE, h.samsara_vehicle_id);
ok("…its own idle learning", h.idle_capability === "apu" && Number(h.idle_evidence_sessions) === 19);
ok("…its own learned 240-gal tank", Number(h.tank_capacity_gal) === 240, h.tank_capacity_gal);
ok("…and the higher odometer", Number(h.current_odometer) === 588587.0, h.current_odometer);
// 4
ok("the office claims nothing — identity_source mcleod", h.identity_source === "mcleod", h.identity_source);
ok("make/model derived by 0399's trigger", h.make === "Freightliner" && h.model === "Cascadia", `${h.make} ${h.model}`);

// 2 — the other row
ok("the other row is retired", n.status === "retired");
ok("…renamed so no matcher reaches it", n.unit_number === "568-merged-990128aa", n.unit_number);
ok("…with no link, device or VIN (Q-FL6 (a))", n.mcleod_tractor_id === null && n.samsara_vehicle_id === null && n.vin === null);
const fks = (
  await db.query(`
  select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.contype = 'f' and c.confrelid = 'public.vehicles'::regclass`)
).rows;
let refs = 0;
for (const f of fks) refs += await num(`select count(*) n from ${f.tbl} where ${f.col} = $1`, [N]);
ok("…and nothing references it, across every foreign key into vehicles", refs === 0, `refs=${refs}`);

// 3 — collisions
ok("the fuel card stayed", (await num(`select count(*) n from fuel_cards where vehicle_id = $1`, [H])) === 1);
ok("the other row's spend-days are dropped, the history row's kept", (await num(`select count(*) n from fuel_spend_days where vehicle_id = $1`, [H])) === 1);
const r0802 = await one(`select * from idle_rollup_days where vehicle_id = $1 and day = '2026-08-02'`, [H]);
ok("the colliding rollup day sums", Number(r0802.coverage_sec) === 19681 && Number(r0802.idle_sec) === 459, JSON.stringify(r0802));
ok("a non-colliding rollup day moves across", (await num(`select count(*) n from idle_rollup_days where vehicle_id = $1`, [H])) === 2);
ok("a non-colliding engine day moves across", (await num(`select count(*) n from vehicle_engine_days where vehicle_id = $1`, [H])) === 1);
const july = (await db.query(`select total_meters, fetched_at from samsara_ifta_jurisdiction_miles where vehicle_id = $1 and period_month = 7`, [H])).rows;
ok("the device's July miles are kept ONCE, not summed", july.length === 1 && Number(july[0].total_meters) === 500, JSON.stringify(july));
ok("…the later fetch", new Date(july[0]?.fetched_at).toISOString().startsWith("2026-09-30"), JSON.stringify(july));
ok("August's miles move across", (await num(`select count(*) n from samsara_ifta_jurisdiction_miles where vehicle_id = $1 and period_month = 8`, [H])) === 1);
const pos = (await db.query(`select lat from vehicle_positions where vehicle_id = $1`, [H])).rows;
ok("the survivor's position stays the truck's position", pos.length === 1 && Number(pos[0].lat) === 41.0, JSON.stringify(pos));

// 5
const audits = (await db.query(`select * from audit_logs where action = 'roster.vehicle_merged'`)).rows;
ok("one audit row", audits.length === 1, String(audits.length));
ok("…naming both rows and the released device", audits[0]?.entity_id === H && audits[0]?.meta?.merged_from === N && audits[0]?.meta?.released_samsara_vehicle_id === N_DEVICE, JSON.stringify(audits[0]?.meta));
const o = await one(`select * from vehicles where id = $1`, [OTHER]);
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
