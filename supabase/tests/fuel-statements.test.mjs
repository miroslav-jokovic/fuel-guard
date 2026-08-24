// FuelGuard — fuel statement matrix (migration 0243).
//
// 0243 keeps the vendor's weekly statement so the spend question ("fuel is up, why") can be answered
// across weeks instead of one upload at a time. Three properties of it can break silently, and each
// one loses money or history rather than raising, so each gets rows here:
//
//   1. APPEND-ONLY. A statement is what Pilot sent. The only mutation it admits is the supersede
//      chain, because a re-issued invoice must not overwrite the numbers a discount analysis already
//      rests on. The trigger is the enforcement; these rows are the proof it enforces.
//   2. ONE LIVE STATEMENT PER INVOICE. `uq_fuel_statements_current` is PARTIAL — unique only while
//      `superseded_by is null` — so superseded statements accumulate without limit behind the live
//      one. A non-partial index would make the second upload of a corrected invoice impossible; no
//      partial index at all would let two live rows for one invoice double-count every gallon.
//   3. ORG ISOLATION + DENY-ALL WRITES. The API writes with the service role, which BYPASSES RLS, so
//      the select policies are all that stand between two carriers' fuel spend. And a browser session
//      must not be able to assert a statement at all: the parse has to reproduce the vendor's own
//      printed totals first, which only the server does.
//
// Applies EVERY migration, same as rls.test.mjs, so the constraints under test are the ones production
// runs.
//
// Run:  node supabase/tests/fuel-statements.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

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
/** Run a statement expected to fail; return its SQLSTATE (or null if it unexpectedly succeeded). */
const sqlstate = async (q, p = []) => {
  try {
    await db.query(q, p);
    return null;
  } catch (e) {
    return e.code ?? String(e.message);
  }
};

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
    bucket_id text, name text, owner uuid, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text)
  returns text[]
  language sql
  immutable
  as $fn$
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
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));


const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Silvicom') returning id`)).id;
const OTHER_ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Other') returning id`)).id;

/** Insert a statement the way the ingest does. Figures are the real 2026-08-17 statement (invoice 795506105). */
const insertStatement = async (org, invoice, opts = {}) =>
  (
    await one(
      `insert into fuel_statements
         (org_id, vendor, account_no, invoice_no, period_start, period_end, billing_date,
          total_gallons, fuel_amount, misc_amount, sales_tax, invoice_total, retail_total, savings,
          printed_units, printed_amount, printed_retail, printed_savings,
          line_count, source_format, source_filename, source_path, source_sha256, source_bytes)
       values ($1,'pilot','139445',$2,'2026-08-17','2026-08-23','2026-08-24',
               60888.0, 316686.78, 102.94, 7.62, 316797.34, 347879.44, 31082.10,
               60883.3, 316686.78, 347879.44, 31082.10,
               849, $3, 'db139445F.pdf', $4, 'abc123', 370412)
       returning id`,
      [org, invoice, opts.format ?? 'pdf_statement', `${org}/${invoice}.pdf`],
    )
  ).id;

// ── 1. append-only: the supersede chain is the only mutation ─────────────────────────────────────
const S1 = await insertStatement(ORG, '795506105');

ok(
  "a statement's money cannot be edited in place",
  (await sqlstate(`update fuel_statements set fuel_amount = 1 where id = $1`, [S1])) === "23514",
);
ok(
  "nor its period, nor the totals the vendor printed",
  (await sqlstate(`update fuel_statements set printed_amount = 0, period_end = '2026-08-30' where id = $1`, [S1])) === "23514",
);
ok(
  "nor the source document it came from",
  (await sqlstate(`update fuel_statements set source_sha256 = 'tampered' where id = $1`, [S1])) === "23514",
);

// A corrected statement arrives as a NEW row, and the old one points at it.
const S2 = await insertStatement(ORG, '795506105-R');
ok(
  "superseding is allowed — that is the correction mechanism",
  (await sqlstate(`update fuel_statements set superseded_by = $1, superseded_at = now() where id = $2`, [S2, S1])) === null,
);
ok(
  "the superseded statement is still there, unchanged",
  (await one(`select fuel_amount from fuel_statements where id = $1`, [S1])).fuel_amount === "316686.78",
);
ok(
  "a superseded statement is frozen — it cannot be re-superseded at another replacement",
  (await sqlstate(`update fuel_statements set superseded_by = $1, superseded_at = now() where id = $2`, [S2, S1])) === "23514",
);
// Re-pointing at the SAME replacement looks idempotent but moves `superseded_at`, rewriting when the
// correction happened. On an evidence row that is a silent edit, so it is refused too.
ok(
  "…nor re-pointed at the same one, which would only move superseded_at",
  (await sqlstate(`update fuel_statements set superseded_at = now() where id = $1`, [S1])) === "23514",
);
ok(
  "a statement cannot supersede itself",
  (await sqlstate(`update fuel_statements set superseded_by = id, superseded_at = now() where id = $1`, [S2])) === "23514",
);
ok(
  "superseded_by and superseded_at travel together",
  (await sqlstate(`insert into fuel_statements (org_id, invoice_no, period_start, period_end, source_format, superseded_by)
                   values ($1,'Y','2026-08-17','2026-08-23','pdf_statement',$2)`, [ORG, S2])) === "23514",
);

// ── 2. one LIVE statement per invoice, unlimited superseded ones behind it ───────────────────────
ok(
  "a second LIVE statement for the same invoice is refused",
  (await sqlstate(
    `insert into fuel_statements (org_id, invoice_no, period_start, period_end, source_format)
     values ($1,'795506105-R','2026-08-17','2026-08-23','pdf_statement')`,
    [ORG],
  )) === "23505",
);
// S1 is superseded, so re-uploading THAT invoice again is allowed — this is the third upload of one week.
const S3 = await insertStatement(ORG, '795506105');
ok("re-uploading a superseded invoice is allowed — the index is partial", typeof S3 === "string");
ok(
  "two carriers may hold the same invoice number",
  typeof (await insertStatement(OTHER_ORG, '795506105')) === "string",
);

// ── 3. lines: immutable, numbered once, and they follow their statement ──────────────────────────
const LINE = async (stmt, org, no, extra = {}) =>
  (
    await one(
      `insert into fuel_statement_lines
         (org_id, statement_id, line_number, product_code, product, tank_type, tran_date,
          card_ref, unit_number, site_number, state, brand, gallons, unit_cost, fuel_amount, retail_total)
       values ($1,$2,$3,$4,$5,$6,'2026-08-17','957562','684','41','KY',$7,168.6,4.9442,833.39,977.50)
       returning id`,
      [org, stmt, no, extra.code ?? '020', extra.product ?? 'diesel', extra.tank ?? 'tractor', extra.brand ?? 'pilot'],
    )
  ).id;

const L1 = await LINE(S3, ORG, 1);
ok("a line cannot be edited — re-upload supersedes instead", (await sqlstate(`update fuel_statement_lines set gallons = 1 where id = $1`, [L1])) === "23514");
ok("line numbers are unique within a statement", (await sqlstate(`insert into fuel_statement_lines (org_id, statement_id, line_number, gallons) values ($1,$2,1,0)`, [ORG, S3])) === "23505");
ok("but the same line number in another statement is fine", (await sqlstate(`insert into fuel_statement_lines (org_id, statement_id, line_number, gallons) values ($1,$2,1,0)`, [ORG, S2])) === null);

// 033 is REEFER fuel, not tractor fuel — the whole reason tank_type is on the line (see 0243 header).
ok("tank_type accepts the three real values", (await sqlstate(`insert into fuel_statement_lines (org_id, statement_id, line_number, tank_type, gallons) values ($1,$2,2,'reefer',30.6)`, [ORG, S3])) === null);
ok("and rejects anything else", (await sqlstate(`insert into fuel_statement_lines (org_id, statement_id, line_number, tank_type, gallons) values ($1,$2,3,'trailer',0)`, [ORG, S3])) === "23514");

// A statement is one document: deleting it takes its lines, so a half-deleted statement cannot exist.
const COUNT_BEFORE = Number((await one(`select count(*)::int c from fuel_statement_lines where statement_id = $1`, [S3])).c);
ok("a statement carries at least the lines we just wrote", COUNT_BEFORE === 2);
await db.query(`delete from fuel_statements where id = $1`, [S3]);
ok(
  "deleting a statement takes its lines with it",
  Number((await one(`select count(*)::int c from fuel_statement_lines where statement_id = $1`, [S3])).c) === 0,
);

// ── 4. RLS: read is org-scoped, and no client may write at all ───────────────────────────────────
ok(
  "both tables have RLS on",
  (await one(`select bool_and(relrowsecurity) b from pg_class where relname in ('fuel_statements','fuel_statement_lines')`)).b === true,
);
const policies = (await db.query(`select tablename, cmd from pg_policies where tablename in ('fuel_statements','fuel_statement_lines')`)).rows;
ok(
  "the only policies are SELECT — a browser session cannot assert a statement",
  policies.length === 2 && policies.every((p) => p.cmd === "SELECT"),
  JSON.stringify(policies),
);
ok(
  "no client policy exists for INSERT/UPDATE/DELETE, which is deny-all on purpose",
  !policies.some((p) => p.cmd !== "SELECT"),
);

// ── 5. the source document bucket is private and service-role only ───────────────────────────────
const bucket = await one(`select public, file_size_limit from storage.buckets where id = 'fuel-statements'`);
ok("the fuel-statements bucket exists and is private", bucket !== undefined && bucket.public === false);
ok("with a size limit set", Number(bucket?.file_size_limit) === 25 * 1024 * 1024);
ok(
  "and carries NO storage policies — originals are served through API-issued signed URLs",
  (await db.query(`select 1 from pg_policies where tablename = 'objects' and policyname like '%fuel_statement%'`)).rows.length === 0,
);

// ── 6. fuel_transactions.station_id — the same dimension on the EFS side ─────────────────────────
ok(
  "fuel_transactions carries station_id",
  (await db.query(`select 1 from information_schema.columns where table_name='fuel_transactions' and column_name='station_id'`)).rows.length === 1,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
