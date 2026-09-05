// FuelGuard — financial_entries matrix (migration 0257).
//
// This store exists because one payment genuinely exists many times in the source systems, and every
// copy looks like a legitimate row. Within McLeod a settlement is an accrual, a payment, a check and
// GL lines. Across tables, June 2026's fuel is the same $1,017,601.81 in fuel_detail_hist, in GL
// account 20550000, and in the PILOKNTN accounts-payable invoices. Across sources, it is the same fuel
// EFS already wrote into fuel_transactions. One purchase, four defensible rows.
//
// A convention ("remember to filter") fails the first time somebody writes a report without reading
// the docs. So the guarantee is structural, and this matrix is what proves it:
//
//   1. THE CANONICAL INDEX. One canonical, non-void entry per dedup_key per org. The second insert
//      that would let a report double-count is REFUSED, not caught in review.
//   2. NON-CANONICAL ROWS SURVIVE. Audit and drill-down still reach them; only reports filter them out.
//   3. VOIDS ARE FIRST-CLASS. 925 of 2026's settlements are voided, carrying $339,985 never paid.
//      Kept as rows, excluded by the reporting predicate, and not blocking a canonical replacement.
//   4. ORG SCOPE. Two carriers may share a dedup_key; neither may see the other's entries.
//   5. ATTRIBUTION IS THE SOURCE'S, NOT OURS. vehicle_id is nullable because gl_ledger populates its
//      tractor column on 0 of 188,179 lines. A schema that required it would force a guess.
//
// Run:  node supabase/tests/financial-entries.test.mjs
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

/** Run a statement and report whether the database refused it. */
const refuses = async (sql, params = []) => {
  try { await db.query(sql, params); return null; }
  catch (e) { return e.message; }
};

// The same PGlite bootstrap every matrix in this directory uses: the Supabase-managed schemas the
// migrations reference but do not create, and `pgcrypto` stripped because PGlite ships gen_random_uuid()
// natively and cannot load the extension.
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

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
await db.query(`insert into organizations (id, name) values ($1,'Carrier A'),($2,'Carrier B')`, [ORG_A, ORG_B]);

const entry = (o) => ({
  org_id: ORG_A, direction: "expense", category: "fuel", amount: "100.00",
  occurred_at: "2026-06-15T12:00:00Z", source: "mcleod", source_table: "mcleod_ap_vouchers",
  external_id: "X1", lifecycle_stage: "invoice", dedup_key: "K1",
  is_canonical: true, is_void: false, ...o,
});
const insert = (o) => {
  const e = entry(o);
  const cols = Object.keys(e);
  return db.query(
    `insert into financial_entries (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
    cols.map((c) => e[c]),
  );
};

console.log("\n---- Matrix: financial-entries ------------------------------------");

// ── 1. The guarantee ─────────────────────────────────────────────────────────────────────────────
await insert({ external_id: "FUEL-1", dedup_key: "fuel:card9:2026-06-15T12:00Z:120gal" });
ok("a canonical entry inserts", true);

const dupe = await refuses(
  `insert into financial_entries (org_id,direction,category,amount,occurred_at,source,source_table,external_id,lifecycle_stage,dedup_key,is_canonical,is_void)
   values ($1,'expense','fuel','100.00','2026-06-15T12:00:00Z','efs','fuel_transactions','EFS-1','invoice','fuel:card9:2026-06-15T12:00Z:120gal',true,false)`,
  [ORG_A],
);
ok("the SAME money arriving from a second source is refused as canonical", dupe !== null, dupe ?? "(inserted!)");
ok("  and the refusal names the canonical index", (dupe ?? "").includes("uq_financial_entries_canonical"), dupe ?? "");

// ── 2. The non-canonical copy is kept ────────────────────────────────────────────────────────────
await insert({
  external_id: "EFS-1", source: "efs", source_table: "fuel_transactions",
  dedup_key: "fuel:card9:2026-06-15T12:00Z:120gal", is_canonical: false,
});
const both = await db.query(
  `select count(*)::int n from financial_entries where org_id=$1 and dedup_key='fuel:card9:2026-06-15T12:00Z:120gal'`,
  [ORG_A],
);
ok("the second source is retained as a NON-canonical row for drill-down", both.rows[0].n === 2);

const reported = await db.query(
  `select count(*)::int n, sum(amount)::numeric total from financial_entries
    where org_id=$1 and is_canonical and not is_void`, [ORG_A],
);
ok("a report reading the canonical predicate sees the money ONCE", reported.rows[0].n === 1);
ok("  and totals $100.00, not $200.00", Number(reported.rows[0].total) === 100);

// ── 3. Voids ─────────────────────────────────────────────────────────────────────────────────────
await insert({ external_id: "SET-VOID", dedup_key: "settle:9001", category: "driver_pay", is_void: true, amount: "500.00" });
await insert({ external_id: "SET-REAL", dedup_key: "settle:9001", category: "driver_pay", amount: "500.00" });
ok("a voided entry does not block a canonical replacement on the same key", true);

const afterVoid = await db.query(
  `select count(*)::int n from financial_entries where org_id=$1 and dedup_key='settle:9001'`, [ORG_A],
);
ok("  and the void is retained for audit rather than deleted", afterVoid.rows[0].n === 2);

const voidExcluded = await db.query(
  `select coalesce(sum(amount),0)::numeric total from financial_entries
    where org_id=$1 and category='driver_pay' and is_canonical and not is_void`, [ORG_A],
);
ok("  and reports count the payment once, not twice", Number(voidExcluded.rows[0].total) === 500);

// ── 4. Lifecycle stages are the same money and must not both be canonical ───────────────────────
await insert({ external_id: "ACC-1", dedup_key: "settle:9002", category: "driver_pay", lifecycle_stage: "accrual", amount: "800.00" });
const payLeg = await refuses(
  `insert into financial_entries (org_id,direction,category,amount,occurred_at,source,source_table,external_id,lifecycle_stage,dedup_key,is_canonical,is_void)
   values ($1,'expense','driver_pay','800.00','2026-06-20T12:00:00Z','mcleod','mcleod_settlements','PAY-1','payment','settle:9002',true,false)`,
  [ORG_A],
);
ok("the PAYMENT leg of an accrued settlement cannot also be canonical", payLeg !== null, payLeg ?? "(inserted!)");

// ── 5. Org scope ─────────────────────────────────────────────────────────────────────────────────
await insert({ org_id: ORG_B, external_id: "FUEL-1", dedup_key: "fuel:card9:2026-06-15T12:00Z:120gal" });
ok("a different carrier may hold the same dedup_key", true);
const orgB = await db.query(
  `select count(*)::int n from financial_entries where org_id=$1 and is_canonical and not is_void`, [ORG_B],
);
ok("  and its entries are scoped to it", orgB.rows[0].n === 1);

// ── 6. Idempotency ───────────────────────────────────────────────────────────────────────────────
const resweep = await refuses(
  `insert into financial_entries (org_id,direction,category,amount,occurred_at,source,source_table,external_id,lifecycle_stage,dedup_key,is_canonical,is_void)
   values ($1,'expense','fuel','100.00','2026-06-15T12:00:00Z','mcleod','mcleod_ap_vouchers','FUEL-1','invoice','other-key',true,false)`,
  [ORG_A],
);
ok("re-sweeping the same source row is refused rather than duplicated", resweep !== null, resweep ?? "(inserted!)");
ok("  and the refusal names the source-row index", (resweep ?? "").includes("uq_financial_entries_source_row"), resweep ?? "");

// ── 7. Attribution is the source's ───────────────────────────────────────────────────────────────
await insert({ external_id: "AP-NOTRUCK", dedup_key: "ap:7", category: "ap_expense", vehicle_id: null });
const unattributed = await db.query(
  `select count(*)::int n from financial_entries where org_id=$1 and vehicle_id is null and category='ap_expense'`, [ORG_A],
);
ok("an expense McLeod places on no truck is stored with a NULL vehicle, not a guess", unattributed.rows[0].n === 1);

const badDirection = await refuses(
  `insert into financial_entries (org_id,direction,category,amount,occurred_at,source,source_table,external_id,lifecycle_stage,dedup_key)
   values ($1,'profit','fuel','1','2026-06-01T00:00:00Z','mcleod','x','Y1','invoice','k9')`, [ORG_A],
);
ok("an unknown direction is refused", badDirection !== null);
const badCategory = await refuses(
  `insert into financial_entries (org_id,direction,category,amount,occurred_at,source,source_table,external_id,lifecycle_stage,dedup_key)
   values ($1,'expense','tolls','1','2026-06-01T00:00:00Z','mcleod','x','Y2','invoice','k10')`, [ORG_A],
);
ok("an unknown category is refused rather than silently stored", badCategory !== null);

// ── 8. Earnings are attributable, which is what makes margin per truck possible ─────────────────
await db.query(
  `insert into mcleod_billing (org_id, external_id, invoice_no, tractor_unit, bill_date, total_charges, other_charge)
   values ($1,'B1','90001','101','2026-06-10T00:00:00Z', 3400.00, 250.00)`, [ORG_A],
);
const billed = await db.query(
  `select total_charges::numeric tc, other_charge::numeric oc, tractor_unit from mcleod_billing where org_id=$1`, [ORG_A],
);
ok("billing carries a tractor, so revenue per truck needs no allocation rule", billed.rows[0].tractor_unit === "101");
ok("  and linehaul is held apart from accessorials", Number(billed.rows[0].tc) === 3400 && Number(billed.rows[0].oc) === 250);

// ── 9. Settlement keeps both figures, because they answer different questions ───────────────────
await db.query(
  `insert into mcleod_settlements (org_id, external_id, tractor_unit, payee_type, accrued_at, total_pay, posted_pay, accrual_key)
   values ($1,'S1','101','company_driver','2026-06-10T00:00:00Z', 1268.57, 1262.89, 'AK1')`, [ORG_A],
);
const s = await db.query(`select total_pay::numeric tp, posted_pay::numeric pp from mcleod_settlements where org_id=$1`, [ORG_A]);
ok("settlement stores total_pay AND posted_pay, which are not the same number",
  Number(s.rows[0].tp) === 1268.57 && Number(s.rows[0].pp) === 1262.89);

const badPayee = await refuses(
  `insert into mcleod_settlements (org_id, external_id, payee_type) values ($1,'S2','driver')`, [ORG_A],
);
ok("an unrecognised payee type is refused, so owner-operators cannot leak into the driver pool", badPayee !== null);

// ── 10. RLS ──────────────────────────────────────────────────────────────────────────────────────
for (const t of ["financial_entries", "mcleod_settlements", "mcleod_ap_vouchers", "mcleod_billing"]) {
  const r = await db.query(`select relrowsecurity from pg_class where relname=$1`, [t]);
  ok(`${t} has row level security enabled`, r.rows[0]?.relrowsecurity === true);
  const p = await db.query(`select count(*)::int n from pg_policies where tablename=$1`, [t]);
  ok(`  and no client policy, so a browser session reads nothing`, p.rows[0].n === 0);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
