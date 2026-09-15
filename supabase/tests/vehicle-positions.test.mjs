// FuelGuard — vehicle_positions (migration 0341, LIVE-MAP-PLAN.md LM2 / D-LM16).
//
// The live map draws a dot per truck from this table. Three properties have to hold in the DATABASE
// rather than in the collector, because the collector is the thing most likely to be wrong:
//
//   · ONE ROW PER VEHICLE. The owner ruled there is no history here (Samsara keeps it), so a second
//     row for the same truck must be impossible rather than merely unusual. If the PK were wrong the
//     table would quietly become an append log at 205 trucks x 12 fixes a minute, and the first
//     symptom would be a map drawing a truck at two places at once.
//   · A POSITION CANNOT BELONG TO ANOTHER ORG'S TRUCK. The composite FK is the whole guarantee, and
//     it needed a unique on `vehicles (id, org_id)` that LM2 wrongly assumed already existed.
//   · THE WRITER ONLY EVER MOVES A TRUCK FORWARD IN TIME. Added with 0342 (LM4). The delta feed is
//     at-least-once BY DESIGN, so a re-delivered page carries fixes we already stored — and with no
//     history here, an older fix written over a newer one is unrecoverable and makes a live truck
//     look stale. `record_vehicle_positions` is a function rather than an upsert for exactly this
//     one line, so this is where the line is proven.
//   · COORDINATES ARE RANGE-BOUND, and deliberately not hemisphere-bound. Writing this matrix is
//     what caught the migration header claiming otherwise: a west-positive `+88` is NOT refused,
//     because +88 is a legal longitude and a carrier east of Greenwich would run a fleet of them.
//     Sign correction is the collector's job. The schema's job is to refuse -181 and +91.
//
// Run:  node supabase/tests/vehicle-positions.test.mjs
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
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text,
    name text, owner uuid, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]; $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin; create role authenticated nologin;
  create role anon nologin; create role service_role nologin bypassrls;
`);
for (const f of MIGRATIONS) {
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));
}

const ORG_A = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier A') returning id`)).id;
const ORG_B = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Carrier B') returning id`)).id;
/** `vehicles` carries NOT NULL columns with no default; one helper so a future one is fixed once. */
const truck = async (org, unit) =>
  (await one(
    `insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,$2,150) returning id`,
    [org, unit],
  )).id;

const TRUCK_A = await truck(ORG_A, "1207");
const TRUCK_B = await truck(ORG_B, "5533");

const put = (org, vehicle, cols = "", vals = "") =>
  sqlstate(
    `insert into vehicle_positions (org_id, vehicle_id, lat, lng, sampled_at ${cols})
     values ($1, $2, 44.51, -88.01, now() ${vals})`,
    [org, vehicle],
  );

// ── the happy path ───────────────────────────────────────────────────────────────────────────────
ok("a fix stores for a vehicle in its own org", (await put(ORG_A, TRUCK_A)) === null);

// ── one row per vehicle: the no-history ruling, enforced ─────────────────────────────────────────
ok(
  "a SECOND fix for the same truck is refused — this table has no history by construction (D-LM16)",
  (await put(ORG_A, TRUCK_A)) === "23505",
);
ok(
  "and the update path is what a collector must use instead",
  (await sqlstate(
    `update vehicle_positions set lat = 45.0, sampled_at = now() where org_id = $1 and vehicle_id = $2`,
    [ORG_A, TRUCK_A],
  )) === null,
);
ok("after the update there is still exactly one row for that truck",
  Number((await one(`select count(*) n from vehicle_positions where vehicle_id = $1`, [TRUCK_A])).n) === 1);

// ── cross-tenant: the composite FK is the guarantee ──────────────────────────────────────────────
ok(
  "a position may NOT claim another org's truck — the whole reason the FK is composite",
  (await put(ORG_B, TRUCK_A)) === "23503",
);
ok("the same truck under its own org is fine", (await put(ORG_B, TRUCK_B)) === null);

// ── coordinates: a sign bug must be refused, not drawn ───────────────────────────────────────────
// The bounds are a RANGE check, NOT a hemisphere check, and this pins the distinction on purpose:
// an earlier draft of the migration header claimed +88 would be refused. It is not, and it must not
// be — +88 is a legal longitude, and a carrier east of Greenwich would run a fleet of them. Writing
// "western hemisphere" into the schema would encode one customer's geography for every customer.
// Sign correction is the collector's job (`toWesternLongitude`, unit-tested where it can fail).
ok("a positive longitude is ADMITTED — the schema bounds the range, it does not pick a hemisphere",
  (await sqlstate(
    `insert into vehicle_positions (org_id, vehicle_id, lat, lng, sampled_at)
     values ($1,$2,44.51,88.01,now())`, [ORG_A, await truck(ORG_A, "9001")],
  )) === null);
ok("latitude past the pole is refused",
  (await sqlstate(
    `insert into vehicle_positions (org_id, vehicle_id, lat, lng, sampled_at)
     values ($1,$2,91,-88.01,now())`, [ORG_A, TRUCK_B],
  )) === "23514");
ok("longitude past the antimeridian is refused",
  (await sqlstate(
    `insert into vehicle_positions (org_id, vehicle_id, lat, lng, sampled_at)
     values ($1,$2,44.5,-181,now())`, [ORG_A, TRUCK_B],
  )) === "23514");

// ── heading: [0, 360), so north has exactly one spelling ─────────────────────────────────────────
const TRUCK_H = await truck(ORG_A, "7001");
ok("heading 0 is admitted", (await put(ORG_A, TRUCK_H, ", heading_degrees", ", 0")) === null);
await db.query(`delete from vehicle_positions where vehicle_id = $1`, [TRUCK_H]);
ok("heading 359.9 is admitted", (await put(ORG_A, TRUCK_H, ", heading_degrees", ", 359.9")) === null);
await db.query(`delete from vehicle_positions where vehicle_id = $1`, [TRUCK_H]);
ok(
  "heading 360 is REFUSED — north has one spelling, or two writers disagree about the same bearing",
  (await put(ORG_A, TRUCK_H, ", heading_degrees", ", 360")) === "23514",
);
ok("a negative speed is refused", (await put(ORG_A, TRUCK_H, ", speed_mph", ", -1")) === "23514");
ok("an empty source is refused", (await put(ORG_A, TRUCK_H, ", source", ", '  '")) === "23514");

// ── absent is not zero, and not false (the D-LM12 lesson) ────────────────────────────────────────
const row = await one(`select heading_degrees, speed_mph, is_ecu_speed, formatted_location, source
                       from vehicle_positions where vehicle_id = $1`, [TRUCK_A]);
ok("a fix with no heading stores NULL rather than 0 — absent is not 'pointing north'", row.heading_degrees === null);
ok("a fix with no speed stores NULL rather than 0 — absent is not 'stopped'", row.speed_mph === null);
ok("is_ecu_speed is NULL rather than false when the vendor did not say", row.is_ecu_speed === null);
ok("source defaults to samsara", row.source === "samsara");

// ── lifecycle ────────────────────────────────────────────────────────────────────────────────────
await db.query(`delete from vehicles where id = $1`, [TRUCK_B]);
ok("retiring a vehicle takes its position with it",
  Number((await one(`select count(*) n from vehicle_positions where vehicle_id = $1`, [TRUCK_B])).n) === 0);

// ── RLS: on, and deliberately without a policy (D-LM11 — the API reads it, not the browser) ──────
const rls = await one(
  `select relrowsecurity, (select count(*) from pg_policies where tablename = 'vehicle_positions') pol
     from pg_class where relname = 'vehicle_positions'`,
);
ok("row level security is enabled", rls.relrowsecurity === true);
ok("and carries no client policy — deny-all on purpose, the API reads with the service role",
  Number(rls.pol) === 0);

// ── the unique LM2 assumed already existed, and did not ──────────────────────────────────────────
ok("vehicles carries the (id, org_id) unique the composite FK needs",
  Number((await one(`select count(*) n from pg_constraint where conname = 'vehicles_id_org_key'`)).n) === 1);

// ── 0342: the writer, and the only-go-forward guard that is the reason it is a function ──────────
const W1 = await truck(ORG_A, "8801");
const W2 = await truck(ORG_A, "8802");
const T = (min) => new Date(Date.UTC(2026, 8, 15, 14, min, 0)).toISOString();
const record = (org, rows) =>
  one(`select public.record_vehicle_positions($1, $2::jsonb) n`, [org, JSON.stringify(rows)]);
const fixAt = (vehicle_id, min, over = {}) => ({
  vehicle_id, lat: 44.5, lng: -88.0, heading_degrees: 90, speed_mph: 55,
  is_ecu_speed: true, formatted_location: "Green Bay, WI", sampled_at: T(min), ...over,
});

ok("the writer inserts a tick's worth of trucks in one call",
  Number((await record(ORG_A, [fixAt(W1, 10), fixAt(W2, 10)])).n) === 2);

ok("a NEWER fix advances the row",
  Number((await record(ORG_A, [fixAt(W1, 20, { lat: 45.5 })])).n) === 1);
ok("and the row now carries the newer coordinate",
  Number((await one(`select lat from vehicle_positions where vehicle_id = $1`, [W1])).lat) === 45.5);

// The at-least-once re-delivery. Without the guard this is the write that makes a moving truck jump
// backwards and then sit there looking stale until it moves again.
ok("an OLDER fix is refused rather than overwriting the newer one",
  Number((await record(ORG_A, [fixAt(W1, 15, { lat: 40.0 })])).n) === 0);
ok("the row is untouched by the re-delivery",
  Number((await one(`select lat from vehicle_positions where vehicle_id = $1`, [W1])).lat) === 45.5);
ok("an IDENTICAL re-delivery is also refused — the row is already right, and received_at must not lie",
  Number((await record(ORG_A, [fixAt(W1, 20)])).n) === 0);

ok("still exactly one row per truck after four writes",
  Number((await one(`select count(*) n from vehicle_positions where vehicle_id = $1`, [W1])).n) === 1);

// Tenant scope is the ARGUMENT, never a value in the payload (the rule 0175 states in its WHERE).
ok("the writer refuses another org's truck — the composite FK, reached through the function",
  (await sqlstate(`select public.record_vehicle_positions($1, $2::jsonb)`,
    [ORG_B, JSON.stringify([fixAt(W1, 30)])])) === "23503");

// ⚠ This assertion exists because the first draft of this matrix did NOT have it, and a mutant that
// read the tenant from the payload (`coalesce(r.org_id, p_org)`) passed all 34 other checks — no
// fixture row had ever carried an `org_id` at all, so the two implementations were indistinguishable.
// A payload that names another org must be IGNORED, not honoured and not refused.
// Wrapped, because a writer that HONOURED the payload's org would hit the composite FK and throw —
// and an exception here would kill the matrix before its RESULT line instead of naming the defect.
const smuggled = await (async () => {
  try { return Number((await record(ORG_A, [{ ...fixAt(W1, 50), org_id: ORG_B }])).n); }
  catch (e) { return `threw ${e.code ?? e.message}`; }
})();
ok("an org_id smuggled into a payload row is ignored — tenant scope is the ARGUMENT (0175's rule)",
  smuggled === 1, String(smuggled));
ok("and the row is still the caller org's, not the one the payload named",
  (await one(`select org_id from vehicle_positions where vehicle_id = $1`, [W1])).org_id === ORG_A);

ok("a row with no coordinate is skipped rather than failing the whole tick",
  Number((await record(ORG_A, [{ vehicle_id: W2, lat: null, lng: null, sampled_at: T(40) }, fixAt(W2, 40)])).n) === 1);
ok("an empty payload is a no-op, not an error", Number((await record(ORG_A, [])).n) === 0);
ok("a null payload is a no-op too", Number((await one(
  `select public.record_vehicle_positions($1, null::jsonb) n`, [ORG_A])).n) === 0);

ok("the writer is not reachable by a browser role",
  (await one(`select has_function_privilege('authenticated',
     'public.record_vehicle_positions(uuid, jsonb)', 'execute') g`)).g === false);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
