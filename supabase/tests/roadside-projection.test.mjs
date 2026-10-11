// FuelGuard — the typed roadside record projected from FMCSA's raw feed (migration 0458,
// INSPECTION-CHALLENGE-PLAN.md IC1b, D-IC7).
//
//   1. TYPED, NEVER FAILING. Dates, levels, flags and counts are typed; a value that does not parse is
//      NULL (an impossible date, a non-numeric id skips its row) and the rest still project.
//   2. UNITS MATCH OUR ROSTER, METHOD RECORDED: vin, then plate + state, then unit number of the right
//      kind; two candidates are `ambiguous`, a wrong-kind hit is `kind_mismatch`, nothing is `none`.
//      Another carrier's truck with the same VIN is never a match. A roster correction re-matches.
//   3. LINKS. A violation names its unit (FMCSA's unit id, else the unit's seq); a driver violation
//      names none; a court result names the violation it decided.
//   4. IDEMPOTENT. A second call with nothing new changes no row.
//   5. VANISHES ARE MARKED, NEVER DELETED: `removed` inside FMCSA's three years, `aged_out` past it;
//      a record that comes back clears both.
//   6. ONE ORG, NO CLIENT PATH.
//
// Run:  node supabase/tests/roadside-projection.test.mjs   (after `pnpm --filter @silvicom/shared build:rn`)
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SUPA = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
/** The SQLSTATE a statement raised, or null when it succeeded. */
const sqlstate = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
};

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
    bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now()
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
// Supabase's real default privileges, installed BEFORE the migrations — full DML granted, RLS is the
// gate. Without this a client "cannot read" for the wrong reason and the lockout below proves nothing.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
ok("0458 present", MIGRATIONS.some((f) => f.startsWith("0458_roadside_projections")));
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────
const ORG = (await one(`insert into organizations (name) values ('Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (name) values ('Other') returning id`)).id;
const USER = (await one(`insert into auth.users (email) values ('safety@x.test') returning id`)).id;
const snap = async (org, dataset, rows) => {
  const keyOf = { "fx4q-ay7w": (p) => p.inspection_id, "876r-jsdb": (p) => p.insp_violation_id,
    "wt8s-2hbx": (p) => p.insp_unit_id, "qbt8-7vic": (p) => `${p.inspection_id}|${p.vioseqnum}|${p.adjseq}` }[dataset];
  return one(`select * from fmcsa_snapshot_record($1, $2, '1864495', $3::jsonb, '{"started_at":"2026-10-11T12:00:00Z","complete":true}'::jsonb)`,
    [org, dataset, JSON.stringify(rows.map((p) => ({ k: keyOf(p), p })))]);
};
const project = (org) => one(`select * from roadside_project($1)`, [org]);
const vehicle = async (org, unit, vin, plate = null, st = null) =>
  (await one(`insert into vehicles (org_id, unit_number, vin, plate, plate_state, tank_capacity_gal) values ($1,$2,$3,$4,$5,150) returning id`, [org, unit, vin, plate, st])).id;
const trailer = async (org, unit, vin, plate = null, st = null) =>
  (await one(`insert into trailers (org_id, unit_number, vin, plate, plate_state) values ($1,$2,$3,$4,$5) returning id`, [org, unit, vin, plate, st])).id;

const T701 = await vehicle(ORG, "701", "3AKJHHDR3SSWA3524", "P1264758", "IL");
const T702 = await vehicle(ORG, "702", "3AKJHHDR3SSWA3999", "P-555 111", "il");
const T703 = await vehicle(ORG, "703", null);
await vehicle(ORG, "704", null, "DUP1", "IN");
await vehicle(ORG, "705", null, "DUP1", "IN");
const R701 = await trailer(ORG, "701", "1UYVS2539EM000001");
await vehicle(OTHER, "999", "1HGOTHER000000001");

const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const insp = (id, o = {}) => ({ inspection_id: String(id), report_number: `R${id}`, report_state: "TN", insp_date: today,
  insp_start_time: "0951", insp_end_time: "1008", insp_level_id: "3", insp_facility: "R", post_acc_ind: "N",
  hazmat_placard_req: "Y", gross_comb_veh_wt: "85051", viol_total: "2", oos_total: "1", driver_oos_total: "0",
  vehicle_oos_total: "1", hazmat_oos_total: "0", change_date: "20261001 1200", ...o });
const unit = (inspId, unitId, o = {}) => ({ inspection_id: String(inspId), insp_unit_id: String(unitId), insp_unit_type_id: "11",
  insp_unit_number: "1", change_date: "20261001 1200", ...o });

const INSPS = [insp(1001), insp(1002, { insp_date: "20260231", insp_level_id: "x" }), insp(1003, { insp_date: "20231001" }),
  insp("ABC")];
const UNITS = [
  unit(1001, 5001, { insp_unit_vehicle_id_number: "3akjhhdr3sswa3524" }),                         // vin
  unit(1001, 5002, { insp_unit_number: "2", insp_unit_type_id: "9", insp_unit_company: "701" }),   // unit number → trailer 701, not truck 701
  unit(1002, 5003, { insp_unit_license: "p555111", insp_unit_license_state: "IL" }),               // plate, normalised
  unit(1002, 5004, { insp_unit_license: "DUP1", insp_unit_license_state: "IN" }),                  // ambiguous
  unit(1003, 5005, { insp_unit_vehicle_id_number: "1UYVS2539EM000001" }),                          // tractor VIN on a trailer record
  unit(1003, 5006, { insp_unit_vehicle_id_number: "1HGOTHER000000001" }),                          // another carrier's truck
];
const VIOLS = [
  { inspection_id: "1001", insp_violation_id: "9001", seq_no: "1", viol_code: "393.75A3-TAOL", part_no: "393", part_no_section: "75",
    insp_viol_unit: "1", insp_unit_id: "5001", insp_violation_category_id: "16", out_of_service_indicator: "Y",
    defect_verification_id: "3", citation_number: "T123", viol_desc: "Tire", change_date: "20261001 1200" },
  { inspection_id: "1001", insp_violation_id: "9002", seq_no: "2", viol_code: "393.9", insp_viol_unit: "2",
    out_of_service_indicator: "N", change_date: "20261001 1200" },
  { inspection_id: "1001", insp_violation_id: "9003", seq_no: "3", viol_code: "395.8", insp_viol_unit: "D",
    out_of_service_indicator: "N", change_date: "20261001 1200" },
];
const CITS = [{ inspection_id: "1001", vioseqnum: "1", adjseq: "1", citation_code: "3", citation_result: "Not Guilty/Dismissed", change_date: "20261002 1200" }];

await snap(ORG, "fx4q-ay7w", INSPS);
await snap(ORG, "wt8s-2hbx", UNITS);
await snap(ORG, "876r-jsdb", VIOLS);
await snap(ORG, "qbt8-7vic", CITS);
let r = await project(ORG);
ok("the first projection writes 3 inspections (the non-numeric id skipped), 6 units, 3 violations, 1 citation",
  r.inspections === 3 && r.units === 6 && r.violations === 3 && r.citations === 1, JSON.stringify(r));

// ── 1. typed, never failing ───────────────────────────────────────────────────────────────────────
const i1 = await one(`select * from roadside_inspections where org_id = $1 and fmcsa_inspection_id = 1001`, [ORG]);
ok("dates, levels, flags and counts are typed", i1.inspection_date instanceof Date && i1.level === 3 && i1.post_accident === false
  && i1.hazmat_placard_required === true && i1.gross_weight_lb === 85051 && i1.vehicle_oos_total === 1 && i1.start_hhmm === "0951",
  JSON.stringify(i1));
const i2 = await one(`select inspection_date, level from roadside_inspections where org_id = $1 and fmcsa_inspection_id = 1002`, [ORG]);
ok("an impossible date (20260231) and a non-numeric level are NULL, and the row still projects", i2 && i2.inspection_date === null && i2.level === null, JSON.stringify(i2));

// ── 2. units match our roster ─────────────────────────────────────────────────────────────────────
const u = async (fid) => one(`select vehicle_id, trailer_id, match_method from roadside_inspection_units where org_id = $1 and fmcsa_unit_id = $2`, [ORG, fid]);
let x = await u(5001);
ok("a VIN matches, whatever its case", x.match_method === "vin" && x.vehicle_id === T701 && x.trailer_id === null, JSON.stringify(x));
x = await u(5002);
ok("a semi-trailer's company number matches trailer 701, never truck 701", x.match_method === "unit_number" && x.trailer_id === R701 && x.vehicle_id === null, JSON.stringify(x));
x = await u(5003);
ok("a plate matches with its state, spaces, dashes and case removed", x.match_method === "plate" && x.vehicle_id === T702, JSON.stringify(x));
x = await u(5004);
ok("two trucks on one plate are ambiguous, and neither is matched", x.match_method === "ambiguous" && x.vehicle_id === null && x.trailer_id === null, JSON.stringify(x));
x = await u(5005);
ok("a tractor whose VIN is on a trailer record is kind_mismatch, never matched to the trailer", x.match_method === "kind_mismatch" && x.trailer_id === null && x.vehicle_id === null, JSON.stringify(x));
x = await u(5006);
ok("another carrier's truck with that VIN is not ours: none", x.match_method === "none" && x.vehicle_id === null, JSON.stringify(x));

// ── 3. links ──────────────────────────────────────────────────────────────────────────────────────
const v = async (fid) => one(`select v.*, u.fmcsa_unit_id from roadside_violations v left join roadside_inspection_units u on u.id = v.unit_id where v.org_id = $1 and v.fmcsa_violation_id = $2`, [ORG, fid]);
x = await v(9001);
ok("a violation names its unit by FMCSA's unit id, typed", x.fmcsa_unit_id === "5001" || x.fmcsa_unit_id === 5001n || Number(x.fmcsa_unit_id) === 5001, JSON.stringify(x, (k, val) => typeof val === "bigint" ? String(val) : val));
ok("...with its code verbatim, OOS flag and citation number", x.viol_code === "393.75A3-TAOL" && x.out_of_service === true && x.citation_number === "T123" && x.category_id === 16);
x = await v(9002);
ok("a violation with no unit id names the unit by its seq on the same inspection", Number(x.fmcsa_unit_id) === 5002);
x = await v(9003);
ok("a driver violation names no unit", x.unit_id === null && x.viol_unit === "D");
const c1 = await one(`select c.citation_code, c.citation_result, v.fmcsa_violation_id from roadside_citations c join roadside_violations v on v.id = c.violation_id where c.org_id = $1`, [ORG]);
ok("a court result names the violation it decided", c1 && Number(c1.fmcsa_violation_id) === 9001 && c1.citation_code === 3, JSON.stringify(c1, (k, val) => typeof val === "bigint" ? String(val) : val));

// ── 4. idempotent, and a roster correction re-matches ─────────────────────────────────────────────
r = await project(ORG);
ok("a second call with nothing new changes no row", r.inspections + r.units + r.violations + r.citations === 0, JSON.stringify(r));
await db.query(`update vehicles set vin = '1HGFIXED000000005' where id = $1`, [T703]);
await snap(ORG, "wt8s-2hbx", [...UNITS, unit(1003, 5007, { insp_unit_vehicle_id_number: "1hgfixed000000005" })]);
r = await project(ORG);
ok("a new unit whose VIN a corrected roster now carries is matched on the next projection", r.units === 1 && (await u(5007)).vehicle_id === T703, JSON.stringify(r));
await db.query(`update vehicles set vin = null where id = $1`, [T701]);
r = await project(ORG);
ok("a VIN removed from the roster un-matches its unit", r.units === 1 && (await u(5001)).match_method === "none", JSON.stringify(r));

// ── 5. vanishes are marked, never deleted ─────────────────────────────────────────────────────────
await snap(ORG, "fx4q-ay7w", [insp(1001)]);
r = await project(ORG);
const gone = (await db.query(`select fmcsa_inspection_id::int as id, vanished_at, vanish_reason from roadside_inspections where org_id = $1 order by 1`, [ORG])).rows;
ok("vanished inspections keep their rows", gone.length === 3, JSON.stringify(gone));
ok("one dated today that disappears is removed", gone.find((g) => g.id === 1002)?.vanish_reason === "removed" && gone.find((g) => g.id === 1002)?.vanished_at !== null);
ok("one past FMCSA's three years is aged_out", gone.find((g) => g.id === 1003)?.vanish_reason === "aged_out");
ok("the one still served is untouched", gone.find((g) => g.id === 1001)?.vanished_at === null);
await snap(ORG, "fx4q-ay7w", INSPS);
await project(ORG);
const back = await one(`select vanished_at, vanish_reason from roadside_inspections where org_id = $1 and fmcsa_inspection_id = 1002`, [ORG]);
ok("a record that comes back clears both", back.vanished_at === null && back.vanish_reason === null, JSON.stringify(back));

// ── 6. one org, no client path ────────────────────────────────────────────────────────────────────
r = await project(OTHER);
ok("projecting another carrier with no feed writes nothing and touches none of ours",
  r.inspections + r.units + r.violations + r.citations === 0 && (await one(`select count(*)::int n from roadside_inspections where org_id = $1`, [ORG])).n === 3);
async function asClient(org, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: USER, org_id: org, user_role: "admin", role: "authenticated" }),
    ]);
    return { rows: (await db.query(sql, params)).rows, error: null };
  } catch (e) {
    return { rows: [], error: e.code ?? String(e.message) };
  } finally {
    await db.exec("rollback");
  }
}
for (const t of ["roadside_inspections", "roadside_inspection_units", "roadside_violations", "roadside_citations"]) {
  const q = await asClient(ORG, `select count(*)::int as n from ${t}`);
  ok(`an admin's browser session reads nothing from ${t} (no client policy)`, q.error === null && q.rows[0].n === 0, JSON.stringify(q));
}
for (const fn of ["public.roadside_project(uuid)", "public.fmcsa_raw_current(uuid, text)"]) {
  const g = await one(`select has_function_privilege('authenticated', $1, 'execute') as a, has_function_privilege('anon', $1, 'execute') as b`, [fn]);
  ok(`no browser session may execute ${fn}`, g.a === false && g.b === false, JSON.stringify(g));
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
