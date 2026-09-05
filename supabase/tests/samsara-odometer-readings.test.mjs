// Silvicom 360 — samsara_odometer_readings matrix (migration 0311, W3b / D-FLEET9).
//
// This table is the only MEASURED distance the finance section has. Everything downstream of it —
// cost per mile, revenue per mile, the empty-mile percentage — is money divided by a number that
// comes from here, so the ways it can be wrong are all ways a plausible figure gets printed:
//
//   1. TWO READINGS FOR ONE TRUCK-DAY-COUNTER. The collector keeps the last reading of each local
//      day and upserts on that identity. A second row is not a duplicate, it is an ambiguity: two
//      answers to "what did the odometer read that day", and whichever the reader picks decides the
//      period's distance. The unique index is what makes the upsert a REPLACE.
//   2. TWO COUNTERS COLLAPSED INTO ONE. An ECU odometer starts at the engine's life and a GPS
//      distance counter at the gateway's install. If the identity did not include `source`, the two
//      would overwrite each other day by day and the resulting series would be differenced across
//      origins — a number with no meaning that reads like mileage.
//   3. A COUNTER THAT IS NOT A COUNTER. A cumulative odometer cannot be negative, and the vocabulary
//      is Samsara's three named counters. A sentinel or a typo landing here is one subtraction away
//      from a fleet denominator.
//   4. A CLIENT CAN TOUCH IT. RLS is enabled with no policy — deny-all on purpose (D-SEP1/D-SEP7).
//      A browser that could WRITE a reading could move a month's miles; one that could READ them
//      learns raw vendor counters that answer no operator question.
//   5. IT GETS FROZEN. This is operational staging, not evidence: the day in progress is re-collected
//      and REPLACED on the next tick. A future append-only hardening pass that treated it like
//      `certifications` would stop the collector converging, so that it stays writable is a DECISION
//      and is asserted here rather than assumed.
//
// Run:  node supabase/tests/samsara-odometer-readings.test.mjs
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
// Supabase's real default privileges, installed BEFORE the migrations — full DML granted, RLS is the
// gate. Without this a client "cannot insert" for the wrong reason and the test proves nothing.
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
const USER = (await one(`insert into auth.users (email) values ('ops@silvicom.test') returning id`)).id;

const truck = async (org, unit) =>
  (await one(
    `insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,$2,240) returning id`,
    [org, unit],
  )).id;
const T1 = await truck(ORG, "701");
const T2 = await truck(ORG, "702");
const T_OTHER = await truck(OTHER, "901");

// Real values: an ECU odometer in the hundreds of millions of metres, read late in the evening.
const stage = (org, vehicle, source, day, at, meters) =>
  sqlstate(
    `insert into samsara_odometer_readings (org_id, vehicle_id, source, day, reading_at, meters)
     values ($1,$2,$3,$4,$5,$6)`,
    [org, vehicle, source, day, at, meters],
  );

ok(
  "a reading can be staged",
  (await stage(ORG, T1, "obd", "2026-07-06", "2026-07-06T23:58:12Z", 663428113)) === null,
);

// ── 1. one reading per truck-day-counter ────────────────────────────────────────────────────────
ok(
  "a second ECU reading for the same truck-day is rejected — two answers to 'what did the odometer read' is not a duplicate, it is an ambiguity",
  (await stage(ORG, T1, "obd", "2026-07-06", "2026-07-06T21:00:00Z", 663400000)) === "23505",
);
ok(
  "the next day is a different row",
  (await stage(ORG, T1, "obd", "2026-07-07", "2026-07-07T22:10:00Z", 664100000)) === null,
);
ok(
  "and another truck's day is a different row again",
  (await stage(ORG, T2, "obd", "2026-07-06", "2026-07-06T23:40:00Z", 412850113)) === null,
);

// ── 2. the counter is part of the identity ──────────────────────────────────────────────────────
ok(
  "the same truck-day may hold BOTH counters — an ECU odometer and a GPS distance have different origins, so collapsing them would produce a subtraction with no meaning",
  (await stage(ORG, T1, "gps_distance", "2026-07-06", "2026-07-06T23:59:00Z", 120500000)) === null,
);
ok(
  "the third counter Samsara ranks is legal here even though the collector does not request it today — a later decision to collect it must not need a migration",
  (await stage(ORG, T2, "gps_odometer", "2026-07-06", "2026-07-06T23:45:00Z", 500000000)) === null,
);

// ── 3. a counter that is not a counter ──────────────────────────────────────────────────────────
ok(
  "a counter name outside Samsara's three is refused — the vocabulary is shared with the distance rule, and a typo would file readings nothing ever reads",
  (await stage(ORG, T1, "odometer", "2026-07-09", "2026-07-09T23:00:00Z", 1)) === "23514",
);
ok(
  "a negative counter is refused — a cumulative odometer cannot go below zero, so a negative value is a sentinel or a parse artefact",
  (await stage(ORG, T1, "obd", "2026-07-09", "2026-07-09T23:00:00Z", -1)) === "23514",
);
ok(
  "zero is NOT refused — a brand-new gateway legitimately reads zero, and only the collector decides whether a day had a reading at all",
  (await stage(ORG, T1, "obd", "2026-07-10", "2026-07-10T23:00:00Z", 0)) === null,
);

// ── 4. the day in progress is replaced, not appended ────────────────────────────────────────────
// The collector re-collects a rolling four-day window: today's "last reading so far" is superseded
// by a later one on the next tick. That is the whole reason the identity is a unique index rather
// than an append-only log.
const upserted = await sqlstate(
  `insert into samsara_odometer_readings (org_id, vehicle_id, source, day, reading_at, meters)
   values ($1,$2,'obd','2026-07-07','2026-07-07T23:55:00Z',664250000)
   on conflict (org_id, vehicle_id, source, day)
   do update set reading_at = excluded.reading_at, meters = excluded.meters, synced_at = now()`,
  [ORG, T1],
);
const replaced = await one(
  `select reading_at, meters from samsara_odometer_readings
   where org_id=$1 and vehicle_id=$2 and source='obd' and day='2026-07-07'`,
  [ORG, T1],
);
ok(
  "re-collecting the day in progress REPLACES its reading — this table is operational staging, not evidence, and a frozen row would stop the collector converging",
  upserted === null && Number(replaced.meters) === 664250000,
  JSON.stringify(replaced),
);

// ── 5. no client path at all, in either direction ───────────────────────────────────────────────
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
    `insert into samsara_odometer_readings (org_id, vehicle_id, source, day, reading_at, meters)
     values ($1,$2,'obd','2026-07-11','2026-07-11T23:00:00Z',999999999)`, [ORG, T1]);
  ok(`${role} cannot mint a reading from the browser — that is how a month's miles get moved`, ins.error === "42501");

  // An UPDATE or DELETE against a table with no matching policy does not RAISE — RLS simply matches
  // no rows and the statement reports success having changed nothing. Both are asserted on the
  // EFFECT rather than on an error that never comes.
  const upd = await asClient(ORG, role,
    `with u as (update samsara_odometer_readings set meters = 1 where org_id=$1 returning 1)
     select count(*)::int n from u`, [ORG]);
  ok(`nor rewind one`, upd.error === null && upd.rows[0]?.n === 0, JSON.stringify(upd));

  const del = await asClient(ORG, role,
    `with d as (delete from samsara_odometer_readings where org_id=$1 returning 1) select count(*)::int n from d`, [ORG]);
  ok(`nor delete one`, del.error === null && del.rows[0]?.n === 0, JSON.stringify(del));

  const sel = await asClient(ORG, role, `select count(*)::int n from samsara_odometer_readings where org_id=$1`, [ORG]);
  ok(`and ${role} cannot read one either — deny-all, because a raw vendor counter answers no operator question`,
    sel.error === null && sel.rows[0]?.n === 0, JSON.stringify(sel));
}

ok(
  "the collector still sees its own readings — the service role bypasses RLS, which is why every read it makes must org-filter itself",
  (await one(`select count(*)::int n from samsara_odometer_readings where org_id=$1`, [ORG])).n === 6,
);

// ── 6. a reading belongs to a truck, and a truck to a carrier ───────────────────────────────────
// Both FKs are asserted from the catalog as well as behaviourally: a reading that outlived its truck
// would be a mileage row for equipment the fleet does not hold, and one that outlived its carrier
// would be another tenant's history in a shared table. `c` is ON DELETE CASCADE.
const cascades = (await db.query(
  `select conname, confdeltype, confrelid::regclass::text as parent
     from pg_constraint
    where conrelid = 'samsara_odometer_readings'::regclass and contype = 'f'
    order by parent`,
)).rows;
ok(
  "both foreign keys cascade — a reading never outlives the truck or the carrier it belongs to",
  cascades.length === 2 && cascades.every((c) => c.confdeltype === "c"),
  JSON.stringify(cascades),
);

await db.query(`delete from vehicles where id=$1`, [T2]);
ok(
  "retiring a truck takes its readings with it — nothing is left pointing at equipment the fleet no longer holds",
  (await one(`select count(*)::int n from samsara_odometer_readings where vehicle_id=$1`, [T2])).n === 0,
);
ok(
  "and the other truck's readings are untouched — a retirement is not a purge",
  (await one(`select count(*)::int n from samsara_odometer_readings where vehicle_id=$1`, [T1])).n === 4,
);

// The other carrier's readings were never visible above and are not now: the tenant boundary in a
// shared table is the org column, and the service role has no policy standing between it and them.
await db.query(
  `insert into samsara_odometer_readings (org_id, vehicle_id, source, day, reading_at, meters)
   values ($1,$2,'obd','2026-07-06','2026-07-06T23:00:00Z',1000)`, [OTHER, T_OTHER]);
ok(
  "another carrier's reading is a row of its own, invisible to every query that filters by org",
  (await one(`select count(*)::int n from samsara_odometer_readings where org_id=$1`, [ORG])).n === 4 &&
    (await one(`select count(*)::int n from samsara_odometer_readings where org_id=$1`, [OTHER])).n === 1,
);

// Release the WASM database before the verdict. This matrix exits explicitly only when it FAILS, so
// on the green path Node had to drain PGlite's handles on its own — ~10 seconds of idle wait after
// the last assertion, paid once per matrix per run. Measured 2026-09-05: 11.33s -> 1.32s here.
await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
