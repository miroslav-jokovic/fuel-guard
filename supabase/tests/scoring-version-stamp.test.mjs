// Silvicom 360 — scoring_version stamp matrix (migrations 0318 + 0319).
//
// THE DEFECT THIS EXISTS FOR, and it is a trap rather than a typo. 0318 added
// `fuel_transactions.scoring_version` and the app began sending it in the outcome JSON. It was never
// written: the outcome is applied by `persist_scoring_outcome_v2` → `persist_scoring_outcome`, and
// that function carries an EXPLICIT column list. A key the list does not name is discarded with no
// error and no warning. Measured on production straight after the deploy — 562 fills scored in three
// minutes, ZERO stamped, the whole mechanism inert.
//
// Nothing in the TypeScript suite could catch it. `persistScoringOutcome` is exercised against a fake
// RPC, and a fake accepts whatever JSON it is handed, so the app-side change typechecks, tests green,
// and does nothing. Only real SQL can tell the difference — which is what this matrix is.
//
// What it pins:
//   1. THE STAMP LANDS. An outcome carrying scoring_version reaches the column through the RPC.
//   2. IT IS NOT ERASED. An outcome WITHOUT the key leaves an existing stamp alone, so a caller that
//      does not send one cannot silently un-stamp a fill it just scored.
//   3. IT MOVES FORWARD. A later version overwrites an earlier one — this is a stamp, not a floor.
//   4. THE CLAIM INDEX EXISTS, since the nightly sweep's whole cost model rests on it.
//
// Run:  node supabase/tests/scoring-version-stamp.test.mjs
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

const ORG = "11111111-1111-1111-1111-111111111111";
const TXN = "bbbbbbbb-0000-0000-0000-000000000001";
await db.query(`insert into organizations (id, name) values ($1,'Carrier A')`, [ORG]);
await db.query(
  `insert into fuel_transactions (id, org_id, fueled_at, state, gallons, total_cost, is_canonical)
   values ($1, $2, '2026-09-01T01:00:00Z', 'TX', 120, 480.00, true)`,
  [TXN, ORG],
);

const stampOf = async () => {
  const r = await db.query(`select scoring_version from fuel_transactions where id=$1`, [TXN]);
  return r.rows[0]?.scoring_version ?? null;
};

ok("a fill starts unstamped, so the first sweep sees the whole backlog as due", (await stampOf()) === null);

/**
 * Call the RPC the way `persistScoringOutcome` does. Each call opens its own attempt row, because the
 * function requires one — that guard is what makes the write auditable, and faking past it would
 * defeat the point of testing against real SQL.
 */
let attemptSeq = 0;
const persist = async (outcome) => {
  const attempt = `aaaaaaaa-0000-0000-0000-${String(++attemptSeq).padStart(12, "0")}`;
  await db.query(
    `insert into scoring_attempts (id, org_id, transaction_id, engine_version, result_hash, status)
     values ($1, $2, $3, 'engine-test', $4, 'running')`,
    [attempt, ORG, TXN, `hash-${attemptSeq}`],
  );
  return db.query(
    `select public.persist_scoring_outcome_v2(
       $1, $2, $3, null, '2026-09-01T01:00:00Z'::timestamptz,
       'engine-test', $4, null::jsonb, $5::jsonb, null, null, null, null)`,
    [attempt, ORG, TXN, `hash-${attemptSeq}`, JSON.stringify(outcome)],
  );
};

// 1 — the stamp lands. Before 0319 this was silently discarded by the column list.
await persist({ has_anomaly: false, case_level: "clear", scoring_version: 1 });
ok("an outcome carrying scoring_version reaches the column through the RPC", (await stampOf()) === 1);

// 2 — an outcome WITHOUT the key must not erase what is there. A caller that omits it has said
// nothing about the version, not that the fill is unscored.
await persist({ has_anomaly: false, case_level: "clear" });
ok("an outcome without the key leaves the existing stamp alone", (await stampOf()) === 1);

// 3 — it is a stamp, not a floor: a later generation overwrites an earlier one, which is what makes
// the sweep's `< SCORING_VERSION` claim terminate.
await persist({ has_anomaly: false, case_level: "clear", scoring_version: 2 });
ok("a later version overwrites an earlier one", (await stampOf()) === 2);

// 4 — the claim index. The nightly's cost model assumes the due slice is found without scanning the
// rows already current; on a healthy fleet nearly every row IS current.
const idx = await db.query(
  `select count(*)::int n from pg_indexes
    where tablename='fuel_transactions' and indexname='idx_fuel_transactions_scoring_version'`);
ok("the (org_id, scoring_version, fueled_at) claim index exists", idx.rows[0].n === 1);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
