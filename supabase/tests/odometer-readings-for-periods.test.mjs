// Silvicom 360 — odometer_readings_for_periods (migration 0507, PLATFORM-RELIABILITY-PLAN D-RLY6).
//
// The fleet MPG reader stopped fetching every odometer reading in its window and asks this function
// for only the readings its rule uses. That is safe only if, for EVERY period bound, the function
// returns exactly the reading a full scan would have picked: the last one at or before the bound and
// at or after the period's floor, per truck and per counter. This matrix seeds an irregular fleet —
// gaps, parked weeks, three counters, a truck with one reading, readings exactly ON a bound — and
// compares every pick to a brute-force scan in JavaScript. It also checks the per-period `counts`
// against a direct count (the reader publishes them), the org boundary, and that clients cannot call it.
//
// Run: node supabase/tests/odometer-readings-for-periods.test.mjs
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
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'A') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'B') returning id`)).id;
const vehicle = async (org, unit) =>
  (await one(`insert into vehicles (org_id, unit_number, fuel_type, tank_capacity_gal) values ($1,$2,'diesel',150) returning id`, [org, unit])).id;

// A deterministic, irregular fleet: no Math.random, so a failure reproduces.
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const DAY = 86_400_000;
const T0 = Date.parse("2026-06-01T00:00:00Z");
const rows = [];
const trucks = [];
for (let t = 0; t < 8; t++) trucks.push(await vehicle(ORG, `T${t}`));
const sources = ["obd", "gps_distance", "gps_odometer"];
for (const [t, id] of trucks.entries()) {
  for (const source of sources.slice(0, 1 + (t % 3))) {
    let m = 100_000_000 + t * 1_000_000;
    for (let d = 0; d < 120; d++) {
      if (t === 3 && d >= 40 && d < 75) continue; // parked five weeks
      if (t === 6 && d !== 50) continue; // one reading in all
      if (rnd() < 0.2) continue; // the collector missed a day
      m += Math.round(rnd() * 600_000);
      // Late in the day, as the collector stages them; on day 61 exactly on a weekly bound below, and
      // on day 31 exactly on the second week's floor (from − 30 d), the instant the count is open at.
      const at = d === 61 || d === 31 ? T0 + d * DAY : T0 + d * DAY + 20 * 3_600_000 + Math.round(rnd() * 3_000_000);
      rows.push({ vehicle_id: id, source, reading_at: new Date(at).toISOString(), day: new Date(T0 + d * DAY).toISOString().slice(0, 10), meters: m });
    }
  }
}
for (const r of rows) {
  await db.query(`insert into samsara_odometer_readings (org_id, vehicle_id, source, day, reading_at, meters) values ($1,$2,$3,$4,$5,$6)`,
    [ORG, r.vehicle_id, r.source, r.day, r.reading_at, r.meters]);
}
// Another carrier's truck with readings inside every window — must never appear.
const foreign = await vehicle(OTHER, "X1");
for (let d = 0; d < 120; d += 3) {
  await db.query(`insert into samsara_odometer_readings (org_id, vehicle_id, source, day, reading_at, meters) values ($1,$2,'obd',$3,$4,$5)`,
    [OTHER, foreign, new Date(T0 + d * DAY).toISOString().slice(0, 10), new Date(T0 + d * DAY + 3_600_000).toISOString(), 5_000_000 + d]);
}

// Six weekly periods and one monthly, each with its own 30-day floor — the dashboard's shape.
const periods = [];
for (let w = 0; w < 6; w++) {
  const from = T0 + (54 + 7 * w) * DAY;
  periods.push({ from: new Date(from).toISOString(), to: new Date(from + 7 * DAY).toISOString(), floor: new Date(from - 30 * DAY).toISOString() });
}
periods.push({ from: new Date(T0 + 80 * DAY).toISOString(), to: new Date(T0 + 110 * DAY).toISOString(), floor: new Date(T0 + 50 * DAY).toISOString() });

const out = (await one(`select odometer_readings_for_periods($1, $2::jsonb) r`, [ORG, JSON.stringify(periods)])).r;
const returned = out.rows.map((r) => ({ ...r, ms: Date.parse(r.reading_at) }));
const key = (r) => `${r.vehicle_id}|${r.source}|${Date.parse(r.reading_at)}`;
const returnedKeys = new Set(returned.map(key));

// The brute force: for each bound and each (vehicle, counter), the last reading in [floor, bound].
let checked = 0, missing = [];
for (const p of periods) {
  for (const bound of [p.from, p.to]) {
    for (const id of trucks) for (const source of sources) {
      const candidates = rows.filter((r) => r.vehicle_id === id && r.source === source
        && Date.parse(r.reading_at) >= Date.parse(p.floor) && Date.parse(r.reading_at) <= Date.parse(bound));
      if (!candidates.length) continue;
      const want = candidates.reduce((a, b) => (Date.parse(b.reading_at) > Date.parse(a.reading_at) ? b : a));
      checked++;
      if (!returnedKeys.has(key(want))) missing.push(`${p.from}→${bound} ${source}`);
    }
  }
}
ok(`every bound's pick is returned (${checked} bound × truck × counter picks checked)`, checked > 100 && missing.length === 0, missing.slice(0, 3).join("; "));
ok("…and nothing that is not a pick: the set is no larger than the picks", returned.length <= checked, `${returned.length} > ${checked}`);
ok("…far fewer rows than the window held", returned.length < rows.length / 3, `${returned.length} of ${rows.length}`);
ok("every returned row is a real row of this org, with its metres", returned.every((r) => rows.some((x) => key(x) === key(r) && Number(r.meters) === x.meters)));
ok("the fleet has readings exactly on a floor — the instant the count is open at",
  rows.some((r) => Date.parse(r.reading_at) === T0 + 31 * DAY));
ok("a reading exactly ON a bound counts as at-or-before it",
  returned.some((r) => r.ms === T0 + 61 * DAY));
ok("another carrier's truck never appears", !returned.some((r) => r.vehicle_id === foreign));

const direct = [];
for (const p of periods) {
  direct.push(Number((await one(`select count(*) n from samsara_odometer_readings where org_id = $1 and reading_at > $2 and reading_at <= $3`, [ORG, p.floor, p.to])).n));
}
ok("counts are each period's own window (open at the floor, as the reader narrows), in the order asked", JSON.stringify(out.counts.map(Number)) === JSON.stringify(direct), JSON.stringify(out.counts));

const empty = (await one(`select odometer_readings_for_periods($1, '[]'::jsonb) r`, [ORG])).r;
ok("no periods → no rows, no counts", empty.rows.length === 0 && empty.counts.length === 0);
const before = (await one(`select odometer_readings_for_periods($1, $2::jsonb) r`, [ORG, JSON.stringify([{ from: "2020-01-08T00:00:00Z", to: "2020-01-15T00:00:00Z", floor: "2020-01-01T00:00:00Z" }])])).r;
ok("a window before any reading → no rows and a zero count", before.rows.length === 0 && Number(before.counts[0]) === 0);

const acl = (await one(`select coalesce(array_to_string(proacl, ','), '') a from pg_proc where proname = 'odometer_readings_for_periods'`)).a;
ok("clients cannot call it — the org is a parameter and it bypasses RLS", !/(^|,)(anon|authenticated)=X/.test(acl), acl);
ok("it is SECURITY DEFINER with an empty search_path",
  (await one(`select prosecdef d, array_to_string(proconfig, ',') c from pg_proc where proname = 'odometer_readings_for_periods'`)).c.includes("search_path=\"\""));

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
