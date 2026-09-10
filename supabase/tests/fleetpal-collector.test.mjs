// Silvicom 360 — the FleetPal collector's four tables (migration 0334, FLEETPAL-INTEGRATION-PLAN F2).
//
// FleetPal is the ONLY source in this stack that knows what one truck cost to repair. That makes
// `fleetpal_units` the row every per-unit maintenance figure is computed through, and it makes four
// silent failures worth a matrix of their own — each destroys a different guarantee, and none of
// them raises anything at the application layer:
//
//   1. A ROW RESOLVES TO ANOTHER CARRIER'S TRUCK. `vehicle_id uuid references vehicles(id)` is
//      satisfied by any org's vehicle, because neither `vehicles` nor `trailers` carries an
//      `(id, org_id)` unique constraint to point a composite key at. This is IV012 arriving for the
//      fourth time in this programme (0332 found it, 0333 wrote the guard, this calls it), and here
//      it would attribute one carrier's repair cost to another carrier's truck.
//   2. A ROW SAYS ONE THING AND MEANS ANOTHER. `match_method='unmatched'` with a vehicle attached,
//      or `match_method='vin'` with nothing attached. Both parse, both store, and both make the
//      unmatched worklist D-FP14 requires either under- or over-count — which is the one number on
//      the page whose job is to say how much the report is missing.
//   3. TWO ROWS FOR ONE FLEETPAL UNIT. Not a duplicate: two answers to "which truck is this", and
//      whichever a reader picks decides whose cost is whose.
//   4. A CLIENT CAN TOUCH ANY OF IT. RLS on, no policies, deny-all on purpose. A browser that could
//      rewind a watermark could skip a window of repair history on purpose; one that could read a
//      credential row gets a sealed envelope, but the row should not be reachable at all.
//
// And one DECISION asserted so a later hardening pass has to argue with a failing test: none of
// these four is evidence. The watermark must stay advanceable and the delivery ledger prunable — a
// future append-only sweep that froze them would stop the collector dead.
//
// Run:  node supabase/tests/fleetpal-collector.test.mjs
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
const USER = (await one(`insert into auth.users (email) values ('shop@silvicom.test') returning id`)).id;

const mkVehicle = async (org, unit) =>
  (await one(
    `insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,$2,150) returning id`,
    [org, unit],
  )).id;
const mkTrailer = async (org, unit) =>
  (await one(`insert into trailers (org_id, unit_number) values ($1,$2) returning id`, [org, unit])).id;

const TRUCK_654 = await mkVehicle(ORG, "654");
const TRAILER_4102 = await mkTrailer(ORG, "4102");
const THEIR_TRUCK = await mkVehicle(OTHER, "901");
const THEIR_TRAILER = await mkTrailer(OTHER, "9001");

const addUnit = (org, fpId, extra = "") =>
  sqlstate(
    `insert into fleetpal_units (org_id, fleetpal_id, number, vin ${extra ? "," + Object.keys(JSON.parse(extra)).join(",") : ""})
     values ($1,$2,$3,$4 ${extra ? "," + Object.values(JSON.parse(extra)).map((v) => (v === null ? "null" : `'${v}'`)).join(",") : ""})`,
    [org, fpId, fpId, `1FUJGLDR8CLBP${fpId.slice(-4).padStart(4, "0")}`],
  );

// ── 1. the credential ───────────────────────────────────────────────────────────────────────────
ok(
  "a credential row exists before a key does — the collector is configured off, not half-configured",
  (await sqlstate(`insert into fleetpal_credentials (org_id) values ($1)`, [ORG])) === null,
);
const cred = await one(`select enabled, base_url, api_key_sealed from fleetpal_credentials where org_id=$1`, [ORG]);
ok("and it is disabled by default — nothing polls a vendor because a row appeared", cred.enabled === false);
ok("with the vendor's documented host as the default", cred.base_url === "https://openapi.fleetpal.io");
ok(
  "and no key, which is what the collector refuses to run without rather than falling back to anything",
  cred.api_key_sealed === null,
);
ok(
  "a blank base_url is refused — an empty host is a request to nowhere that reads as a configuration",
  (await sqlstate(`update fleetpal_credentials set base_url='   ' where org_id=$1`, [ORG])) === "23514",
);
ok(
  "one credential per org — a second is two answers to 'which key'",
  (await sqlstate(`insert into fleetpal_credentials (org_id) values ($1)`, [ORG])) === "23505",
);

// ── 2. the watermarks ───────────────────────────────────────────────────────────────────────────
const seedState = (org, resource, wm = null) =>
  sqlstate(`insert into fleetpal_sync_state (org_id, resource, watermark) values ($1,$2,$3)`, [org, resource, wm]);

ok("a resource can be seeded with no watermark, which is what makes the first sweep a full walk",
  (await seedState(ORG, "work-orders")) === null);
ok("a second row for the same resource is rejected", (await seedState(ORG, "work-orders")) === "23505");
ok("but one org holds a row per resource", (await seedState(ORG, "service-history")) === null);
ok("and another carrier's row for the same resource is a different row entirely",
  (await seedState(OTHER, "work-orders")) === null);
ok("a resource with no name is refused", (await seedState(ORG, "   ")) === "23514");
ok("as is a negative row count", (await sqlstate(
  `insert into fleetpal_sync_state (org_id, resource, rows_seen) values ($1,'defects',-1)`, [ORG])) === "23514");

// The bounded-re-read tier is a SECOND column and not the same one. `defects` and `expirations` have
// no `updated` field in the vendor's model at all, so they can never carry a watermark — and writing
// their `detected_after`/`created_after` position into `watermark` would make a later reader resume
// as if it were one, skipping everything that changed without being re-created.
ok(
  "a windowed resource records where its window reached, separately from a watermark it can never have",
  (await sqlstate(
    `insert into fleetpal_sync_state (org_id, resource, window_end) values ($1,'defects','2026-09-01T00:00:00Z')`,
    [ORG],
  )) === null,
);
const defects = await one(`select watermark, window_end from fleetpal_sync_state where org_id=$1 and resource='defects'`, [ORG]);
ok("and its watermark stays null, which is the honest value for a resource the vendor gives no updated column",
  defects.watermark === null && defects.window_end !== null);

const wmBefore = await one(`select updated_at from fleetpal_sync_state where org_id=$1 and resource='work-orders'`, [ORG]);
await db.query(`select pg_sleep(0.01)`);
ok(
  "a watermark advances — this table is operational, and freezing it as evidence would stop the collector dead",
  (await sqlstate(
    `update fleetpal_sync_state set watermark=$1, last_run_at=now() where org_id=$2 and resource='work-orders'`,
    ["2026-09-10T00:00:00Z", ORG],
  )) === null,
);
const wmAfter = await one(`select watermark, updated_at from fleetpal_sync_state where org_id=$1 and resource='work-orders'`, [ORG]);
ok("and updated_at moves with it, so a stalled sweep cannot report itself as fresh",
  new Date(wmAfter.updated_at).getTime() > new Date(wmBefore.updated_at).getTime());
ok("a watermark can be dropped and re-seeded — losing one costs a re-read, never a fact",
  (await sqlstate(`delete from fleetpal_sync_state where org_id=$1 and resource='service-history'`, [ORG])) === null);

// ── 3. identity: the row every per-unit cost figure is computed through ──────────────────────────
ok("an unmatched unit is a perfectly good row — D-FP14 makes it a visible state, not an error",
  (await addUnit(ORG, "Vn7kPq2R")) === null);
const un = await one(`select match_method, matched_at from fleetpal_units where org_id=$1 and fleetpal_id='Vn7kPq2R'`, [ORG]);
ok("and it defaults to saying so", un.match_method === "unmatched" && un.matched_at === null);

ok("the same FleetPal unit cannot arrive twice — that is two answers to 'which truck is this'",
  (await addUnit(ORG, "Vn7kPq2R")) === "23505");
ok("though another carrier's FleetPal account may use the very same opaque id",
  (await addUnit(OTHER, "Vn7kPq2R")) === null);

const resolve = (org, fpId, vehicle, trailer, method = "vin") =>
  sqlstate(
    `update fleetpal_units set vehicle_id=$1, trailer_id=$2, match_method=$3, matched_at=now()
      where org_id=$4 and fleetpal_id=$5`,
    [vehicle, trailer, method, org, fpId],
  );

ok("a unit resolves to one of our trucks", (await resolve(ORG, "Vn7kPq2R", TRUCK_654, null)) === null);
await addUnit(ORG, "Tr4102xy");
ok("and another to one of our trailers, which are the majority of the fleet",
  (await resolve(ORG, "Tr4102xy", null, TRAILER_4102, "number")) === null);

// ⚠ THE ASSERTION THIS MATRIX EXISTS FOR. The FK is satisfied; the org is not.
ok(
  "⚠ a unit may NOT resolve to another carrier's truck — the foreign key allows it and IV012 is what refuses",
  (await resolve(ORG, "Vn7kPq2R", THEIR_TRUCK, null)) === "IV012",
);
ok(
  "...nor to another carrier's trailer, which is the same hole in the other holder",
  (await resolve(ORG, "Vn7kPq2R", null, THEIR_TRAILER)) === "IV012",
);
ok(
  "...and the guard fires on INSERT too, not only on the resolving update",
  (await sqlstate(
    `insert into fleetpal_units (org_id, fleetpal_id, vehicle_id, match_method, matched_at)
     values ($1,'Xx1','${THEIR_TRUCK}','vin',now())`, [ORG])) === "IV012",
);

// A repair from March belongs to the truck that was running in March, whatever its status today.
const RETIRED = await mkVehicle(ORG, "301");
await db.query(`update vehicles set status='retired' where id=$1`, [RETIRED]);
await addUnit(ORG, "Old301aa");
ok(
  "a retired truck still resolves — its historic work orders are exactly what a cost history is made of",
  (await resolve(ORG, "Old301aa", RETIRED, null)) === null,
);

ok(
  "a unit cannot be a truck and a trailer at once",
  (await resolve(ORG, "Tr4102xy", TRUCK_654, TRAILER_4102)) === "23514",
);

// ── the two halves of "a row must not say one thing and mean another" ────────────────────────────
ok(
  "an 'unmatched' row carrying a truck is refused — the unmatched count is the number that says how much the report is missing",
  (await sqlstate(
    `update fleetpal_units set vehicle_id=$1, match_method='unmatched', matched_at=now()
      where org_id=$2 and fleetpal_id='Vn7kPq2R'`, [TRUCK_654, ORG])) === "23514",
);
ok(
  "and a 'vin' match with nothing attached is refused too — a resolution that silently did not happen",
  (await sqlstate(
    `update fleetpal_units set vehicle_id=null, trailer_id=null, match_method='vin'
      where org_id=$1 and fleetpal_id='Vn7kPq2R'`, [ORG])) === "23514",
);
ok(
  "a match with no timestamp is refused — 'when did this resolve' is the first question about a wrong one",
  (await sqlstate(
    `insert into fleetpal_units (org_id, fleetpal_id, vehicle_id, match_method)
     values ($1,'Xx2','${TRUCK_654}','vin')`, [ORG])) === "23514",
);
ok(
  "an invented match method is refused",
  (await sqlstate(
    `update fleetpal_units set match_method='fuzzy' where org_id=$1 and fleetpal_id='Vn7kPq2R'`, [ORG])) === "23514",
);
ok(
  "the org cannot be moved out from under a resolved unit",
  (await sqlstate(`update fleetpal_units set org_id=$1 where org_id=$2 and fleetpal_id='Vn7kPq2R'`, [OTHER, ORG])) !== null,
);

// ⚠ THE SECOND ASSERTION THIS MATRIX EXISTS FOR, and it found a real defect in the first draft of
// 0334. The obvious foreign-key action is `on delete set null` — keep the staged vendor row, drop
// the mapping. It does not work, and it fails in the direction that matters: `set null` performs an
// UPDATE, that update is checked against `fleetpal_units_match_agrees`, and `match_method='vin'`
// with nothing attached violates it — so the DELETE is refused with 23514 and A VEHICLE BECOMES
// UNDELETABLE the moment a FleetPal unit resolves to it. A collector would be reaching back to
// constrain the roster, which is the exact inversion D-FP2 exists to prevent, and no gate sees it.
//
// `on delete cascade` is what ships. This asserts the property rather than the mechanism: deleting
// a truck must SUCCEED, and must leave nothing behind claiming to be matched to it.
ok(
  "⚠ deleting a truck succeeds — a collector must never be able to make a roster row undeletable",
  (await sqlstate(`delete from vehicles where id=$1`, [RETIRED])) === null,
);
const left = await one(
  `select count(*)::int n from fleetpal_units where org_id=$1 and fleetpal_id='Old301aa'`, [ORG]);
ok(
  "...and the mapping goes with it, because the vendor's unit still exists and the next sweep re-stages it unmatched",
  left.n === 0, JSON.stringify(left),
);
const stillMatched = await one(
  `select count(*)::int n from fleetpal_units where org_id=$1 and vehicle_id=$2`, [ORG, RETIRED]);
ok("...leaving no row claiming a truck that is gone", stillMatched.n === 0);

// ── 4. webhook idempotency ──────────────────────────────────────────────────────────────────────
const delivery = (org, id, at = "2026-09-10T10:00:00Z") =>
  sqlstate(
    `insert into fleetpal_webhook_deliveries (org_id, delivery_id, event_key, event_at) values ($1,$2,'work_order.completed',$3)`,
    [org, id, at],
  );
ok("a delivery is recorded", (await delivery(ORG, "dlv_1")) === null);
ok(
  "and the SAME delivery id is refused — at-least-once means a retry must be a no-op, and this is what makes it one",
  (await delivery(ORG, "dlv_1")) === "23505",
);
ok("another carrier's deliveries are their own", (await delivery(OTHER, "dlv_1")) === null);
ok("a delivery with no id is refused — an idempotency key that is blank is not one",
  (await delivery(ORG, "  ")) === "23514");
ok("an invented status is refused",
  (await sqlstate(`update fleetpal_webhook_deliveries set status='maybe' where org_id=$1`, [ORG])) === "23514");
ok(
  "the ledger is prunable — it is operational state, not evidence, and its retention window is allowed to close",
  (await sqlstate(`delete from fleetpal_webhook_deliveries where org_id=$1 and delivery_id='dlv_1'`, [ORG])) === null,
);

// ── 5. no client path, in either direction, to any of the four ──────────────────────────────────
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

for (const role of ["admin", "fleet_manager", "technician"]) {
  const ins = await asClient(ORG, role,
    `insert into fleetpal_credentials (org_id, api_key_sealed) values ($1,'forged')`, [ORG]);
  ok(`${role} cannot mint a FleetPal credential from the browser`, ins.error === "42501");

  const wm = await asClient(ORG, role,
    `insert into fleetpal_sync_state (org_id, resource) values ($1,'work-orders')`, [ORG]);
  ok(`${role} cannot mint a watermark — that is how you skip a window of repair history on purpose`, wm.error === "42501");

  const unit = await asClient(ORG, role,
    `insert into fleetpal_units (org_id, fleetpal_id) values ($1,'forged')`, [ORG]);
  ok(`${role} cannot mint a unit mapping — the row every per-unit cost figure is computed through`, unit.error === "42501");

  // An UPDATE or DELETE against a table with no matching policy does not RAISE — RLS matches no rows
  // and the statement reports success having changed nothing. That asymmetry with INSERT reads as
  // "the client can edit these", so both are asserted on the EFFECT rather than on an error that
  // never comes.
  const rewind = await asClient(ORG, role,
    `with u as (update fleetpal_sync_state set watermark=null where org_id=$1 returning 1) select count(*)::int n from u`, [ORG]);
  ok(`nor rewind one — RLS matches no rows, so nothing moves`, rewind.error === null && rewind.rows[0]?.n === 0);

  for (const t of ["fleetpal_credentials", "fleetpal_sync_state", "fleetpal_units", "fleetpal_webhook_deliveries"]) {
    const sel = await asClient(ORG, role, `select count(*)::int n from ${t} where org_id=$1`, [ORG]);
    ok(`${role} reads nothing from ${t} — the web goes through the maintenance endpoints`,
      sel.error === null && sel.rows[0]?.n === 0, JSON.stringify(sel));
  }
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
