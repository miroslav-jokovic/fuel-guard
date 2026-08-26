// FuelGuard — fuel_recon_runs matrix (migration 0249).
//
// A reconciliation run is EVIDENCE: what we concluded about a vendor's bill on a date, with the
// tolerances and the inputs that produced it. Four of its properties fail quietly, and each one
// destroys a different guarantee:
//
//   1. APPEND-ONLY, INCLUDING FOR THE SERVICE ROLE. A finding that the API which wrote it can quietly
//      rewrite is not evidence of anything. The trigger deliberately does NOT exempt
//      `auth_role() is null` — this is the EI010/DA010 family, not 0213's prunable style.
//   2. UNDELETABLE. `fuel_recon_runs` is pinned in RETENTION_FORBIDDEN, and the guarantee has to hold
//      in the database rather than in a list a future sweep might not read.
//   3. NO CLIENT WRITE PATH. The browser decodes bytes; the server concludes (D-FX1). A client that
//      can insert a run can assert a discrepancy that no parser ever produced.
//   4. ORG SCOPE ON READ. Another carrier's reconciliation is another carrier's billing dispute.
//
// Run:  node supabase/tests/fuel-recon-runs.test.mjs
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
const SUMMARY = JSON.stringify({
  reportLines: 502, systemFills: 506, clean: 495, amountMismatch: 0, gallonMismatch: 0,
  amountUnknown: 0, dateDrift: 4, cardDrift: 0, missingInSystem: 1, missingOnReport: 7, other: 2,
  matchedOnCard6: 501, matchedOnCard4: 0, matchedOnDateGallons: 0,
  exposure: {
    overbilled: 55.12, overbilledLines: 1, underbilled: 54.30, underbilledLines: 1,
    unbilled: 2334.06, unbilledLines: 7, unrecorded: 242.11, unrecordedLines: 1,
  },
});

const insertRun = async (org, opts = {}) =>
  (await one(
    `insert into fuel_recon_runs
       (org_id, source_kind, source_filename, source_sha256, invoice_no, period_start, period_end,
        tie_out_gated, tie_out_notes, tol_gallons, tol_amount_abs, tol_amount_pct, max_day_drift,
        matcher_version, summary, unmatchable_lines)
     values ($1, $2, 'db139445F.pdf', $3, '795506105', '2026-08-17', '2026-08-23',
             true, '{}', 1.0, 1.0, 0.01, 1, 'f4', $4::jsonb, 347)
     returning id`,
    [org, opts.kind ?? "weekly_statement", opts.sha ?? "abc123", SUMMARY],
  )).id;

const R1 = await insertRun(ORG);

// ── 1. append-only ──────────────────────────────────────────────────────────────────────────────
ok(
  "the verdict cannot be edited in place",
  (await sqlstate(`update fuel_recon_runs set summary = '{"clean":0}'::jsonb where id = $1`, [R1])) === "FR010",
);
ok(
  "nor the tolerances it was reconciled at",
  (await sqlstate(`update fuel_recon_runs set tol_amount_abs = 99 where id = $1`, [R1])) === "FR010",
);
ok(
  "nor the period, nor the file it came from",
  (await sqlstate(`update fuel_recon_runs set period_end = '2026-09-30', source_sha256 = 'tampered' where id = $1`, [R1])) === "FR010",
);
ok(
  "nor the claim that a tie-out gate ran at all",
  (await sqlstate(`update fuel_recon_runs set tie_out_gated = false where id = $1`, [R1])) === "FR010",
);

// A correction is a NEW run that supersedes — the same mechanism `fuel_statements` uses.
const R2 = await insertRun(ORG, { sha: "def456" });
ok(
  "superseding is allowed — that is the correction mechanism",
  (await sqlstate(`update fuel_recon_runs set superseded_by = $1, superseded_at = now() where id = $2`, [R2, R1])) === null,
);
ok(
  "the superseded run is still there, with its verdict intact",
  (await one(`select summary->>'clean' as c from fuel_recon_runs where id = $1`, [R1])).c === "495",
);
ok(
  "a superseded run is frozen — it cannot be re-pointed at another replacement",
  (await sqlstate(`update fuel_recon_runs set superseded_by = $1, superseded_at = now() where id = $2`, [R2, R1])) === "FR010",
);

// ── 2. undeletable, and by everyone ─────────────────────────────────────────────────────────────
// The service role BYPASSES RLS, so a policy cannot express this. The trigger has to, and it must not
// exempt `auth_role() is null` the way an operational table's would.
ok(
  "a run cannot be deleted, even by the service role that wrote it",
  (await sqlstate(`delete from fuel_recon_runs where id = $1`, [R1])) === "FR011",
);
ok(
  "and not in bulk either — a retention sweep cannot erase the record that a finding was made",
  (await sqlstate(`delete from fuel_recon_runs where org_id = $1`, [ORG])) === "FR011",
);

// ── 3. the browser cannot assert a finding (D-FX1) ──────────────────────────────────────────────
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
  const r = await asClient(ORG, role, `insert into fuel_recon_runs
      (org_id, source_kind, period_start, period_end, tol_gallons, tol_amount_abs, tol_amount_pct,
       max_day_drift, matcher_version, summary)
    values ($1,'weekly_statement','2026-08-17','2026-08-23',1,1,0.01,1,'x','{}'::jsonb)`, [ORG]);
  ok(`a ${role} cannot insert a reconciliation from the browser`, r.error === "42501");
}

// ── 4. org scope on read ────────────────────────────────────────────────────────────────────────
await insertRun(OTHER, { sha: "other1" });
const mine = await asClient(ORG, "admin", `select count(*)::int as n from fuel_recon_runs`);
ok("a member reads only their own carrier's reconciliations", mine.rows[0]?.n === 2, JSON.stringify(mine));
const theirs = await asClient(OTHER, "admin", `select count(*)::int as n from fuel_recon_runs`);
ok("and the other carrier reads only theirs", theirs.rows[0]?.n === 1, JSON.stringify(theirs));

// ── 5. the shape the surface depends on ─────────────────────────────────────────────────────────
ok(
  "a run must name the period it covers, and it cannot end before it starts",
  (await sqlstate(`insert into fuel_recon_runs
      (org_id, source_kind, period_start, period_end, tol_gallons, tol_amount_abs, tol_amount_pct,
       max_day_drift, matcher_version, summary)
    values ($1,'weekly_statement','2026-08-23','2026-08-17',1,1,0.01,1,'x','{}'::jsonb)`, [ORG])) === "23514",
);
ok(
  "an unknown source kind is refused rather than stored",
  (await sqlstate(`insert into fuel_recon_runs
      (org_id, source_kind, period_start, period_end, tol_gallons, tol_amount_abs, tol_amount_pct,
       max_day_drift, matcher_version, summary)
    values ($1,'guesswork','2026-08-17','2026-08-23',1,1,0.01,1,'x','{}'::jsonb)`, [ORG])) === "23514",
);
// A statement can be pruned; the finding ABOUT it must survive that, pointing at nothing rather than
// vanishing with it.
const STMT = (await one(
  `insert into fuel_statements (org_id, vendor, account_no, invoice_no, period_start, period_end,
     total_gallons, fuel_amount, invoice_total, retail_total, savings, line_count, source_format)
   values ($1,'pilot','139445','795506105','2026-08-17','2026-08-23',60888,316686.78,316797.34,347879.44,31082.10,849,'pdf_statement')
   returning id`, [ORG])).id;
const R3 = await insertRun(ORG, { sha: "linked" });
ok(
  "linking a run to its statement is itself append-only — it is set at insert, never patched later",
  (await sqlstate(`update fuel_recon_runs set statement_id = $1 where id = $2`, [STMT, R3])) === "FR010",
);
const R4 = (await one(
  `insert into fuel_recon_runs
     (org_id, source_kind, statement_id, period_start, period_end, tol_gallons, tol_amount_abs,
      tol_amount_pct, max_day_drift, matcher_version, summary)
   values ($1,'weekly_statement',$2,'2026-08-17','2026-08-23',1,1,0.01,1,'f4','{}'::jsonb) returning id`,
  [ORG, STMT])).id;
ok("a run set at insert does carry its statement", (await one(`select statement_id from fuel_recon_runs where id=$1`, [R4])).statement_id === STMT);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
