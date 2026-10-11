// FuelGuard — migration 0408, where the card's truck was when a card was declined (CF1,
// docs/plans/fuel/CARD-FRAUD-ALERTS-PLAN.md).
//
// What must hold:
//   1. The scorer's measurement — the GPS sample's instant, place and miles to the station — is stored
//      on the decline's satellite row as written.
//   2. 0263's mirror trigger upserts only the columns it names, so a later legacy write on
//      declined_transactions cannot clear the position (the migration header's claim).
//   3. A place without its coordinates and instant, or a negative distance, is refused.
//   4. A position with no station distance is allowed, and all-null is "not measured".
//
// Run: node supabase/tests/decline-truck-position.test.mjs

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const ALL = readdirSync(join(SUPA, "migrations"))
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
    bucket_id text,
    name text,
    owner uuid, owner_id text,
    created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$
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

for (const f of ALL) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}


const ORG = (await one(`insert into organizations (id, name) values (gen_random_uuid(), 'Silvicom') returning id`)).id;
const fails = async (name, fn, pattern) => {
  try {
    await fn();
    ok(name, false, "did not raise");
  } catch (e) {
    ok(name, pattern.test(e.message), e.message);
  }
};

// A scored decline: the legacy write fires 0263's mirror, which creates the satellite row.
const D = (await one(
  `insert into declined_transactions (org_id, declined_at, card_ref, unit, city, state, suspicion_level, samsara_location_matched)
   values ($1, '2026-09-23T00:16:00Z', '7083050030727564', '729', 'SOUTH BEND', 'IN', 'alert', false) returning id`, [ORG])).id;
const sat = () => one(`select * from declined_txn_scores where declined_id = $1`, [D]);
ok("the scored decline has its satellite row, with no position yet", (await sat())?.truck_position_at === null);

// ── 1. the measurement is stored as written ──────────────────────────────────────────────────
const POS = `update declined_txn_scores set truck_position_at = '2026-09-23T00:10:00Z', truck_lat = 35.1495, truck_lng = -90.049,
  truck_city = 'Memphis', truck_state = 'TN', truck_address = 'Memphis, TN, 38103', truck_station_miles = 495.5 where declined_id = $1`;
await db.query(POS, [D]);
const s1 = await sat();
ok("the truck's position, its own instant and the miles to the station are stored",
  s1.truck_city === "Memphis" && s1.truck_state === "TN" && Number(s1.truck_station_miles) === 495.5
    && new Date(s1.truck_position_at).toISOString() === "2026-09-23T00:10:00.000Z", JSON.stringify(s1));

// ── 2. a legacy re-score through declined_transactions does not clear it ─────────────────────
await db.query(`update declined_transactions set suspicion_level = 'review', scored_at = now() where id = $1`, [D]);
const s2 = await sat();
ok("a later legacy write mirrors its own columns and leaves the position alone",
  s2.suspicion_level === "review" && s2.truck_city === "Memphis" && s2.truck_position_at !== null, JSON.stringify(s2));

// ── 3. refusals ──────────────────────────────────────────────────────────────────────────────
await fails("a position without its instant is refused",
  () => db.query(`update declined_txn_scores set truck_position_at = null where declined_id = $1`, [D]), /declined_txn_scores_truck_position_all_or_none/);
await fails("a place name without coordinates is refused",
  () => db.query(`update declined_txn_scores set truck_position_at = null, truck_lat = null, truck_lng = null, truck_station_miles = null where declined_id = $1`, [D]),
  /declined_txn_scores_truck_position_all_or_none/);
await fails("a negative distance is refused",
  () => db.query(`update declined_txn_scores set truck_station_miles = -1 where declined_id = $1`, [D]), /declined_txn_scores_truck_station_miles_nonneg/);
ok("a refused write leaves the measurement as it was", (await sat()).truck_city === "Memphis");

// ── 4. a position without a station geocode, and clearing to "not measured", are both allowed ──
await db.query(`update declined_txn_scores set truck_station_miles = null where declined_id = $1`, [D]);
ok("a position with no station distance is allowed (the station had no geocode)", (await sat()).truck_station_miles === null);
await db.query(`update declined_txn_scores set truck_position_at = null, truck_lat = null, truck_lng = null,
  truck_city = null, truck_state = null, truck_address = null, truck_station_miles = null where declined_id = $1`, [D]);
ok("all seven null together is allowed — not measured", (await sat()).truck_position_at === null);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
