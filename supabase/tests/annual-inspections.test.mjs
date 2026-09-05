// Silvicom 360 — the §396.17 annual vehicle inspection, at the RLS and trigger layer (0280).
//
// D-AVI4/D-AVI6/D-AVI11, docs/plans/maintenance/ANNUAL-INSPECTION-PLAN.md step A3.
//
// Two rules carry this feature's weight and NEITHER can be expressed by a policy, so neither is
// covered by rls.test.mjs:
//
//   1. A finalized report is evidence. §396.21(b) makes it producible on demand to a federal, state
//      or local official for fourteen months, so it is frozen the moment it is certified. RLS
//      compares a row to a predicate and never OLD to NEW, and the API reads with the service role
//      which bypasses RLS outright — so the rule is a trigger, and a trigger is only as real as the
//      test that fires it. Asserted here AS THE SERVICE ROLE as well as as a user, because the
//      service role is the writer that would otherwise walk straight through.
//
//   2. The shape constraint. "status = final with outcome null" is a report that certifies nothing
//      while looking certified. It must be unreachable by ANY writer, which is why it is a check
//      constraint rather than a guard in the finalize service.
//
// The new `technician` role (0279) is pinned in both directions in the same file, for the reason
// the equipment-split matrix gives: a test proving only the grant would pass just as happily if the
// role had also been handed the roster, and that leak is worse than the gap it closes.
//
// Run:  node supabase/tests/annual-inspections.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
// Every migration, discovered — never a hand-picked list, or the matrix silently stops covering
// whatever landed after somebody wrote the list.
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0,
  fail = 0;
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
// Supabase's real default privileges, installed BEFORE the migrations run, so RLS is provably the
// only gate. Without this a passing refusal would prove a missing GRANT, not a policy.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ACTOR = "00000000-0000-4000-8000-000000000001";
await db.query(`insert into auth.users (id, email) values ($1, 'tester@example.com')`, [ACTOR]);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'T') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;
const VEHICLE = (await one(
  `insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,'654',150) returning id`, [ORG])).id;
const TRAILER = (await one(`insert into trailers (org_id, unit_number) values ($1,'T-1') returning id`, [ORG])).id;

const INSPECTOR = (await one(
  `insert into maintenance_inspectors (org_id, full_name, qualification_basis, brake_qualified, effective_from)
   values ($1,'George Gacev','training_and_experience',true,'2024-01-01') returning id`, [ORG])).id;

/** Insert a report directly (service role), returning its id. */
async function seedReport({ org = ORG, subject = VEHICLE, subjectType = "tractor", status = "draft", on = "2026-06-16", decalSerial = null } = {}) {
  const final = status === "final";
  const row = await one(
    `insert into vehicle_inspections
       (id, org_id, subject_type, subject_id, inspector_id, inspected_on, catalogue_version,
        decal_serial, status, outcome, next_due_on, finalized_at)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, '1.0.0', $6, $7, $8, $9, $10)
     returning id`,
    [org, subjectType, subject, INSPECTOR, on, decalSerial, status,
     final ? "pass" : null, final ? "2027-06-16" : null, final ? new Date("2026-06-16T12:00:00Z") : null],
  );
  return row.id;
}

async function as(role, sql, params = [], org = ORG) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ACTOR, org_id: org, user_role: role, role: "authenticated" }),
    ]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return res;
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}
/**
 * An UPDATE refused by RLS affects ZERO ROWS; an INSERT refused by RLS RAISES. The two need
 * different assertions, and conflating them is how a matrix "proves" a refusal that never happened
 * — or, as here on the first run, reports six failures against policies that were working
 * perfectly. `affected` is for updates; `blocked` accepts either signal and is for inserts.
 */
const affected = async (role, sql, params, org) => {
  const res = await as(role, sql, params, org);
  return res.error ? `ERROR: ${res.error}` : res.affectedRows ?? 0;
};
const blocked = async (role, sql, params, org) => {
  const res = await as(role, sql, params, org);
  if (res.error) return /row-level security|violates row-level/i.test(res.error);
  return (res.affectedRows ?? 0) === 0;
};
const counted = async (role, sql, params = [], org = ORG) => {
  const res = await as(role, sql, params, org);
  return res.error ? `ERROR: ${res.error}` : Number(res.rows[0].n);
};
/** Run as the SERVICE ROLE — the writer that bypasses RLS and that only a trigger can stop. */
async function asService(sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role service_role");
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return res;
  } catch (e) {
    await db.exec("rollback");
    return { error: e.message };
  }
}

const DRAFT = await seedReport();
const FINAL = await seedReport({ status: "final" });

// ── 1. A finalized report is frozen, INCLUDING against the service role (D-AVI4) ────────────────
{
  const r = await asService(`update vehicle_inspections set other_conditions = 'edited' where id = $1`, [FINAL]);
  ok("service role CANNOT edit a finalized report — the trigger, not RLS, is what stops it",
     typeof r.error === "string" && /finalized .* report is evidence|cannot be edited/.test(r.error), JSON.stringify(r));
}
{
  const r = await asService(`update vehicle_inspections set outcome = 'pass' where id = $1`, [FINAL]);
  ok("service role cannot flip a finalized outcome either", typeof r.error === "string", JSON.stringify(r));
}
{
  const r = await asService(`update vehicle_inspections set other_conditions = 'edited' where id = $1`, [DRAFT]);
  ok("a DRAFT is still editable — the trigger's WHEN clause does not fire on one", r.affectedRows === 1, JSON.stringify(r));
}
{
  // Editing the components of a certified report would change what it says without touching it.
  await db.query(
    `insert into vehicle_inspection_items (org_id, inspection_id, item_key, result) values ($1,$2,'brake.hose','ok')`,
    [ORG, FINAL]);
  const r = await asService(
    `update vehicle_inspection_items set result = 'needs_repair' where inspection_id = $1`, [FINAL]);
  ok("service role cannot edit the components of a finalized report", typeof r.error === "string", JSON.stringify(r));
}

// ── 2. The shape constraint — "final but certifying nothing" is unreachable ──────────────────────
{
  const r = await asService(
    `insert into vehicle_inspections (id, org_id, subject_type, subject_id, inspector_id, inspected_on, catalogue_version, status)
     values (gen_random_uuid(), $1, 'tractor', $2, $3, '2026-06-16', '1.0.0', 'final')`, [ORG, VEHICLE, INSPECTOR]);
  ok("a final report with no outcome is rejected by the database, not by the service",
     typeof r.error === "string" && /vehicle_inspections_shape/.test(r.error), JSON.stringify(r));
}
{
  const r = await asService(
    `insert into vehicle_inspections (id, org_id, subject_type, subject_id, inspector_id, inspected_on, catalogue_version, status, outcome, next_due_on, finalized_at)
     values (gen_random_uuid(), $1, 'tractor', $2, $3, '2026-06-16', '1.0.0', 'draft', 'pass', '2027-06-16', now())`,
    [ORG, VEHICLE, INSPECTOR]);
  ok("a draft carrying a verdict is rejected too — the constraint holds in both directions",
     typeof r.error === "string" && /vehicle_inspections_shape/.test(r.error), JSON.stringify(r));
}
{
  const r = await asService(
    `insert into vehicle_inspection_items (org_id, inspection_id, item_key, result, repaired_at)
     values ($1,$2,'brake.tubing','ok','2026-06-17')`, [ORG, DRAFT]);
  ok("a repair date on a component that did not need repair is rejected",
     typeof r.error === "string" && /repair_date/.test(r.error), JSON.stringify(r));
}
{
  await db.query(`insert into vehicle_inspection_items (org_id, inspection_id, item_key, result) values ($1,$2,'wheels.welds','na')`, [ORG, DRAFT]);
  const r = await asService(
    `insert into vehicle_inspection_items (org_id, inspection_id, item_key, result) values ($1,$2,'wheels.welds','ok')`, [ORG, DRAFT]);
  ok("the same component cannot be answered twice on one report", typeof r.error === "string", JSON.stringify(r));
}
{
  await db.query(`update vehicle_inspections set decal_serial = '610641628' where id = $1`, [DRAFT]);
  const r = await asService(`update vehicle_inspections set decal_serial = '610641628' where id = $1`, [
    await seedReport({ decalSerial: null }),
  ]);
  ok("one §396.17(c)(2) decal cannot be recorded against two reports — a reused decal would put proof of an inspection on a truck that never had one", typeof r.error === "string", JSON.stringify(r));
}

// ── 3. The `technician` role, both directions (0279, D-AVI11) ───────────────────────────────────
const NEW_REPORT = `insert into vehicle_inspections (id, org_id, subject_type, subject_id, inspector_id, inspected_on, catalogue_version)
                    values (gen_random_uuid(), $1, 'tractor', $2, $3, '2026-07-01', '1.0.0')`;
ok("technician creates an inspection", (await affected("technician", NEW_REPORT, [ORG, VEHICLE, INSPECTOR])) === 1);
ok("technician edits a draft", (await affected("technician", `update vehicle_inspections set other_conditions='x' where id=$1`, [DRAFT])) === 1);
ok("technician registers an inspector",
   (await affected("technician",
     `insert into maintenance_inspectors (org_id, full_name, qualification_basis, effective_from) values ($1,'B','state_federal_program','2026-01-01')`,
     [ORG])) === 1);
ok("technician reads the reports", (await counted("technician", `select count(*) n from vehicle_inspections`)) >= 1);

// ...and nothing else. The leak this guards is the one the recruiter role taught: a role that
// widens later, unnoticed, because only its grant was ever asserted.
ok("technician still cannot write a vehicle (equipment: view, D-ROS12's argument)",
   (await affected("technician", `update vehicles set plate='XYZ' where id=$1`, [VEHICLE])) === 0);
ok("technician cannot read a driver (roster: none — an inspector inspects machines)",
   (await counted("technician", `select count(*) n from drivers`)) === 0);
ok("technician can still SEE the truck they are inspecting",
   (await counted("technician", `select count(*) n from vehicles`)) === 1);

// ── 4. Who else may act ─────────────────────────────────────────────────────────────────────────
for (const role of ["admin", "fleet_manager"]) {
  ok(`${role} creates an inspection`, (await affected(role, NEW_REPORT, [ORG, VEHICLE, INSPECTOR])) === 1);
}
for (const role of ["auditor", "accountant"]) {
  ok(`${role} reads inspections (a DOT audit and the repair ledger are both legitimate readers)`,
     (await counted(role, `select count(*) n from vehicle_inspections`)) >= 1);
  ok(`${role} cannot create one`, await blocked(role, NEW_REPORT, [ORG, VEHICLE, INSPECTOR]));
}
for (const role of ["dispatcher", "recruiter", "driver", "safety_manager"]) {
  ok(`${role} cannot read inspections`, (await counted(role, `select count(*) n from vehicle_inspections`)) === 0);
  ok(`${role} cannot create one`, await blocked(role, NEW_REPORT, [ORG, VEHICLE, INSPECTOR]));
}

// ── 5. Tenancy ──────────────────────────────────────────────────────────────────────────────────
ok("another org sees none of these reports",
   (await counted("admin", `select count(*) n from vehicle_inspections`, [], OTHER_ORG)) === 0);
ok("another org sees no inspectors",
   (await counted("admin", `select count(*) n from maintenance_inspectors`, [], OTHER_ORG)) === 0);
ok("a report cannot be walked into another tenant by an update (0161's invariant)",
   typeof (await asService(`update vehicle_inspections set org_id = $1 where id = $2`, [OTHER_ORG, DRAFT])).error === "string");
{
  const r = await asService(
    `insert into vehicle_inspection_items (org_id, inspection_id, item_key, result) values ($1,$2,'frame.members','ok')`,
    [ORG, "00000000-0000-4000-8000-00000000dead"]);
  ok("a component cannot reference a report that does not exist", typeof r.error === "string");
}

// ── 6. Evidence outlives the equipment, and the inspector outlives nothing ───────────────────────
{
  // §396.21(b) counts fourteen months from the inspection, not from the fleet's current roster —
  // a tractor sold in March does not retroactively un-inspect itself in February.
  const T = await seedReport({ subject: TRAILER, subjectType: "trailer" });
  await db.query(`delete from trailers where id = $1`, [TRAILER]);
  ok("a report survives the deletion of the equipment it describes (no FK on subject_id)",
     Number((await one(`select count(*) n from vehicle_inspections where id = $1`, [T])).n) === 1);
}
{
  const r = await asService(`delete from maintenance_inspectors where id = $1`, [INSPECTOR]);
  ok("an inspector who has signed a report cannot be deleted (§396.21(a)(1) — retire them instead)",
     typeof r.error === "string", JSON.stringify(r));
}

// ── 7. Printer calibration (0283, D-AVI8) ───────────────────────────────────────────────────────
{
  const NEW_PROFILE = `insert into maintenance_print_profiles (org_id, name, offset_x_pt, offset_y_pt)
                       values ($1, 'Shop laser', 1.5, -2.25)`;
  ok("technician saves a printer offset", (await affected("technician", NEW_PROFILE, [ORG])) === 1);
  ok("auditor cannot", await blocked("auditor", NEW_PROFILE, [ORG]));
  ok("dispatcher cannot even read the profiles",
     (await counted("dispatcher", `select count(*) n from maintenance_print_profiles`)) === 0);
}
{
  await db.query(`insert into maintenance_print_profiles (org_id, name, offset_x_pt, offset_y_pt)
                  values ($1, 'Front office', 0, 0)`, [ORG]);
  const r = await asService(`insert into maintenance_print_profiles (org_id, name) values ($1, 'Front office')`, [ORG]);
  ok("two printers in one org cannot share a name — that is how you pick the wrong one",
     typeof r.error === "string", JSON.stringify(r));
}
{
  // A real misfeed is millimetres. An inch is already past anything worth correcting, and the bound
  // turns a typo into a refusal rather than a page printed off the paper.
  const r = await asService(
    `insert into maintenance_print_profiles (org_id, name, offset_x_pt) values ($1, 'Typo', 400)`, [ORG]);
  ok("an offset beyond an inch is refused", typeof r.error === "string", JSON.stringify(r));
}
{
  const r = await asService(
    `update maintenance_print_profiles set org_id = $1 where name = 'Front office'`, [OTHER_ORG]);
  ok("a printer cannot be walked into another tenant (0161's invariant)", typeof r.error === "string");
}

await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
