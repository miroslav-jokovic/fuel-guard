// Silvicom 360 — fuel_transactions.business_date matrix (migration 0287, D-FUI11, FUEL-T1).
//
// The defect this column closes is not a wrong value anywhere — it is TWO derivations of the same
// day. The Fuel Log renders `fueled_at` in the station's zone and filters it as a UTC instant, so a
// California fill at 18:00 local on the 31st is displayed as the 31st and filtered as the 1st of the
// next month. Measured in production 2026-09-01: 1,833 of 14,749 fills (12.4%) display a different
// calendar date than the filter uses, and 57 of them ($28,430.70) land in the wrong MONTH.
//
// What this matrix pins:
//   1. THE REAL FAILING SHAPE. A California fill at 18:00 local on the last day of a month is inside
//      that month's business-date window and outside the next — the assertion the plan named.
//   2. THE TRIGGER OWNS THE COLUMN. A writer cannot assert a business date; whatever it sends is
//      overwritten. That is the property that makes eleven writers (including the browser) safe.
//   3. IT FOLLOWS A CORRECTION. Move the instant or the state and the day moves with it.
//   4. HISTORY IS BACKFILLED. A row written before 0287 carries the right day afterwards.
//   5. THE BACKFILL IS QUIET. It does not stamp `updated_at` on every fill in the carrier's history,
//      and it does not touch the 0261 satellites.
//   6. UTC IS THE DOCUMENTED FALLBACK, so an unmappable state is deterministic rather than null.
//
// Run:  node supabase/tests/fuel-business-date.test.mjs
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

// Backfill proof needs pre-0287 rows: apply everything BEFORE 0287, plant history, then apply 0287 —
// the matrix runs the migration exactly the way production will.
const before = MIGRATIONS.filter((f) => f < "0287");
const after = MIGRATIONS.filter((f) => f >= "0287");
for (const f of before) {
  try { await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, "")); }
  catch (e) { console.error(`migration ${f} failed: ${e.message}`); process.exit(1); }
}

const ORG = "11111111-1111-1111-1111-111111111111";
const HIST = "bbbbbbbb-0000-0000-0000-000000000001";
await db.query(`insert into organizations (id, name) values ($1,'Carrier A')`, [ORG]);

// The exact production shape: California, 18:00 local on 31 August → 2026-09-01T01:00:00Z.
await db.query(
  `insert into fuel_transactions (id, org_id, fueled_at, state, gallons, total_cost, is_canonical)
   values ($1, $2, '2026-09-01T01:00:00Z', 'CA', 120, 480.00, true)`,
  [HIST, ORG],
);
// A row with satellite evidence, so the backfill's quietness is observable rather than asserted.
const SAT = "bbbbbbbb-0000-0000-0000-000000000002";
await db.query(
  `insert into fuel_transactions (id, org_id, fueled_at, state, gallons, samsara_recon_status, is_canonical)
   values ($1, $2, '2026-06-15T12:00:00Z', 'TX', 90, 'success', true)`,
  [SAT, ORG],
);
await db.query(`update fuel_transactions set updated_at = '2026-06-15T12:00:00Z' where org_id = $1`, [ORG]);
const beforeStamps = await db.query(
  `select id, updated_at from fuel_transactions where org_id=$1 order by id`, [ORG],
);
const beforeSat = await db.query(`select updated_at from fuel_txn_recon where txn_id=$1`, [SAT]);

for (const f of after) {
  try { await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, "")); }
  catch (e) { console.error(`migration ${f} failed: ${e.message}`); process.exit(1); }
}

console.log("\n---- Matrix: fuel-business-date ------------------------------------");

// ── 4. history is backfilled ─────────────────────────────────────────────────────────────────
const bf = await db.query(`select business_date::text as d from fuel_transactions where id=$1`, [HIST]);
ok("backfill: a pre-0287 California fill carries its station-local day", bf.rows[0]?.d === "2026-08-31",
   `got ${bf.rows[0]?.d}`);

// ── 5. the backfill is quiet ─────────────────────────────────────────────────────────────────
const afterStamps = await db.query(
  `select id, updated_at from fuel_transactions where org_id=$1 order by id`, [ORG],
);
ok("the backfill did not stamp updated_at on every fill in the history",
   JSON.stringify(beforeStamps.rows) === JSON.stringify(afterStamps.rows));
const afterSat = await db.query(`select updated_at from fuel_txn_recon where txn_id=$1`, [SAT]);
ok("  and it did not re-touch the 0261 satellites",
   JSON.stringify(beforeSat.rows) === JSON.stringify(afterSat.rows));

// ── 1. the real failing shape: inside August, outside September ──────────────────────────────
const inAug = await db.query(
  `select count(*)::int n from fuel_transactions
    where org_id=$1 and business_date >= '2026-08-01' and business_date <= '2026-08-31'`, [ORG]);
ok("an 18:00-local fill on 31 Aug in California is INSIDE August", inAug.rows[0].n === 1);
const inSep = await db.query(
  `select count(*)::int n from fuel_transactions
    where org_id=$1 and business_date >= '2026-09-01' and business_date <= '2026-09-30'`, [ORG]);
ok("  ...and OUTSIDE September", inSep.rows[0].n === 0);
// The defect stated as itself: the instant-based window still puts that fill in September.
//
// ⚠ The bounds are written as explicit UTC instants, not as the bare strings the Fuel Log sends. This
// matrix runs on PGlite, whose session timezone is `Etc/GMT+6` rather than the UTC production runs on
// — so a bare `fueled_at >= '2026-09-01'` here means 06:00Z and answers a DIFFERENT question than the
// same string does in production. Which is, exactly, A1: the old filter's meaning depends on the
// session's timezone, and this line would have quietly asserted PGlite's instead of the product's.
const utcSep = await db.query(
  `select count(*)::int n from fuel_transactions
    where org_id=$1 and fueled_at >= '2026-09-01T00:00:00Z'::timestamptz
                    and fueled_at <  '2026-10-01T00:00:00Z'::timestamptz`, [ORG]);
ok("  ...while the OLD instant window puts that same fill in September — the defect, stated",
   utcSep.rows[0].n === 1);

// ── 2. the trigger owns the column ───────────────────────────────────────────────────────────
// 06:00Z is chosen deliberately: local midnight is 07:00Z in California and 05:00Z in Texas, so this
// instant is 31 August in one and 1 September in the other — which is what makes the state correction
// below observable at all. (01:00Z would NOT: both are still on the 31st.)
const ASSERT = "bbbbbbbb-0000-0000-0000-000000000003";
await db.query(
  `insert into fuel_transactions (id, org_id, fueled_at, state, gallons, business_date, is_canonical)
   values ($1, $2, '2026-09-01T06:00:00Z', 'CA', 50, '2030-01-01', true)`,
  [ASSERT, ORG],
);
const asserted = await db.query(`select business_date::text as d from fuel_transactions where id=$1`, [ASSERT]);
ok("a writer cannot assert a business date — the trigger overwrites what it sent",
   asserted.rows[0]?.d === "2026-08-31", `got ${asserted.rows[0]?.d}`);

await db.query(`update fuel_transactions set business_date = '2030-01-01' where id=$1`, [ASSERT]);
const reasserted = await db.query(`select business_date::text as d from fuel_transactions where id=$1`, [ASSERT]);
ok("  and it cannot assert one on an update either", reasserted.rows[0]?.d === "2026-08-31");

// ── 3. it follows a correction ───────────────────────────────────────────────────────────────
await db.query(`update fuel_transactions set state='TX' where id=$1`, [ASSERT]);
const restated = await db.query(`select business_date::text as d from fuel_transactions where id=$1`, [ASSERT]);
ok("correcting the STATE moves the business day with it (CA→TX crosses into September)",
   restated.rows[0]?.d === "2026-09-01", `got ${restated.rows[0]?.d}`);
await db.query(`update fuel_transactions set fueled_at='2026-08-20T15:00:00Z' where id=$1`, [ASSERT]);
const removed = await db.query(`select business_date::text as d from fuel_transactions where id=$1`, [ASSERT]);
ok("correcting the INSTANT moves it too", removed.rows[0]?.d === "2026-08-20");

// ── 6. the documented fallback ───────────────────────────────────────────────────────────────
const UNK = "bbbbbbbb-0000-0000-0000-000000000004";
await db.query(
  `insert into fuel_transactions (id, org_id, fueled_at, state, gallons, is_canonical)
   values ($1, $2, '2026-09-01T01:00:00Z', 'ZZ', 10, true)`,
  [UNK, ORG],
);
const unk = await db.query(`select business_date::text as d from fuel_transactions where id=$1`, [UNK]);
ok("an unmappable state falls back to UTC deterministically, never to null", unk.rows[0]?.d === "2026-09-01");

// ── the index the next merge's filter needs ──────────────────────────────────────────────────
const idx = await db.query(
  `select count(*)::int n from pg_indexes where tablename='fuel_transactions' and indexname='idx_fuel_txn_org_business_date'`);
ok("the (org_id, business_date) index exists for the filter that lands next merge", idx.rows[0].n === 1);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
