// Silvicom 360 — declined_transactions scoring-satellite matrix (migration 0263, D-SEP3).
//
// 0011 stored the EFS reject feed faithfully; 0022 fused scoring output onto the same rows —
// two layers, one table, two module writers. The satellite makes the layers physical:
//
//   1. A RAW REJECT INSERT TOUCHES NOTHING — including the '[]'::jsonb suspicion_reasons
//      default, which is presence, not meaning.
//   2. THE MIRROR IS COMPLETE — a scoring write lands in declined_txn_scores whoever writes.
//   3. HISTORY IS BACKFILLED — pre-0263 scored rejects appear with equal values.
//   4. DENY-ALL — RLS enabled, zero client policies.
//
// Run:  node supabase/tests/declined-txn-scores.test.mjs
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

const before = MIGRATIONS.filter((f) => f < "0263");
const after = MIGRATIONS.filter((f) => f >= "0263");
for (const f of before) {
  try { await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, "")); }
  catch (e) { console.error(`migration ${f} failed: ${e.message}`); process.exit(1); }
}

const ORG = "11111111-1111-1111-1111-111111111111";
const PRE = "cccccccc-0000-0000-0000-000000000001";
await db.query(`insert into organizations (id, name) values ($1,'Carrier A')`, [ORG]);
await db.query(
  `insert into declined_transactions (id, org_id, declined_at, suspicion_level, scored_at)
   values ($1, $2, '2026-06-01T12:00:00Z', 'high', '2026-06-01T12:05:00Z')`,
  [PRE, ORG],
);

for (const f of after) {
  try { await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, "")); }
  catch (e) { console.error(`migration ${f} failed: ${e.message}`); process.exit(1); }
}

console.log("\n---- Matrix: declined-txn-scores ----------------------------------");

const bf = await db.query(`select suspicion_level from declined_txn_scores where declined_id=$1`, [PRE]);
ok("backfill: pre-0263 scored reject landed in declined_txn_scores", bf.rows[0]?.suspicion_level === "high");

const RAW = "cccccccc-0000-0000-0000-000000000002";
await db.query(
  `insert into declined_transactions (id, org_id, declined_at, error_code) values ($1, $2, '2026-06-02T09:00:00Z', 'D123')`,
  [RAW, ORG],
);
const rawCount = await db.query(`select count(*)::int n from declined_txn_scores where declined_id=$1`, [RAW]);
ok("a raw reject insert creates zero satellite rows — '[]'::jsonb default and all", rawCount.rows[0].n === 0);

await db.query(
  `update declined_transactions set suspicion_level='medium', suspicion_reasons='["odd_hour"]'::jsonb, scored_at=now() where id=$1`,
  [RAW],
);
const mir = await db.query(`select suspicion_level, suspicion_reasons from declined_txn_scores where declined_id=$1`, [RAW]);
ok("a scoring write mirrors into declined_txn_scores", mir.rows[0]?.suspicion_level === "medium" && JSON.stringify(mir.rows[0]?.suspicion_reasons) === '["odd_hour"]');

const r = await db.query(`select relrowsecurity from pg_class where relname='declined_txn_scores'`);
ok("declined_txn_scores has row level security enabled", r.rows[0]?.relrowsecurity === true);
const p = await db.query(`select count(*)::int n from pg_policies where tablename='declined_txn_scores'`);
ok("  and no client policy, so a browser session reads nothing", p.rows[0].n === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
