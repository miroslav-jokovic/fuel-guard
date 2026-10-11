// FuelGuard — fuel_recon_run_rows matrix (migration 0406, FS3).
//
// A reconciliation's LINES — the bill line and our fill beside it — kept with the run, so the Pilot
// invoices page can open a saved check and show what was found rather than only how many. They are
// evidence on the same terms as the run (0249), and four properties would fail quietly:
//
//   1. APPEND-ONLY AND UNDELETABLE, INCLUDING FOR THE SERVICE ROLE. Lines the API can rewrite after the
//      fact are not a record of what the run concluded.
//   2. ONE ORG. The lines and their run must belong to the same carrier: a row filed under org A that
//      points at org B's run would show B's billing dispute to A.
//   3. NO CLIENT WRITE PATH (D-FX1). A browser that can insert lines can assert a discrepancy.
//   4. ORG SCOPE ON READ.
//
// Run:  node supabase/tests/fuel-recon-run-rows.test.mjs
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
// gate. Without this a client "cannot insert" for the wrong reason and the test proves nothing.
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

/** The verdict shape `ReconSummary` produces, with the real 2026-08-17 week's figures. */
const insertRun = async (org) =>
  (await one(
    `insert into fuel_recon_runs
       (org_id, source_kind, period_start, period_end, tol_gallons, tol_amount_abs, tol_amount_pct,
        max_day_drift, matcher_version, summary)
     values ($1, 'weekly_statement', '2026-08-17', '2026-08-23', 1, 1, 0.01, 1, 'f4', '{}'::jsonb)
     returning id`,
    [org],
  )).id;

/** One clean row and one bill line we never recorded, in `ReconRow`'s shape. */
const ROWS = JSON.stringify([
  { status: "clean", tank: "tractor", basis: "card6", gallonsDelta: 0, amountDelta: 0, dayDelta: 0, note: null,
    report: { authNo: "a1", unit: "701", cardRef: "367971", gallons: 100, netAmount: 400 },
    system: { id: "s1", unit: "701", cardRef: "367971", gallons: 100, totalCost: 400 } },
  { status: "missing_in_system", tank: "tractor", basis: null, gallonsDelta: null, amountDelta: null, dayDelta: null, note: null,
    report: { authNo: "a2", unit: "702", cardRef: "317971", gallons: 50, netAmount: 242.11 }, system: null },
]);
const insertRows = (org, run, rows = ROWS) =>
  sqlstate(`insert into fuel_recon_run_rows (run_id, org_id, rows) values ($1, $2, $3::jsonb)`, [run, org, rows]);

const R1 = await insertRun(ORG);
ok("the service role records a run's lines", (await insertRows(ORG, R1)) === null);
ok(
  "they read back whole, in the matcher's order",
  (await one(`select rows->1->>'status' s, jsonb_array_length(rows) n from fuel_recon_run_rows where run_id = $1`, [R1])).s === "missing_in_system",
);
ok(
  "and `unmatchable` defaults to an empty list rather than null",
  (await one(`select unmatchable from fuel_recon_run_rows where run_id = $1`, [R1])).unmatchable.length === 0,
);

// ── 1. append-only and undeletable ──────────────────────────────────────────────────────────────
ok(
  "a run's lines cannot be edited, even by the service role that wrote them",
  (await sqlstate(`update fuel_recon_run_rows set rows = '[]'::jsonb where run_id = $1`, [R1])) === "FR012",
);
ok(
  "nor deleted",
  (await sqlstate(`delete from fuel_recon_run_rows where run_id = $1`, [R1])) === "FR012",
);
ok(
  "nor deleted in bulk by a retention sweep",
  (await sqlstate(`delete from fuel_recon_run_rows where org_id = $1`, [ORG])) === "FR012",
);
ok(
  "a run holds ONE set of lines — a second write is refused, not appended",
  (await insertRows(ORG, R1)) === "23505",
);

// ── 2. one org ──────────────────────────────────────────────────────────────────────────────────
const RO = await insertRun(OTHER);
ok(
  "lines cannot be filed under one carrier against another carrier's run",
  (await insertRows(ORG, RO)) === "23503",
);
ok(
  "nor against a run that does not exist",
  (await insertRows(ORG, "00000000-0000-4000-8000-0000000000aa")) === "23503",
);

// ── shape ───────────────────────────────────────────────────────────────────────────────────────
const R2 = await insertRun(ORG);
ok("lines must be a list, not one object", (await insertRows(ORG, R2, '{"status":"clean"}')) === "23514");
ok(
  "the set-aside lines must be a list too",
  (await sqlstate(`insert into fuel_recon_run_rows (run_id, org_id, rows, unmatchable) values ($1, $2, '[]', '{}'::jsonb)`, [R2, ORG])) === "23514",
);

// ── 3. no client write (D-FX1) ──────────────────────────────────────────────────────────────────
async function asClient(org, role, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: "00000000-0000-4000-8000-000000000001", org_id: org, user_role: role, role: "authenticated" }),
    ]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return { rows: res.rows, error: null };
  } catch (e) {
    await db.exec("rollback");
    return { rows: [], error: e.code ?? String(e.message) };
  }
}
for (const role of ["admin", "fleet_manager", "dispatcher"]) {
  const r = await asClient(ORG, role, `insert into fuel_recon_run_rows (run_id, org_id, rows) values ($1, $2, '[]'::jsonb)`, [R2, ORG]);
  ok(`a ${role} cannot write a run's lines from the browser`, r.error === "42501", JSON.stringify(r));
}

// ── 4. org scope on read ────────────────────────────────────────────────────────────────────────
ok("the other carrier records lines for its own run", (await insertRows(OTHER, RO)) === null);
const mine = await asClient(ORG, "admin", `select count(*)::int as n from fuel_recon_run_rows`);
ok("a member reads only their own carrier's lines", mine.rows[0]?.n === 1, JSON.stringify(mine));
const theirs = await asClient(OTHER, "admin", `select run_id from fuel_recon_run_rows`);
ok("and the other carrier reads only theirs", theirs.rows.length === 1 && theirs.rows[0].run_id === RO, JSON.stringify(theirs));

await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
