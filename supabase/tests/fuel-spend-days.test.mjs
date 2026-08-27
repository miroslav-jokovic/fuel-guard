// FuelGuard — fuel spend rollup matrix (migration 0244).
//
// 0244 is the join that answers "fuel cost more this week — why": what we bought, how far the truck
// went, and how long its engine ran, at one grain. Four of its properties fail silently rather than
// loudly, and each one produces a plausible WRONG number rather than an error, so each gets rows here:
//
//   1. THE UNATTRIBUTED ROW UPSERTS. 0.88% of fills carry no vehicle, and they are kept (D-FS2) so the
//      report ties to the actual bill. A plain unique index treats every null vehicle as a distinct
//      key, so the nightly rebuild would insert a second unattributed row every night and the fuel
//      total would climb on its own. `nulls not distinct` is the whole defence; these rows prove it.
//   2. MILES AND THEIR GALLONS TRAVEL TOGETHER. Fleet MPG is miles / mpg_gallons, never
//      miles / gallons_tractor (D-FS3), and because miles are allocated across the days of their
//      interval a row can carry either one without the other only by mistake. Miles alone read as free
//      distance and inflate MPG; gallons alone read as distance-free fuel and deflate it.
//   3. DERIVED, THEREFORE MUTABLE. The inverse of the 0243 statement matrix, and worth pinning: this
//      table is a cache and a rebuild MUST be able to overwrite it (D-FS5). A future append-only
//      trigger added here by analogy with fuel_statements would break every rebuild.
//   4. ORG ISOLATION + DENY-ALL WRITES. The API derives this with the service role, which BYPASSES
//      RLS, so the select policy is all that separates two carriers' fuel spend — and a browser must
//      not be able to assert a spend day at all.
//
// Applies EVERY migration, same as rls.test.mjs, so the constraints under test are the ones production
// runs.
//
// Run:  node supabase/tests/fuel-spend-days.test.mjs
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
const truck = async (org, unit) =>
  (
    await one(
      `insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,$2,150) returning id`,
      [org, unit],
    )
  ).id;
const T754 = await truck(ORG, "754");
const T729 = await truck(ORG, "729");
const OTHER_TRUCK = await truck(OTHER_ORG, "754");

/** Write a rollup day the way the nightly rebuild does — full payload, conflict on the natural key. */
const upsertDay = (org, vehicle, day, o = {}) =>
  db.query(
    `insert into fuel_spend_days
       (org_id, vehicle_id, day, fills, gallons_tractor, gallons_reefer, gallons_def,
        spend_tractor, spend_reefer, spend_def, miles, mpg_gallons, miles_basis, miles_rejected,
        drive_sec, idle_sec, off_sec, coverage_sec)
     values ($1,$2,$3,$4,$5,0,0,$6,0,0,$7,$8,$9,0,$10,$11,0,86400)
     on conflict (org_id, vehicle_id, day) do update set
       fills = excluded.fills, gallons_tractor = excluded.gallons_tractor,
       spend_tractor = excluded.spend_tractor, miles = excluded.miles,
       mpg_gallons = excluded.mpg_gallons, miles_basis = excluded.miles_basis,
       drive_sec = excluded.drive_sec, idle_sec = excluded.idle_sec`,
    [
      org, vehicle, day,
      o.fills ?? 1, o.gallons ?? 120, o.spend ?? 620.4,
      o.miles ?? 900, o.mpgGallons ?? 120, o.basis ?? "drive_time",
      o.driveSec ?? 32400, o.idleSec ?? 28800,
    ],
  );

// ── 1. the unattributed row upserts instead of multiplying (D-FS2) ───────────────────────────────
await upsertDay(ORG, null, "2026-08-17", { gallons: 300, spend: 1560 });
await upsertDay(ORG, null, "2026-08-17", { gallons: 310, spend: 1610 });
const unattributed = await one(
  `select count(*)::int c, max(gallons_tractor) g from fuel_spend_days where org_id=$1 and vehicle_id is null and day='2026-08-17'`,
  [ORG],
);
ok(
  "a second rebuild UPDATES the unattributed row rather than inserting a second one",
  unattributed.c === 1,
  `got ${unattributed.c} rows`,
);
ok("and it carries the newest derivation, not the first", Number(unattributed.g) === 310);

// The same day for a real truck is a different row — the null key must not swallow attributed fuel.
await upsertDay(ORG, T754, "2026-08-17");
ok(
  "an attributed truck-day is a separate row from the unattributed one",
  (await one(`select count(*)::int c from fuel_spend_days where org_id=$1 and day='2026-08-17'`, [ORG])).c === 2,
);

// ── 2. org isolation at the key level ────────────────────────────────────────────────────────────
await upsertDay(OTHER_ORG, OTHER_TRUCK, "2026-08-17");
await upsertDay(OTHER_ORG, null, "2026-08-17");
ok(
  "two carriers can hold the same day — including the same unattributed day",
  (await one(`select count(*)::int c from fuel_spend_days where day='2026-08-17'`)).c === 4,
);

// ── 3. miles and their gallons travel together (D-FS3) ───────────────────────────────────────────
ok(
  "miles with no gallons behind them are refused — that reads as free distance and inflates MPG",
  (await sqlstate(
    `insert into fuel_spend_days (org_id, vehicle_id, day, miles, mpg_gallons, miles_basis)
     values ($1,$2,'2026-08-18', 900, 0, 'drive_time')`,
    [ORG, T729],
  )) === "23514",
);
ok(
  "and gallons with no miles behind them are refused — that deflates it",
  (await sqlstate(
    `insert into fuel_spend_days (org_id, vehicle_id, day, miles, mpg_gallons, miles_basis)
     values ($1,$2,'2026-08-18', 0, 120, 'drive_time')`,
    [ORG, T729],
  )) === "23514",
);
ok(
  "a day whose interval was rejected keeps its gallons bought and carries neither miles nor mpg gallons",
  (await sqlstate(
    `insert into fuel_spend_days (org_id, vehicle_id, day, gallons_tractor, mpg_gallons, miles, miles_basis, miles_rejected)
     values ($1,$2,'2026-08-19', 120, 0, 0, 'none', 1)`,
    [ORG, T729],
  )) === null,
);
ok(
  "a day driven THROUGH carries miles and their gallons while having bought nothing — allocation, not a bug",
  (await sqlstate(
    `insert into fuel_spend_days (org_id, vehicle_id, day, fills, gallons_tractor, miles, mpg_gallons, miles_basis)
     values ($1,$2,'2026-08-21', 0, 0, 610, 81.2, 'drive_time')`,
    [ORG, T729],
  )) === null,
);
ok(
  "miles_basis is closed — an unrecognised allocation rule is refused, not stored",
  (await sqlstate(
    `insert into fuel_spend_days (org_id, vehicle_id, day, miles_basis) values ($1,$2,'2026-08-20','guessed')`,
    [ORG, T729],
  )) === "23514",
);

// ── 4. derived, therefore mutable — the inverse of 0243 (D-FS5) ──────────────────────────────────
ok(
  "a rebuild may overwrite a spend day in place; this table is a cache, not evidence",
  (await sqlstate(`update fuel_spend_days set miles = 1234 where org_id=$1 and vehicle_id=$2 and day='2026-08-17'`, [ORG, T754])) === null,
);
ok(
  "and fuel_spend_days is NOT pinned as an evidence table",
  !read("../apps/api/src/modules/org/dataRetention.ts").includes('"fuel_spend_days"'),
);
// A stale `updated_at` is how a rebuild that silently stopped running looks like a rebuild that ran,
// so the trigger has to actually move it — asserted, not assumed from the trigger's existence.
// Read the stamp as TEXT and compare it in Postgres: the driver hands JS a Date, which is truncated to
// milliseconds, and two consecutive statements land inside the same millisecond often enough that a
// JS-side comparison is a coin flip rather than a test.
const stampSql = `select updated_at::text t from fuel_spend_days where org_id=$1 and vehicle_id=$2 and day='2026-08-17'`;
const before = (await one(stampSql, [ORG, T754])).t;
// `set_updated_at` writes now(), which is TRANSACTION time, and PGlite's clock is coarse enough that
// two statements this close can share a stamp. Step past it so the assertion tests the trigger and not
// the resolution of the clock underneath it.
await db.query(`select pg_sleep(0.01)`);
await db.query(`update fuel_spend_days set miles = 1235, mpg_gallons = 160 where org_id=$1 and vehicle_id=$2 and day='2026-08-17'`, [ORG, T754]);
const after = (await one(stampSql, [ORG, T754])).t;
ok(
  "the updated_at trigger moves the stamp, so a rebuild that stopped running is visible",
  (await one(`select $1::timestamptz > $2::timestamptz as moved`, [after, before])).moved === true,
  `${before} -> ${after}`,
);

// ── 5. cascade: a derived row must not outlive what it describes ─────────────────────────────────
await db.query(`delete from vehicles where id=$1`, [T754]);
ok(
  "retiring a truck removes its derived spend days rather than orphaning them",
  (await one(`select count(*)::int c from fuel_spend_days where vehicle_id=$1`, [T754])).c === 0,
);

// ── 6. RLS: read for org members, deny-all writes ────────────────────────────────────────────────
ok(
  "row level security is enabled",
  (await one(`select relrowsecurity b from pg_class where relname='fuel_spend_days'`)).b === true,
);
const policies = (await db.query(`select cmd from pg_policies where tablename='fuel_spend_days'`)).rows;
ok(
  "the only policy is SELECT — a browser cannot assert a day of fuel spend",
  policies.length === 1 && policies[0].cmd === "SELECT",
  JSON.stringify(policies),
);

// ── 7. the conflict target the rollup writes against exists and is inferable ─────────────────────
const idx = await one(
  `select indexdef from pg_indexes where tablename='fuel_spend_days' and indexname='uq_fuel_spend_days_key'`,
);
ok("the natural key is a unique index", idx !== undefined && /unique/i.test(idx.indexdef));
ok(
  "declared NULLS NOT DISTINCT, which is what makes the unattributed row upsertable",
  idx !== undefined && /nulls not distinct/i.test(idx.indexdef),
  idx?.indexdef,
);
ok(
  "and it is not partial, so ON CONFLICT can infer it",
  idx !== undefined && !/ where /i.test(idx.indexdef),
  idx?.indexdef,
);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
