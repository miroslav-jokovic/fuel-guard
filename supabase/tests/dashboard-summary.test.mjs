// Silvicom 360 — dashboard_summary matrix (migration 0347, audit queue item 5 step 1, D-PREC8).
//
// `useDashboard.ts` draws the fleet dashboard from TEN reads across six modules, two of them paged
// 1,000 rows at a time, plus a chunked `N x 100` .in() loop to attach a driver to each flagged fill.
// 0347 takes that measurement where the rows are. This matrix exists for the four ways that move
// could go wrong without anything on either side noticing.
//
//   1. **THE ASYMMETRY.** Fills, idle and declines are range-scoped; the ANOMALY figures are
//      all-time open cases and must stay that way (D-PREC7) — the "Active alerts" tile links to the
//      Alerts page, which filters by no date, so range-scoping the tile makes the number disagree
//      with the page the moment somebody clicks through. Writing this function "cleanly" against one
//      window silently changes what FOUR cards show, and no unit test anywhere would fail. Pinned
//      below by a case whose fill is outside the window entirely.
//   2. **THE JOIN THAT REPLACED THE LOOP.** A flagged fill can be OLDER than the visible range,
//      which is exactly why the browser could not resolve its driver from the fills it had already
//      fetched and had to issue a second chunked query. A `left join` that quietly became an inner
//      one, or that joined on the wrong column, would drop those drivers from the risk list and the
//      list would still look plausible.
//   3. **THE DAY BUCKET IS THE ORG'S, NOT UTC'S.** An evening fill belongs to the local day. Slicing
//      the ISO string instead is what mis-dated them before D-FUI11, and it is the same bug family
//      the whole of this audit's item 4 was about.
//   4. **TENANT ISOLATION.** D-FC1 exists because 0246 relied on RLS, which holds for a browser
//      session and FAILS for apps/api reading with the service role — a server-rendered PDF read
//      every carrier in the database. Every figure here is asserted against a second org holding
//      rows that must never appear.
//
// Run:  node supabase/tests/dashboard-summary.test.mjs
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
  create table storage.buckets (
    id text primary key, name text, public boolean default false, file_size_limit bigint,
    allowed_mime_types text[], owner uuid,
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
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// The carrier runs on Chicago time; the second org exists only to be absent from every answer.
const ORG = (await one(
  `insert into organizations (id,name,operating_hours) values (gen_random_uuid(),'Silvicom','{"tz":"America/Chicago","start":"05:00","end":"20:00"}'::jsonb) returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;

const veh = async (org, unit) => (await one(
  `insert into vehicles (org_id, unit_number, status, tank_capacity_gal) values ($1,$2,'active',150) returning id`, [org, unit])).id;
const drv = async (org, name) => (await one(
  `insert into drivers (org_id, full_name, status) values ($1,$2,'active') returning id`, [org, name])).id;

const V1 = await veh(ORG, "701"), V2 = await veh(ORG, "702"), VX = await veh(OTHER, "999");
const D1 = await drv(ORG, "Ada Byron"), D2 = await drv(ORG, "Grace Hopper");

const fill = async (org, { at, day, gal, cost, tank = "tractor", recon = null, vehicle = null, driver = null }) =>
  (await one(
    `insert into fuel_transactions (org_id, fueled_at, business_date, state, gallons, total_cost, tank_type,
       samsara_recon_at, vehicle_id, driver_id, is_canonical, card_ref)
     values ($1,$2,$3,'TX',$4,$5,$6,$7,$8,$9,true,gen_random_uuid()::text) returning id`,
    [org, at, day, gal, cost, tank, recon, vehicle, driver])).id;

// ── The window under test, and a deliberately awkward population ────────────────────────────────
const FROM = "2026-08-01", TO = "2026-08-31";

// Inside the window. The last one is the tz probe: 2026-08-10T02:00Z is 21:00 on the NINTH in
// Chicago, so a UTC bucket would file it under the 10th.
const IN = [
  { at: "2026-08-05T18:00:00Z", day: "2026-08-05", gal: 100, cost: 400, recon: "2026-08-06T00:00:00Z", vehicle: V1, driver: D1 },
  { at: "2026-08-05T19:00:00Z", day: "2026-08-05", gal: 50,  cost: 200, vehicle: V2, driver: D2 },
  { at: "2026-08-20T12:00:00Z", day: "2026-08-20", gal: 40,  cost: 160, tank: "reefer", vehicle: V1 },
  { at: "2026-08-10T02:00:00Z", day: "2026-08-09", gal: 10,  cost: 30,  vehicle: V1, driver: D1 },
];
for (const f of IN) await fill(ORG, f);
// Outside the window, and outside every figure that is range-scoped.
const OLD_FILL = await fill(ORG, { at: "2026-05-01T12:00:00Z", day: "2026-05-01", gal: 999, cost: 9999, vehicle: V2, driver: D2 });
// Another carrier's fill, on a day inside the window.
await fill(OTHER, { at: "2026-08-05T18:00:00Z", day: "2026-08-05", gal: 777, cost: 7777, vehicle: VX });

// `rule_id` varies per call: `uq_anomalies_open_txn_rule` allows one OPEN case per (fill, rule), and
// two cases on the same fill is exactly the shape the vehicle risk ranking needs to be tested on.
let ruleN = 0;
const anomaly = async (org, { txn = null, vehicle = null, severity, status = "open" }) =>
  (await one(
    `insert into anomalies (org_id, transaction_id, vehicle_id, severity, status, rule_id, message)
     values ($1,$2,$3,$4,$5,$6,'m') returning id`, [org, txn, vehicle, severity, status, `r${++ruleN}`])).id;

const inWindowTxn = (await db.query(
  `select id from fuel_transactions where org_id = $1 and business_date = '2026-08-05' order by gallons desc limit 1`, [ORG])).rows[0].id;

// ⚠ `anomalies.transaction_id` is NOT NULL — every case hangs off a fill (the same fact D-FX2 cites
// as the reason `fuel_exceptions` had to be its own table). So "a case with no driver" is a case on a
// fill that CARRIES no driver, which is the reefer fill below.
const noDriverTxn = (await db.query(
  `select id from fuel_transactions where org_id = $1 and tank_type = 'reefer' limit 1`, [ORG])).rows[0].id;

await anomaly(ORG, { txn: inWindowTxn, vehicle: V1, severity: "critical" });
await anomaly(ORG, { txn: inWindowTxn, vehicle: V1, severity: "medium" });
await anomaly(ORG, { txn: noDriverTxn, vehicle: V1, severity: "medium", status: "investigating" });
// ⚠ Properties 1 and 2 together: an open case whose fill is MONTHS outside the window. It must still
// be counted, and its driver must still be resolved — the browser needed a whole second query for it.
await anomaly(ORG, { txn: OLD_FILL, vehicle: V2, severity: "critical" });
// Closed, and another carrier's — neither may appear anywhere.
await anomaly(ORG, { txn: inWindowTxn, vehicle: V1, severity: "critical", status: "resolved" });
const otherTxn = (await db.query(`select id from fuel_transactions where org_id = $1 limit 1`, [OTHER])).rows[0].id;
await anomaly(OTHER, { txn: otherTxn, vehicle: VX, severity: "critical" });

// ── A population big enough that `limit 5` actually bites ───────────────────────────────────────
// With two trucks the CTE's `limit 5` never fires and the outer `jsonb_agg`'s own ORDER BY hides any
// mistake in the CTE's — a mutant that reversed the inner ordering passed 22/22. Six more trucks,
// each with a DISTINCT number of open cases and none critical, make the cut observable: the two
// trucks holding a critical sort above all of them, then the three biggest counts. All of these fills
// sit OUTSIDE the window, which also means every range-scoped figure above stays exactly as asserted.
const RANKED = [["703", 7], ["704", 6], ["705", 5], ["706", 4], ["707", 3], ["708", 2]];
for (const [unit, n] of RANKED) {
  const v = await veh(ORG, unit);
  const t = await fill(ORG, { at: "2026-05-02T12:00:00Z", day: "2026-05-02", gal: 1, cost: 1, vehicle: v });
  for (let i = 0; i < n; i++) await anomaly(ORG, { txn: t, vehicle: v, severity: "medium" });
}
const RANKED_CASES = RANKED.reduce((a, [, n]) => a + n, 0);

await db.exec(`insert into idle_rollup_days (org_id, vehicle_id, day, drive_sec, idle_sec, off_sec, coverage_sec)
  values ('${ORG}','${V1}','2026-08-05',0,3600,0,86400),
         ('${ORG}','${V2}','2026-08-20',0,1800,0,86400),
         ('${ORG}','${V1}','2026-05-01',0,99999,0,86400),
         ('${OTHER}','${VX}','2026-08-05',0,55555,0,86400)`);

// ⚠ No declines here. The first draft counted them and `lint:boundaries` refused the migration:
// `declined_transactions` is `layer = raw` and sealed to its collector. The count stays with the
// `fuel` module and the dashboard endpoint asks for it there — see the migration header.
const call = async (org = ORG, from = FROM, to = TO) =>
  one(`select * from dashboard_summary($1,$2,$3)`, [from, to, org]);

const r = await call();

// ── 1. the range-scoped figures count the window and nothing else ───────────────────────────────
ok("spend sums only fills inside the window", Number(r.total_spend) === 790, `got ${r.total_spend}`);
ok("gallons likewise", Number(r.total_gallons) === 200, `got ${r.total_gallons}`);
ok("reefer spend is separated from tractor spend", Number(r.reefer_spend) === 160, `got ${r.reefer_spend}`);
ok("covered counts the recon STAMP, not the status", r.covered_txns === 1, `got ${r.covered_txns}`);
ok("total_txns counts the window's fills", r.total_txns === 4, `got ${r.total_txns}`);
ok("idle seconds cover the window only", Number(r.idle_sec) === 5400, `got ${r.idle_sec}`);

// ── 2. ⚠ the asymmetry: anomalies are all-time, and this is the assertion that guards it ────────
ok("open cases are NOT range-scoped — the ones on May fills still count", r.open_anomalies === 4 + RANKED_CASES, `got ${r.open_anomalies}`);
ok("a resolved case is not an open case", r.open_anomalies === 4 + RANKED_CASES);
const sev = r.severity_counts;
ok("severity counts are the open set", sev.critical === 2 && sev.medium === 2 + RANKED_CASES, JSON.stringify(sev));

// ── 3. the join that replaced the N x 100 loop ──────────────────────────────────────────────────
const drivers = r.top_drivers;
const byName = Object.fromEntries(drivers.map((d) => [d.label, d]));
ok("a driver is resolved through a fill OUTSIDE the range — the loop's whole purpose",
   byName["Grace Hopper"]?.anomaly_count === 1 && byName["Grace Hopper"]?.critical_count === 1,
   JSON.stringify(drivers));
ok("a driver on an in-window fill is resolved too", byName["Ada Byron"]?.anomaly_count === 2, JSON.stringify(drivers));
ok("a case on a fill with no driver contributes no driver row", drivers.length === 2, JSON.stringify(drivers));

const vehicles = r.top_vehicles;
// Both trucks carry exactly one critical, so this also pins the TIEBREAK: count descending.
// Critical first, then count — and only the top five of EIGHT candidates survive the cut.
ok("vehicles rank by critical first, then by count, and stop at five",
   vehicles.length === 5 &&
   vehicles.map((v) => v.label).join(",") === "701,702,703,704,705",
   JSON.stringify(vehicles.map((v) => [v.label, v.critical_count, v.anomaly_count])));
ok("a vehicle carries its unit number, not its id", vehicles.every((v) => /^\d{3}$/.test(v.label)), JSON.stringify(vehicles));

// ── 4. the day bucket is the ORG's day ──────────────────────────────────────────────────────────
const days = Object.fromEntries(r.spend_by_day.map((d) => [d.date, Number(d.value)]));
ok("an evening fill lands on the LOCAL day, not the UTC one",
   days["2026-08-09"] === 30 && days["2026-08-10"] === undefined, JSON.stringify(days));
ok("same-day fills are summed", days["2026-08-05"] === 600, JSON.stringify(days));
ok("the series carries only days that HAVE spend — zero-fill is the caller's question",
   r.spend_by_day.length === 3, JSON.stringify(days));

// ── 5. tenant isolation, every figure ───────────────────────────────────────────────────────────
const other = await call(OTHER);
ok("the other carrier's fills are absent from this one's totals", Number(other.total_spend) === 7777);
ok("…and its idle and its cases are its own",
   Number(other.idle_sec) === 55555 && other.open_anomalies === 1,
   JSON.stringify({ idle: other.idle_sec, open: other.open_anomalies }));

// ── 6. an empty window measures zero rather than refusing ───────────────────────────────────────
const empty = await call(ORG, "2027-01-01", "2027-01-31");
ok("an empty window is zeros and empty collections, not nulls",
   Number(empty.total_spend) === 0 && empty.total_txns === 0 &&
   Array.isArray(empty.spend_by_day) && empty.spend_by_day.length === 0,
   JSON.stringify({ spend: empty.total_spend, days: empty.spend_by_day }));
ok("…and the all-time case figures are UNAFFECTED by an empty window", empty.open_anomalies === 4 + RANKED_CASES, `got ${empty.open_anomalies}`);

await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
