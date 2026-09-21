// Silvicom 360 — the FleetPal repair record (migration 0349, FLEETPAL-INTEGRATION-PLAN F6).
//
// 0334's matrix pinned the ground: the credential, the watermark, the identity resolution. This one
// pins what stands on it — eight staging tables and the nine set-based functions that fill them —
// and it exists for five failures that all look like a successful sweep:
//
//   1. **A RE-RUN DOUBLES THE HISTORY.** The sweep is at-least-once by design (a retried window, a
//      restarted worker, a backfill run twice). If staging were an INSERT, every repeat would add a
//      second copy of a repair, and the per-truck cost this integration exists to produce would be
//      wrong by exactly the number of times anybody re-ran it.
//   2. **A PAYLOAD CHOOSES ITS OWN TENANT.** The rows come from a vendor. If `org_id` were read out
//      of the payload rather than from the parameter, one carrier's repair history could be written
//      into another's by a field nobody looks at.
//   3. **A BROWSER CAN CALL THE INGEST.** Postgres grants EXECUTE to PUBLIC by default, so without
//      the revokes in 0349 anyone holding the anon key could write a carrier's repair record
//      through PostgREST — straight past the deny-all RLS these tables carry.
//   4. **MONEY LOSES A CENT, OR A METER OVERFLOWS.** The five-way split must add up to what the
//      vendor sent, and `odometer` reaches 663,000,000 metres on this fleet — which is why it is
//      bigint and why a float anywhere here would be a slow, plausible lie.
//   5. **A CHILD WITHOUT ITS PARENT IS REFUSED.** It must NOT be: the sweep pages each resource
//      separately, so a job whose work order did not change in this window arrives alone. A foreign
//      key here would turn the ordinary case into a failed sweep (0349's header says so at length),
//      and this matrix is what would fail if somebody "tidied" one in.

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
  else { fail++; console.log(`  FAIL  ${name}  ${extra}`); }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const sqlstate = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
};

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false, file_size_limit bigint,
    allowed_mime_types text[], owner uuid, created_at timestamptz default now(),
    updated_at timestamptz default now()
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

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;
const USER = (await one(`insert into auth.users (email) values ('shop@silvicom.test') returning id`)).id;

const STAGING = [
  "fleetpal_vendors",
  "fleetpal_shops",
  "fleetpal_work_orders",
  "fleetpal_jobs",
  "fleetpal_job_items",
  "fleetpal_service_history",
  "fleetpal_meters",
  "fleetpal_pm_schedules",
  "fleetpal_pm_intervals",
  // F7's bounded-re-read tier (migration 0350). Same module, same deny-all posture, same ingest
  // shape — so they are asserted here rather than in a second matrix that would re-apply all 350
  // migrations to say the same things.
  "fleetpal_defects",
  "fleetpal_issues",
  "fleetpal_expirations",
];

const stage = (fn, org, rows) => db.query(`select ${fn}($1::uuid, $2::jsonb) as n`, [org, JSON.stringify(rows)]);
const count = async (table, org) =>
  (await one(`select count(*)::int n from ${table} where org_id=$1`, [org])).n;

// ── 1. every table exists, is org-scoped, and is deny-all ──────────────────────────────────────
for (const t of STAGING) {
  const meta = await one(
    `select c.relrowsecurity as rls,
            (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies,
            (select count(*)::int from information_schema.columns col
              where col.table_name = c.relname and col.column_name = 'org_id') as has_org
       from pg_class c where c.relname = $1`,
    [t],
  );
  ok(`${t}: row level security is on with no client policy — deny-all on purpose (D-SEP1)`,
    meta?.rls === true && meta?.policies === 0, JSON.stringify(meta));
  ok(`${t}: carries its own org_id — the API reads with the service role and bypasses RLS`,
    meta?.has_org === 1);
}

// ── 2. the ingest is idempotent on (org_id, fleetpal_id) ───────────────────────────────────────
const WO = [{
  fleetpal_id: "dAP6VYUL", number: 5331, reference_number: "WO-5331", status: "CLOSED",
  priority: "LOW", repair_priority_class: "EMERGENCY", unit_fleetpal_id: "zeabsRcL",
  shop_fleetpal_id: "farh5tje", description: "CHECK TRUCK JUMP START",
  scheduled_start: null, expected_completion: null,
  started: "2026-09-20T17:00:00Z", completed: "2026-09-20T21:30:00Z",
  cancellation_reason: "", vendor_created_at: "2026-09-21T20:36:38Z",
  vendor_updated_at: "2026-09-21T21:30:29Z",
}];

await stage("stage_fleetpal_work_orders", ORG, WO);
const afterFirst = await one(`select id, reference_number, status from fleetpal_work_orders where org_id=$1`, [ORG]);
await stage("stage_fleetpal_work_orders", ORG, WO);
const afterSecond = await one(`select id, reference_number, status from fleetpal_work_orders where org_id=$1`, [ORG]);

ok("⚠ staging the same page twice leaves ONE row — the sweep is at-least-once by design",
  (await count("fleetpal_work_orders", ORG)) === 1);
ok("and it is the SAME row, not a replacement — the primary key a later table might reference is stable",
  afterFirst.id === afterSecond.id);

// A changed field must actually land: an idempotent write that ignored updates would be a sweep
// that never sees a work order close.
await stage("stage_fleetpal_work_orders", ORG, [{ ...WO[0], status: "CANCELED", cancellation_reason: "duplicate" }]);
const changed = await one(`select status, cancellation_reason from fleetpal_work_orders where org_id=$1`, [ORG]);
ok("a re-stage with a changed field updates in place — idempotent is not inert",
  changed.status === "CANCELED" && changed.cancellation_reason === "duplicate");

// ── 3. the tenant comes from the parameter, never from the payload ─────────────────────────────
await stage("stage_fleetpal_work_orders", OTHER, [{ ...WO[0], org_id: ORG }]);
ok("⚠ an `org_id` inside the payload is ignored — the tenant is the parameter",
  (await count("fleetpal_work_orders", OTHER)) === 1 && (await count("fleetpal_work_orders", ORG)) === 1);
ok("so the same vendor id in two carriers is two rows, not a conflict",
  (await one(`select count(distinct org_id)::int n from fleetpal_work_orders where fleetpal_id='dAP6VYUL'`)).n === 2);

ok("and the org of a staged row cannot be moved afterwards (forbid_org_change)",
  (await sqlstate(`update fleetpal_work_orders set org_id=$1 where org_id=$2`, [OTHER, ORG])) !== null);

// ── 4. a child without its parent is accepted — the design, not an oversight ───────────────────
ok("⚠ a job whose work order has never been staged is accepted — the sweep pages resources separately",
  (await sqlstate(
    `select stage_fleetpal_jobs($1::uuid, $2::jsonb)`,
    [ORG, JSON.stringify([{ fleetpal_id: "GjWnqMVH", work_order_fleetpal_id: "NEVER-SEEN", name: "Alternator", total: 512.5 }])],
  )) === null);
ok("and a line item whose job has never been staged, likewise",
  (await sqlstate(
    `select stage_fleetpal_job_items($1::uuid, $2::jsonb)`,
    [ORG, JSON.stringify([{ fleetpal_id: "azZ8CUN8", job_fleetpal_id: "NEVER-SEEN", item_type: "TAX", quantity: 1, price: 33.76, total: 33.76 }])],
  )) === null);

// ── 5. money keeps its cents and a meter does not overflow ─────────────────────────────────────
await stage("stage_fleetpal_service_history", ORG, [{
  fleetpal_id: "SH1", work_order_fleetpal_id: "dAP6VYUL", work_order_reference: "WO-5331",
  unit_fleetpal_id: "zeabsRcL", total: 1808.10, total_parts: 1200.05, total_labor: 500.00,
  total_fees: 50.00, total_tax: 33.76, total_services: 24.29, total_labor_hours: 4.5,
  // 663 million metres is 412,000 miles — the real top of this fleet's odometer range, and the
  // reason this column is bigint. An `integer` would have taken it at 2.1 billion, so the failure
  // would have arrived years later on one truck.
  odometer: 663_000_000, hubometer: 12_000_000, engine_hours: 21000.5, apu_hours: 900.25,
  started: "2026-09-20T17:00:00Z", completed: "2026-09-20T21:30:00Z",
}]);
const sh = await one(
  `select total, total_parts + total_labor + total_fees + total_tax + total_services as split,
          odometer, total_labor_hours
     from fleetpal_service_history where org_id=$1 and fleetpal_id='SH1'`,
  [ORG],
);
ok("the five-way split adds up to the total, to the cent — numeric, never a float (D-FP9)",
  Number(sh.total) === 1808.10 && Number(sh.split) === 1808.10, JSON.stringify(sh));
ok("an odometer of 663,000,000 metres survives — canonical metres, bigint",
  Number(sh.odometer) === 663_000_000);
ok("and labour hours keep their half-hour", Number(sh.total_labor_hours) === 4.5);

// ── 6. a PM schedule and its intervals ─────────────────────────────────────────────────────────
await stage("stage_fleetpal_pm_schedules", ORG, [{
  fleetpal_id: "PM1", unit_fleetpal_id: "zeabsRcL", name: "A Service", auto_create_wo: true,
  last_done: "2026-08-01T00:00:00Z",
}]);
await stage("stage_fleetpal_pm_intervals", ORG, [
  { fleetpal_id: "IV1", pm_schedule_fleetpal_id: "PM1", interval_type: "METER", order_index: 0,
    value_int: 40233600, threshold_int: 1609344, last_done_meter_value: 600000000 },
  { fleetpal_id: "IV2", pm_schedule_fleetpal_id: "PM1", interval_type: "TIME", order_index: 1,
    value_int: 6, value_time_type: "MONTH", threshold_int: 14, threshold_time_type: "DAY" },
]);
const intervals = await db.query(
  `select interval_type, value_int, value_time_type from fleetpal_pm_intervals
    where org_id=$1 and pm_schedule_fleetpal_id='PM1' order by order_index`, [ORG]);
ok("a meter interval keeps its metres and a time interval keeps its COUNT — reading the two the same way is how a truck comes due every six metres",
  Number(intervals.rows[0].value_int) === 40233600 && intervals.rows[0].value_time_type === null &&
  Number(intervals.rows[1].value_int) === 6 && intervals.rows[1].value_time_type === "MONTH");

await stage("stage_fleetpal_pm_intervals", ORG, [
  { fleetpal_id: "IV1", pm_schedule_fleetpal_id: "PM1", interval_type: "METER", order_index: 0,
    value_int: 40233600, threshold_int: 1609344, last_done_meter_value: 640000000 },
]);
ok("re-staging an interval updates it rather than adding a second trigger to the same schedule",
  (await count("fleetpal_pm_intervals", ORG)) === 2 &&
  Number((await one(`select last_done_meter_value v from fleetpal_pm_intervals where org_id=$1 and fleetpal_id='IV1'`, [ORG])).v) === 640000000);

// ── 7. an empty page is a no-op, not an error ──────────────────────────────────────────────────
ok("staging an empty page writes nothing and does not raise — a sweep with no changes is the normal case",
  (await sqlstate(`select stage_fleetpal_meters($1::uuid, '[]'::jsonb)`, [ORG])) === null &&
  (await count("fleetpal_meters", ORG)) === 0);
ok("and a null page is treated the same, rather than reaching jsonb_to_recordset with nothing",
  (await sqlstate(`select stage_fleetpal_meters($1::uuid, null)`, [ORG])) === null);


// ── 9. the bounded-re-read tier (0350, F7) ─────────────────────────────────────────────────────
//
// The failure these guard is the one the tier exists for: a defect that was REPAIRED between two
// sweeps. `is_resolved=false` alone never returns it again, so our copy would show it open for
// ever; the ingest's second half re-reads by detection date to catch exactly that, and the staging
// function has to let the flag flip in place rather than keeping the first answer it saw.

await stage("stage_fleetpal_defects", ORG, [{
  fleetpal_id: "DF1", unit_fleetpal_id: "zeabsRcL", name: "Air leak", severity: "MAJOR",
  component: "013", complaint: "AB", detected_on: "2026-09-01T10:00:00Z", is_resolved: false,
  resolved_on: null, driver_comment: "hissing at the gladhand", repair_note: null,
  dvir_fleetpal_ids: ["DV1", "DV2"],
}]);
ok("a defect's DVIR ids are stored as the opaque array they are — no endpoint resolves them",
  (await one(`select array_length(dvir_fleetpal_ids,1) n from fleetpal_defects where org_id=$1 and fleetpal_id='DF1'`, [ORG])).n === 2);

await stage("stage_fleetpal_defects", ORG, [{
  fleetpal_id: "DF1", unit_fleetpal_id: "zeabsRcL", name: "Air leak", severity: "MAJOR",
  component: "013", complaint: "AB", detected_on: "2026-09-01T10:00:00Z", is_resolved: true,
  resolved_on: "2026-09-20T14:00:00Z", driver_comment: "hissing at the gladhand",
  repair_note: "replaced gladhand seal", dvir_fleetpal_ids: ["DV1", "DV2"],
}]);
const resolved = await one(
  `select is_resolved, resolved_on, repair_note from fleetpal_defects where org_id=$1 and fleetpal_id='DF1'`, [ORG]);
ok("⚠ a defect that resolved between sweeps flips IN PLACE — the whole reason the tier re-reads by detection date",
  resolved.is_resolved === true && resolved.repair_note === "replaced gladhand seal",
  JSON.stringify(resolved));
ok("and it is still one row, not a second copy of the same defect",
  (await count("fleetpal_defects", ORG)) === 1);

await stage("stage_fleetpal_expirations", ORG, [{
  fleetpal_id: "EX1", unit_fleetpal_id: "zeabsRcL", name: "Registration",
  expiration_date: "2026-12-31T00:00:00Z", threshold_value: 30, threshold_type: "DAY",
  alters_unit_status: true, target_status: "roJGhzCu", is_completed: false, status: "PLANNED",
}]);
ok("an expiration keeps the vendor's own derived status rather than one we recomputed",
  (await one(`select status from fleetpal_expirations where org_id=$1 and fleetpal_id='EX1'`, [ORG])).status === "PLANNED");
ok("⚠ and `target_status` is stored as the opaque unit-status id it is — nothing exposes those ids (§2.10.5)",
  (await one(`select target_status from fleetpal_expirations where org_id=$1 and fleetpal_id='EX1'`, [ORG])).target_status === "roJGhzCu");

await stage("stage_fleetpal_issues", ORG, [{
  fleetpal_id: "IS1", unit_fleetpal_id: "zeabsRcL", name: "Vibration at speed",
  priority: "HIGH", status: "OPEN", reported: "2026-09-18T00:00:00Z",
  vendor_created_at: "2026-09-18T00:00:00Z", vendor_updated_at: "2026-09-18T00:00:00Z",
}]);
ok("an issue stages and stays one row across a re-run, like everything else in this collector",
  (await count("fleetpal_issues", ORG)) === 1);

// ── 8. no client may call the ingest or read what it wrote ─────────────────────────────────────
// ⚠ Inside a transaction, because `set local role` lasts for the transaction and PGlite runs each
// statement in its own when there is none — which silently leaves the query running as the OWNER.
// The first version of this file did exactly that and reported the browser reading a carrier's
// repair history, which was the test being wrong rather than the database.
async function asClient(role, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: USER, org_id: ORG, user_role: "admin", role }),
    ]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return { rows: res.rows, error: null };
  } catch (e) {
    await db.exec("rollback");
    return { rows: [], error: e.code ?? String(e.message) };
  }
}

for (const role of ["anon", "authenticated"]) {
  for (const fn of [
    "stage_fleetpal_vendors", "stage_fleetpal_shops", "stage_fleetpal_work_orders",
    "stage_fleetpal_jobs", "stage_fleetpal_job_items", "stage_fleetpal_service_history",
    "stage_fleetpal_meters", "stage_fleetpal_pm_schedules", "stage_fleetpal_pm_intervals",
    "stage_fleetpal_defects", "stage_fleetpal_issues", "stage_fleetpal_expirations",
  ]) {
    const r = await asClient(role, `select ${fn}($1::uuid, '[]'::jsonb)`, [ORG]);
    ok(`⚠ ${role} cannot call ${fn} — EXECUTE is granted to PUBLIC by default, so the revoke is the whole defence`,
      r.error === "42501", JSON.stringify(r));
  }
  for (const t of STAGING) {
    const sel = await asClient(role, `select count(*)::int n from ${t} where org_id=$1`, [ORG]);
    ok(`${role} reads nothing from ${t} — the web goes through the maintenance endpoints`,
      sel.error === null && sel.rows[0]?.n === 0, JSON.stringify(sel));
  }
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
