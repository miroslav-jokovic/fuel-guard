// Silvicom 360 — replace_mcleod_gl_days matrix (migrations 0309 → 0310, W1 + D-FLEET9 + D-FIN6).
//
// The ledger staged at the grain the SOURCE asserts, with the monthly rollup DERIVED from the same
// rows in the same transaction. What this matrix pins:
//
//   1. THE ROLLUP IS THE DAYS, SUMMED — the month's line count, net and abs are exactly the sum of
//      the daily rows, per (module, account). Two grains, one assertion.
//   2. ZERO ROWS NEVER DELETE (D-FIN6) — an empty payload writes nothing and removes nothing, at
//      BOTH grains. An empty read is a measurement of the source, not an instruction.
//   3. REPLACE MEANS REPLACE, AT BOTH GRAINS — a day that stops posting an account loses that row,
//      and the month's rollup shrinks with it rather than keeping a stale total beside the new one.
//   4. A ROW OUTSIDE THE MONTH IS REFUSED — the stale delete is scoped to the month, so a row dated
//      outside it would be written once and never cleaned up by any later sweep of its own month.
//   5. THE COMPANY IS PART OF THE IDENTITY — two legal entities posting the same account on the
//      same day are two rows, not one overwriting the other. This is the flaw the monthly table
//      carries and this table deliberately does not (0309's header).
//   6. TENANT SCOPE IS THE ARGUMENT — another org's rows for the same month are untouched.
//
// Run:  node supabase/tests/mcleod-gl-day-replace.test.mjs
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

for (const f of MIGRATIONS) {
  try { await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, "")); }
  catch (e) { console.error(`migration ${f} failed: ${e.message}`); process.exit(1); }
}

console.log("\n---- Matrix: mcleod-gl-day-replace -------------------------------");

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
await db.query(`insert into organizations (id, name) values ($1,'Carrier A'), ($2,'Carrier B')`, [ORG_A, ORG_B]);

const JUNE = "2026-06-01", JULY = "2026-07-01";
const replace = (org, start, end, rows, company = "TMS") =>
  db.query(`select * from replace_mcleod_gl_days($1, $2, $3, $4, $5::jsonb)`, [org, company, start, end, JSON.stringify(rows)]);
const days = async (org, company = "TMS") =>
  (await db.query(
    `select txn_date::text, post_module, glid, line_count, net_amount::text, abs_amount::text
       from mcleod_gl_days where org_id=$1 and company_id=$2 order by txn_date, post_module, glid`,
    [org, company],
  )).rows;
const month = async (org, start) =>
  (await db.query(
    `select post_module, glid, line_count, net_amount::text, abs_amount::text, company_id
       from mcleod_gl_totals where org_id=$1 and period_start=$2 order by post_module, glid`,
    [org, start],
  )).rows;

// Seed June: fuel posts on two days, settlements on one. The month's fuel total is the two days.
const first = await replace(ORG_A, JUNE, JULY, [
  { txn_date: "2026-06-03", post_module: "FUEL", glid: "40050000", lines: 400, net_amount: 100.25, abs_amount: 100.25 },
  { txn_date: "2026-06-17", post_module: "FUEL", glid: "40050000", lines: 600, net_amount: 200.75, abs_amount: 200.75 },
  { txn_date: "2026-06-30", post_module: "SET", glid: "20500010", lines: 10, net_amount: -5.5, abs_amount: 5.5 },
]);
ok("first sweep lands three days and removes nothing",
  first.rows[0].day_upserted === 3 && first.rows[0].day_stale_removed === 0);

// ── 1. the rollup is the days, summed ─────────────────────────────────────────────────────────
const m = await month(ORG_A, JUNE);
const fuel = m.find((r) => r.glid === "40050000");
ok("the month's fuel row is the two days summed",
  m.length === 2 && fuel.line_count === 1000 && fuel.net_amount === "301.00" && fuel.abs_amount === "301.00",
  JSON.stringify(fuel));
ok("  and the rollup carries the company it was swept for", fuel.company_id === "TMS");

// ── 2. zero rows never delete, at both grains ─────────────────────────────────────────────────
const empty = await replace(ORG_A, JUNE, JULY, []);
ok("an empty payload reports zeros at both grains",
  empty.rows[0].day_upserted === 0 && empty.rows[0].day_stale_removed === 0 &&
  empty.rows[0].month_upserted === 0 && empty.rows[0].month_stale_removed === 0);
ok("  and June still holds its three days and two month rows",
  (await days(ORG_A)).length === 3 && (await month(ORG_A, JUNE)).length === 2);
const nul = await replace(ORG_A, JUNE, JULY, null);
ok("a null payload is treated the same as empty",
  nul.rows[0].day_upserted === 0 && (await days(ORG_A)).length === 3);

// ── 3. replace means replace, at both grains ──────────────────────────────────────────────────
// The 17th's fuel was reclassified onto another account, and the settlement day is gone entirely.
const second = await replace(ORG_A, JUNE, JULY, [
  { txn_date: "2026-06-03", post_module: "FUEL", glid: "40050000", lines: 400, net_amount: 100.25, abs_amount: 100.25 },
  { txn_date: "2026-06-17", post_module: "FUEL", glid: "30220000", lines: 600, net_amount: 200.75, abs_amount: 200.75 },
]);
const after = await days(ORG_A);
ok("the abandoned day-account rows are gone", after.length === 2 && second.rows[0].day_stale_removed === 2);
const m2 = await month(ORG_A, JUNE);
ok("  and the month's rollup follows them, rather than keeping a stale total",
  m2.length === 2 && m2.find((r) => r.glid === "40050000").line_count === 400 &&
  m2.find((r) => r.glid === "30220000").line_count === 600,
  JSON.stringify(m2));
ok("  the settlement account is gone from the month too", !m2.some((r) => r.glid === "20500010"));

// ── 4. a row outside the month is refused ─────────────────────────────────────────────────────
const outside = await replace(ORG_A, JUNE, JULY, [
  { txn_date: "2026-06-05", post_module: "FUEL", glid: "40050000", lines: 1, net_amount: 1, abs_amount: 1 },
  { txn_date: "2026-07-05", post_module: "FUEL", glid: "40050000", lines: 999, net_amount: 999, abs_amount: 999 },
]);
const afterOutside = await days(ORG_A);
ok("a row dated outside the month is not written", outside.rows[0].day_upserted === 1 &&
  !afterOutside.some((r) => r.txn_date === "2026-07-05"), JSON.stringify(afterOutside));
ok("  and it is not in the month's rollup either",
  (await month(ORG_A, JUNE)).every((r) => r.line_count !== 999));

// ── 5. the company is part of the identity ────────────────────────────────────────────────────
await replace(ORG_A, JUNE, JULY, [
  { txn_date: "2026-06-05", post_module: "FUEL", glid: "40050000", lines: 7, net_amount: 7, abs_amount: 7 },
], "TMS2");
const tms = await days(ORG_A, "TMS");
const tms2 = await days(ORG_A, "TMS2");
ok("a second company's day for the same account is its own row, not an overwrite",
  tms.length === 1 && tms2.length === 1 && tms[0].line_count === 1 && tms2[0].line_count === 7,
  JSON.stringify({ tms, tms2 }));
ok("  and sweeping TMS2 did not remove TMS's rows", tms.length === 1);

// ── 6. tenant scope is the argument ───────────────────────────────────────────────────────────
await replace(ORG_B, JUNE, JULY, [
  { txn_date: "2026-06-03", post_module: "FUEL", glid: "40050000", lines: 42, net_amount: 42, abs_amount: 42 },
]);
await replace(ORG_A, JUNE, JULY, [
  { txn_date: "2026-06-05", post_module: "FUEL", glid: "40050000", lines: 1, net_amount: 1, abs_amount: 1 },
]);
ok("another org's June is untouched by a sweep of this one", (await days(ORG_B)).length === 1);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
