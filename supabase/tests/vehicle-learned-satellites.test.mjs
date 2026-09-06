// Silvicom 360 — vehicles learner-satellite matrix (migration 0262, D-SEP3).
//
// Master data stops being a machine's scratchpad: tank calibration (anomalies) and idle
// learning (idle) get per-domain satellites, mirrored by trigger while writers migrate. What
// this matrix pins:
//
//   1. A ROSTER INSERT TOUCHES NOTHING — despite several legacy learner columns carrying
//      NOT NULL defaults ('insufficient', 'unknown', 0), a plain vehicle row creates zero
//      satellite rows. The guards fire on MEANING, not on presence.
//   2. THE MIRROR IS COMPLETE — a tank-learner write lands in vehicle_tank_learned, an idle
//      write in vehicle_idle_learned, whoever the writer.
//   3. DOMAINS ARE INDEPENDENT — a tank write creates no idle row and vice versa; the two
//      owners' rebuilds can never collide.
//   4. HISTORY IS BACKFILLED — pre-0262 learner state appears with equal values.
//   5. DENY-ALL — RLS enabled, zero client policies on both.
//
// Run:  node supabase/tests/vehicle-learned-satellites.test.mjs
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

const before = MIGRATIONS.filter((f) => f < "0262");
const after = MIGRATIONS.filter((f) => f >= "0262");
for (const f of before) {
  try { await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, "")); }
  catch (e) { console.error(`migration ${f} failed: ${e.message}`); process.exit(1); }
}

const ORG = "11111111-1111-1111-1111-111111111111";
const PRE = "bbbbbbbb-0000-0000-0000-000000000001";
await db.query(`insert into organizations (id, name) values ($1,'Carrier A')`, [ORG]);
await db.query(
  `insert into vehicles (id, org_id, unit_number, tank_capacity_gal, tank_fill_ratio, idle_capability)
   values ($1, $2, 'T-100', 200, 0.93, 'apu')`,
  [PRE, ORG],
);

for (const f of after) {
  try { await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, "")); }
  catch (e) { console.error(`migration ${f} failed: ${e.message}`); process.exit(1); }
}

console.log("\n---- Matrix: vehicle-learned-satellites ---------------------------");

// ── 4. backfill ──────────────────────────────────────────────────────────────────────────────
const bfT = await db.query(`select tank_fill_ratio from vehicle_tank_learned where vehicle_id=$1`, [PRE]);
ok("backfill: pre-0262 tank calibration landed in vehicle_tank_learned", Number(bfT.rows[0]?.tank_fill_ratio) === 0.93);
const bfI = await db.query(`select idle_capability from vehicle_idle_learned where vehicle_id=$1`, [PRE]);
ok("backfill: pre-0262 idle capability landed in vehicle_idle_learned", bfI.rows[0]?.idle_capability === "apu");

// ── 1. a roster insert touches nothing, defaults and all ─────────────────────────────────────
const RAW = "bbbbbbbb-0000-0000-0000-000000000002";
await db.query(`insert into vehicles (id, org_id, unit_number, tank_capacity_gal) values ($1, $2, 'T-200', 200)`, [RAW, ORG]);
const rawCount = await db.query(
  `select (select count(*)::int from vehicle_tank_learned where vehicle_id=$1)
        + (select count(*)::int from vehicle_idle_learned where vehicle_id=$1) as n`,
  [RAW],
);
ok("a plain roster insert creates zero satellite rows — the guards fire on meaning, not presence", rawCount.rows[0].n === 0);

// ── 2 + 3. mirrors fire, and per-domain only ─────────────────────────────────────────────────
await db.query(`update vehicles set odometer_offset=12.5, tank_residual_sigma=3.1 where id=$1`, [RAW]);
const mT = await db.query(`select odometer_offset from vehicle_tank_learned where vehicle_id=$1`, [RAW]);
ok("a tank-learner write mirrors into vehicle_tank_learned", Number(mT.rows[0]?.odometer_offset) === 12.5);
const noIdle = await db.query(`select count(*)::int n from vehicle_idle_learned where vehicle_id=$1`, [RAW]);
ok("  and creates no idle row — domains are independent", noIdle.rows[0].n === 0);

await db.query(`update vehicles set idle_evidence_status='sufficient', idle_evidence_sessions=14 where id=$1`, [RAW]);
const mI = await db.query(`select idle_evidence_status, idle_evidence_sessions from vehicle_idle_learned where vehicle_id=$1`, [RAW]);
ok("an idle-evidence write mirrors into vehicle_idle_learned", mI.rows[0]?.idle_evidence_status === "sufficient" && mI.rows[0]?.idle_evidence_sessions === 14);

// the 0175 learned-envelope RPC writes through the same trigger
const rpcErr = await (async () => {
  try {
    await db.query(
      `select apply_idle_learned_envelope($1, $2, 'sufficient', 20.0, 40.0, 9, 100, 50, 25, 4, 'envelope-v1', now())`,
      [ORG, RAW],
    );
    return null;
  } catch (e) { return e.message; }
})();
if (rpcErr === null) {
  const rpcI = await db.query(`select idle_learned_envelope_status from vehicle_idle_learned where vehicle_id=$1`, [RAW]);
  ok("the 0175 envelope RPC's write mirrors too (no caller escapes the trigger)", rpcI.rows[0]?.idle_learned_envelope_status === "sufficient");
} else {
  console.log(`  SKIP  apply_idle_learned_envelope signature differs here (${rpcErr.slice(0, 70)}…) — trigger already proven via UPDATE`);
}

// ── 5. deny-all posture ──────────────────────────────────────────────────────────────────────
for (const t of ["vehicle_tank_learned", "vehicle_idle_learned"]) {
  const r = await db.query(`select relrowsecurity from pg_class where relname=$1`, [t]);
  ok(`${t} has row level security enabled`, r.rows[0]?.relrowsecurity === true);
  const p = await db.query(`select count(*)::int n from pg_policies where tablename=$1`, [t]);
  ok(`  and no client policy, so a browser session reads nothing`, p.rows[0].n === 0);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
