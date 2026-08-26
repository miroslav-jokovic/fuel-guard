// FuelGuard — samsara_ifta_jurisdiction_miles matrix (migration 0255).
//
// The table exists so that a corrected IFTA rule can be applied to HISTORY without re-fetching a
// period Samsara may since have restated. Four properties carry that, and each fails quietly:
//
//   1. IT HOLDS METRES. A miles column would bake one conversion and one rounding into stored data,
//      and no later reader could tell that had happened.
//   2. A RE-FETCH REFRESHES, IT DOES NOT DUPLICATE. Samsara restates the most recent 72 hours, so
//      re-fetching a month is the ordinary case; two rows for one (truck, month, jurisdiction) would
//      double a tax liability.
//   3. AN UNRECOGNISED JURISDICTION IS STILL STORED. Dropping a code we cannot price shrinks the
//      denominator of every share downstream and nothing on any surface would say so (D-IF7).
//   4. NO CLIENT WRITE PATH. A browser that can write jurisdiction miles can move a tax liability.
//
// Run:  node supabase/tests/samsara-ifta-miles.test.mjs
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
const all = async (q, p = []) => (await db.query(q, p)).rows;
/** The SQLSTATE a statement raises, or null when it succeeds. */
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
const USER = (await one(`insert into auth.users (id,email) values (gen_random_uuid(),'a@b.c') returning id`)).id;

const truck = async (org, unit) =>
  (await one(
    `insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,$2,240) returning id`,
    [org, unit])).id;
const V1 = await truck(ORG, "701");
const V2 = await truck(ORG, "702");
const VOTHER = await truck(OTHER, "999");

const fetchRow = async (org = ORG, year = 2026, month = 4, o = {}) =>
  (await one(
    `insert into samsara_ifta_fetches
       (org_id, period_year, period_month, echoed_year, echoed_month, vehicles_reported,
        rows_written, unmapped_vehicles, troubleshooting, provisional)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) returning id`,
    [org, year, month, o.echoedYear ?? year, o.echoedMonth ?? "April", o.vehicles ?? 2,
     o.rows ?? 3, o.unmapped ?? 0, JSON.stringify(o.tsh ?? { unassignedFuelTypeVehicles: 187 }),
     o.provisional ?? false])).id;

const miles = async (vehicle, jurisdiction, taxable, o = {}) =>
  db.query(
    `insert into samsara_ifta_jurisdiction_miles
       (org_id, vehicle_id, samsara_vehicle_id, period_year, period_month, jurisdiction,
        recognised, taxable_meters, total_meters, tax_paid_liters, fetch_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (org_id, vehicle_id, period_year, period_month, jurisdiction) do update set
       taxable_meters = excluded.taxable_meters, total_meters = excluded.total_meters,
       tax_paid_liters = excluded.tax_paid_liters, fetch_id = excluded.fetch_id,
       fetched_at = now()`,
    [o.org ?? ORG, vehicle, o.sid ?? "s-1", o.year ?? 2026, o.month ?? 4, jurisdiction,
     o.recognised ?? true, taxable, o.total ?? taxable, o.liters ?? 0, o.fetchId ?? null]);

const F1 = await fetchRow();

// ── 1. it holds metres ──────────────────────────────────────────────────────────────────────────
await miles(V1, "TX", 8570727.867, { total: 8570727.867, fetchId: F1 });
const tx = await one(`select * from samsara_ifta_jurisdiction_miles where vehicle_id=$1 and jurisdiction='TX'`, [V1]);
ok("the metres are stored as metres, to the thousandth",
  Number(tx.taxable_meters) === 8570727.867, String(tx.taxable_meters));
ok("and there is no miles column to be wrong about",
  !("taxable_miles" in tx) && !("miles" in tx), Object.keys(tx).join(","));

// ── 2. a re-fetch refreshes, it does not duplicate ──────────────────────────────────────────────
const F2 = await fetchRow(ORG, 2026, 4, { provisional: true });
await miles(V1, "TX", 9000000, { total: 9100000, fetchId: F2 });
const after = await all(`select * from samsara_ifta_jurisdiction_miles where vehicle_id=$1 and jurisdiction='TX'`, [V1]);
ok("re-fetching a month leaves ONE row for that truck and jurisdiction", after.length === 1, `got ${after.length}`);
ok("and it carries the newer figure", Number(after[0].taxable_meters) === 9000000);
ok("and points at the fetch that last wrote it", after[0].fetch_id === F2);
ok("two rows for one (truck, month, jurisdiction) are refused outright",
  (await sqlstate(
    `insert into samsara_ifta_jurisdiction_miles (org_id, vehicle_id, samsara_vehicle_id, period_year, period_month, jurisdiction)
     values ($1,$2,'s-1',2026,4,'TX')`, [ORG, V1])) === "23505");

// The same jurisdiction in a DIFFERENT month is a different fact and must coexist.
await miles(V1, "TX", 5000, { month: 5 });
ok("the same jurisdiction in another month is its own row",
  (await all(`select * from samsara_ifta_jurisdiction_miles where vehicle_id=$1 and jurisdiction='TX'`, [V1])).length === 2);

// ── 3. an unrecognised jurisdiction is stored, and flagged ──────────────────────────────────────
await miles(V2, "ZZ", 1234, { recognised: false, sid: "s-2" });
const zz = await one(`select * from samsara_ifta_jurisdiction_miles where jurisdiction='ZZ'`);
ok("a jurisdiction we cannot price is kept rather than dropped", zz != null);
ok("and marked, so a surface can report it as unpriceable rather than absent", zz.recognised === false);

// ── 4. the period is range-checked ──────────────────────────────────────────────────────────────
ok("a month outside 1..12 is refused",
  (await sqlstate(
    `insert into samsara_ifta_jurisdiction_miles (org_id, vehicle_id, samsara_vehicle_id, period_year, period_month, jurisdiction)
     values ($1,$2,'s-1',2026,13,'TX')`, [ORG, V1])) === "23514");
ok("and so is a year before the endpoint's own range",
  (await sqlstate(
    `insert into samsara_ifta_jurisdiction_miles (org_id, vehicle_id, samsara_vehicle_id, period_year, period_month, jurisdiction)
     values ($1,$2,'s-1',1999,4,'TX')`, [ORG, V1])) === "23514");

// ── 5. the fetch row is the account of the response ─────────────────────────────────────────────
const f = await one(`select * from samsara_ifta_fetches where id=$1`, [F1]);
ok("the troubleshooting block is stored as data, not logged",
  f.troubleshooting.unassignedFuelTypeVehicles === 187, JSON.stringify(f.troubleshooting));
ok("the period Samsara SAID it answered is kept beside the one we asked for",
  f.echoed_year === 2026 && f.echoed_month === "April");
ok("a provisional fetch says so", (await one(`select provisional from samsara_ifta_fetches where id=$1`, [F2])).provisional === true);

// ── 6. operational, not evidence: retention can prune it ────────────────────────────────────────
// Samsara restates recent periods, so these rows MUST be rewritable and removable. A filed quarter is
// a different object and gets its own append-only snapshot (S3).
ok("a row can be deleted — this table is operational and prunable by design",
  (await sqlstate(`delete from samsara_ifta_jurisdiction_miles where vehicle_id=$1 and period_month=5`, [V1])) === null);
// Losing the truck loses its miles; losing the FETCH does not, because the miles are the fact and the
// fetch is only the account of how they arrived.
await miles(V2, "NM", 777, { sid: "s-2", fetchId: F1 });
await db.query(`delete from samsara_ifta_fetches where id=$1`, [F1]);
ok("deleting a fetch leaves the miles, with a null fetch_id",
  (await one(`select fetch_id from samsara_ifta_jurisdiction_miles where jurisdiction='NM'`)).fetch_id === null);
const before = (await one(`select count(*)::int n from samsara_ifta_jurisdiction_miles where vehicle_id=$1`, [V2])).n;
await db.query(`delete from vehicles where id=$1`, [V2]);
ok("deleting a truck takes its miles with it",
  before > 0 && (await one(`select count(*)::int n from samsara_ifta_jurisdiction_miles where vehicle_id=$1`, [V2])).n === 0);

// ── 7. no client write path, and org scope on read ──────────────────────────────────────────────
async function asClient(org, role, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: USER, org_id: org, user_role: role, role: "authenticated" }),
    ]);
    const res = await db.query(sql, params);
    await db.exec("rollback");
    return { rows: res.rows, error: null };
  } catch (e) {
    await db.exec("rollback");
    return { rows: [], error: e.code ?? String(e.message) };
  }
}
for (const role of ["admin", "fleet_manager"]) {
  const ins = await asClient(ORG, role,
    `insert into samsara_ifta_jurisdiction_miles (org_id, vehicle_id, samsara_vehicle_id, period_year, period_month, jurisdiction)
     values ($1,$2,'s-x',2026,6,'OK')`, [ORG, V1]);
  ok(`a ${role} cannot write jurisdiction miles from the browser`, ins.error === "42501", String(ins.error));
}
await miles(VOTHER, "TX", 999, { org: OTHER, sid: "s-9" });
const mine = await asClient(ORG, "admin", `select count(*)::int n from samsara_ifta_jurisdiction_miles`);
const theirs = await asClient(OTHER, "admin", `select count(*)::int n from samsara_ifta_jurisdiction_miles`);
ok("a member reads only their own carrier's miles", mine.rows[0]?.n > 0 && theirs.rows[0]?.n === 1,
  JSON.stringify([mine.rows[0], theirs.rows[0]]));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
