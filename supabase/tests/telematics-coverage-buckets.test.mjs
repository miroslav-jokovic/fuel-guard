// Silvicom 360 — telematics_coverage_buckets matrix (migration 0322, SAM-S5 D-SAM7 / Q-SAM8).
//
// D-SAM7 wants an ALL-TIME telematics coverage denominator on the Dashboard tile. It has been blocked
// twice: first on a permission (Q-SAM7, answered), then on the thing the permission was hiding —
// `readTelematicsCoverage` pages every fill the carrier has ever bought, 1,000 rows at a time,
// SEQUENTIALLY. Measured in production 2026-09-05: 16 round trips over 15,948 rows, on the page every
// authenticated member lands on.
//
// So the counting moved into SQL, and the danger in that move is the one Q-SAM7 rejected its own
// candidate (c) for: a SECOND implementation of the three-state predicate, which reads correctly right
// up until somebody changes one of them. The function avoids it by refusing to know anything — it
// returns a histogram of raw column states and names no bucket (D-AG1; 0289 made the same split, in
// its own words "THIS SUMS. IT DOES NOT DERIVE").
//
// **The property this matrix exists for is that the two paths cannot come apart.** It seeds one
// population, computes coverage BOTH ways — `computeTelematicsCoverage` over the rows, the way the
// paging read does it, and `coverageFromBuckets` over what SQL counted — and asserts they are the same
// object. The shared unit test asserts the same identity in TypeScript alone; this one is what closes
// it across the language boundary, because a Postgres `group by` and a JavaScript `Map` can disagree
// about a month boundary, a null, or a `distinct` in ways neither side can see on its own.
//
// Four more that would fail quietly:
//   1. THE STAMP, NOT THE STATUS. A row with `samsara_recon_status` written and no `samsara_recon_at`
//      is PENDING — 124 of these in production. If SQL collapsed the two columns into one cell, the
//      judge could not tell that row from a reconciled one and the backlog would read as done.
//   2. A HISTOGRAM, NOT A COPY. If the `group by` ever stopped grouping, this would be the paging read
//      with extra steps — correct, and pointless. Asserted as a hard ceiling on the row count.
//   3. THE POPULATION IS `vehicle_id is not null`, the same one the paging read used. A fill with no
//      truck was never a candidate for per-fill telematics, so counting it as uncovered reports a
//      fleet-mapping problem as a collection problem.
//   4. ORG SCOPE, and it must hold with `p_org` OMITTED, because that is the only call a browser can
//      make (D-FC1; three functions shipped unreachable on exactly this in 0258).
//
// Run:  node supabase/tests/telematics-coverage-buckets.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeTelematicsCoverage, coverageFromBuckets } from "../../packages/shared/dist/index.js";

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

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;
const VEH = (await one(
  `insert into vehicles (org_id, unit_number, status, tank_capacity_gal) values ($1,'701','active',150) returning id`, [ORG])).id;
const OTHER_VEH = (await one(
  `insert into vehicles (org_id, unit_number, status, tank_capacity_gal) values ($1,'901','active',150) returning id`, [OTHER])).id;

// ── The fixture ────────────────────────────────────────────────────────────────────────────────
// 2,400 fills across eight months, deterministic from the index so JavaScript can hold the same
// population the database does — which is what makes the comparison below a PARITY assertion rather
// than a restatement of the SQL in a different syntax.
//
// ⚠ The four states are NOT evenly mixed, on purpose. An even mix makes every month look alike, and a
// month-boundary defect or a mis-grouped cell then lands identically everywhere and cancels out of the
// totals. Each month gets a different blend, and January carries most of the 124-row case.
const RECON_AT = "2026-09-02T01:15:00Z";
const rows = [];
for (let i = 0; i < 2400; i++) {
  const month = 1 + (i % 8);                      // 2026-01 … 2026-08
  const day = 1 + (i % 27);
  const fueled_at = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00Z`;
  // The blend rotates with the month, so no two months hold the same proportions.
  const roll = (i + month * 3) % 10;
  let state;
  if (month <= 2 && roll < 2) state = "status_no_stamp"; // the 124-row case, concentrated early
  else if (roll < month) state = "reconciled";
  else if (roll < month + 2) state = "no_data";
  else state = "pending";
  rows.push({
    fueled_at,
    samsara_recon_at: state === "pending" || state === "status_no_stamp" ? null : RECON_AT,
    samsara_recon_status:
      state === "reconciled" ? "success" : state === "no_data" ? "no_data" : state === "status_no_stamp" ? "success" : null,
  });
}

const values = rows.map(
  (r) =>
    `(gen_random_uuid(), '${ORG}', '${r.fueled_at}', '${r.fueled_at.slice(0, 10)}', 'TX', 100, 400, true, '${VEH}', ` +
    `${r.samsara_recon_at ? `'${r.samsara_recon_at}'` : "null"}, ${r.samsara_recon_status ? `'${r.samsara_recon_status}'` : "null"})`,
);
for (let i = 0; i < values.length; i += 400) {
  await db.exec(
    `insert into fuel_transactions (id, org_id, fueled_at, business_date, state, gallons, total_cost, is_canonical, vehicle_id, samsara_recon_at, samsara_recon_status)
     values ${values.slice(i, i + 400).join(",")}`,
  );
}

// Fills with NO truck, and one belonging to another carrier. Neither may reach the figure, and each
// fails differently: the first would report a fleet-mapping problem as a collection problem, the
// second is a tenant leak.
await db.exec(
  `insert into fuel_transactions (id, org_id, fueled_at, business_date, state, gallons, total_cost, is_canonical, vehicle_id, samsara_recon_at, samsara_recon_status)
   values (gen_random_uuid(), '${ORG}', '2026-08-09T12:00:00Z', '2026-08-09', 'TX', 100, 400, true, null, null, null),
          (gen_random_uuid(), '${ORG}', '2026-08-09T12:00:00Z', '2026-08-09', 'TX', 100, 400, true, null, '${RECON_AT}', 'success'),
          (gen_random_uuid(), '${OTHER}', '2026-08-09T12:00:00Z', '2026-08-09', 'TX', 100, 400, true, '${OTHER_VEH}', null, null)`,
);

const toBuckets = (sqlRows) =>
  sqlRows.map((r) => ({ month: r.month, attempted: r.attempted, status: r.status, fills: Number(r.fills) }));

const cells = toBuckets((await db.query(`select * from telematics_coverage_buckets($1)`, [ORG])).rows);

// ── 1. the two paths cannot come apart ─────────────────────────────────────────────────────────
const fromSql = coverageFromBuckets(cells);
const fromRows = computeTelematicsCoverage(rows);
ok(
  "the figure is identical whether TypeScript counted the fills or Postgres did — every total, every month, every percentage",
  JSON.stringify(fromSql) === JSON.stringify(fromRows),
  `\n    sql : ${JSON.stringify(fromSql)}\n    rows: ${JSON.stringify(fromRows)}`,
);
ok("and it is a real population, not an empty one agreeing with itself",
  fromRows.fills === 2400 && fromRows.reconciled > 0 && fromRows.noData > 0 && fromRows.pending > 0 && fromRows.byMonth.length === 8,
  JSON.stringify({ fills: fromRows.fills, months: fromRows.byMonth.length }));

// ── 2. the stamp, not the status ───────────────────────────────────────────────────────────────
// If SQL returned one collapsed cell per (month, status), this row would be indistinguishable from a
// reconciled one and the backlog would read as done.
const statusNoStamp = cells.filter((c) => !c.attempted && c.status === "success");
ok("a status written with no stamp survives as its own cell, so the judge can still call it pending",
  statusNoStamp.length > 0 && statusNoStamp.every((c) => c.fills > 0),
  JSON.stringify(statusNoStamp));
ok("…and the judge does call it pending",
  coverageFromBuckets(statusNoStamp).pending === statusNoStamp.reduce((n, c) => n + c.fills, 0) &&
    coverageFromBuckets(statusNoStamp).reconciled === 0);

// ── 3. a histogram, not a copy ─────────────────────────────────────────────────────────────────
// The whole reason one round trip replaces sixteen. 8 months x 2 x 3 statuses bounds this at 48.
ok(`2,400 fills collapse to ${cells.length} cells — the bound is months x 2 x statuses, not row count`,
  cells.length <= 48 && cells.length >= 8, `${cells.length}`);
ok("every fill is accounted for in some cell",
  cells.reduce((n, c) => n + c.fills, 0) === 2400, `${cells.reduce((n, c) => n + c.fills, 0)}`);

// ── 4. the population is the paging read's population ──────────────────────────────────────────
// Two unattributed fills were inserted above; if either reached the histogram the total would be 2402.
ok("a fill with no truck is not counted as uncovered — it was never a candidate for telematics",
  cells.reduce((n, c) => n + c.fills, 0) === 2400);

// ── 5. the month is UTC, and a session in another zone does not move it ────────────────────────
// ⚠ This case exists because the mutation that swapped `at time zone 'utc'` for plain `to_char`
// PASSED everything above: PGlite runs in UTC, so the fixture could not tell the two apart, and
// neither could production until somebody set a session zone. `monthKey` in shared reads
// `getUTCMonth()` deliberately — this measures a COLLECTOR, and what it collected against is the
// instant Samsara serves history for, not the day a carrier books — so a fill two hours into a UTC
// month must stay in that month whoever is asking.
await db.exec(
  `insert into fuel_transactions (id, org_id, fueled_at, business_date, state, gallons, total_cost, is_canonical, vehicle_id, samsara_recon_at, samsara_recon_status)
   select gen_random_uuid(), '${ORG}', '2026-03-01T02:00:00Z', '2026-02-28', 'TX', 100, 400, true, '${VEH}', '${RECON_AT}', 'success'
     from generate_series(1, 5)`,
);
const utcMonthOf = async (zone) => {
  await db.exec("begin");
  await db.exec(`set local time zone '${zone}'`);
  const cell = toBuckets((await db.query(`select * from telematics_coverage_buckets($1)`, [ORG])).rows);
  await db.exec("rollback");
  return coverageFromBuckets(cell).byMonth.find((m) => m.month === "2026-03")?.fills ?? 0;
};
const inUtc = await utcMonthOf("UTC");
const inChicago = await utcMonthOf("America/Chicago"); // 2026-03-01T02:00Z is 2026-02-28 there
ok("a fill two hours into a UTC month stays in that month for a session in another zone",
  inUtc === inChicago && inUtc > 0, `utc ${inUtc} vs chicago ${inChicago}`);

// ── 6. org scope, including the only call a browser can make ───────────────────────────────────
const otherCells = toBuckets((await db.query(`select * from telematics_coverage_buckets($1)`, [OTHER])).rows);
ok("another carrier's fills are not in this carrier's figure",
  otherCells.reduce((n, c) => n + c.fills, 0) === 1, JSON.stringify(otherCells));

const USER = (await one(`insert into auth.users (email) values ('ops@silvicom.test') returning id`)).id;
// Read NOW rather than reusing `fromSql` above — rows have been added since, and an assertion that
// quietly compares two different populations is the kind that passes forever. Taken before the
// transaction: `set_config(..., true)` leaves the claim as an empty string on rollback, and
// `auth_org_id()` casts that to jsonb without a guard.
const explicit = toBuckets((await db.query(`select * from telematics_coverage_buckets($1)`, [ORG])).rows);
await db.exec("begin");
await db.exec("set local role authenticated");
await db.query("select set_config('request.jwt.claims', $1, true)", [
  JSON.stringify({ sub: USER, org_id: ORG, user_role: "admin", role: "authenticated" }),
]);
// ⚠ p_org OMITTED — the form PostgREST resolves for a browser. A function that only works when the
// argument is supplied positionally is dead on arrival for the client and green in every test (0258).
const asBrowser = toBuckets((await db.query(`select * from telematics_coverage_buckets()`)).rows);
await db.exec("rollback");
ok("a signed-in member gets their OWN carrier's histogram with p_org omitted, which is the only call the browser can make",
  JSON.stringify(coverageFromBuckets(asBrowser)) === JSON.stringify(coverageFromBuckets(explicit)),
  `${asBrowser.length} cells vs ${explicit.length}`);

// ── 7. `security invoker` means a driver's figure is a driver's fills ───────────────────────────
// Not a defect, and worth pinning rather than discovering. `ftxn_driver_select` restricts a driver to
// their own fills, and the Dashboard — where D-SAM7 puts this number — is `requiresAuth` with no
// section gate, so a driver can open it. Because the function runs as the CALLER, the all-time
// denominator is scoped exactly like the windowed `coveragePct` it sits beside, which
// `aggregateDashboard` also reads under RLS. Two figures on one tile, both "of the fills you can
// see". `security definer` here would have made the pair disagree for exactly one role.
const DRV_USER = (await one(`insert into auth.users (email) values ('dave@silvicom.test') returning id`)).id;
const DRV = (await one(
  `insert into drivers (org_id, user_id, full_name, status) values ($1,$2,'Dave','active') returning id`,
  [ORG, DRV_USER])).id;
await db.query(
  `update fuel_transactions set driver_id = $1
    where org_id = $2 and vehicle_id is not null and extract(month from fueled_at) = 3`, [DRV, ORG]);
const marchFills = Number((await one(
  `select count(*)::int as n from fuel_transactions where driver_id = $1`, [DRV])).n);

await db.exec("begin");
await db.exec("set local role authenticated");
await db.query("select set_config('request.jwt.claims', $1, true)", [
  JSON.stringify({ sub: DRV_USER, org_id: ORG, user_role: "driver", role: "authenticated" }),
]);
const asDriver = toBuckets((await db.query(`select * from telematics_coverage_buckets()`)).rows);
await db.exec("rollback");
const driverTotal = coverageFromBuckets(asDriver).fills;
ok("a driver's coverage covers a driver's fills — neither the whole fleet nor nothing at all",
  driverTotal === marchFills && marchFills > 0 && marchFills < 2400,
  `${driverTotal} vs ${marchFills} of 2400`);

await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
