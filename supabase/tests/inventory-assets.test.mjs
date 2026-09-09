// Silvicom 360 — asset ledger matrix (migration 0333, INVENTORY-PLAN.md step I7).
//
// 0331's matrix pins the fungible half: a quantity is a projection of a ledger. This one pins the
// half with identities, where the question is not "how many" but "which one, and where was it
// before". Everything above it — the assets screen (I8), the unit kit and its check (I9), the
// labels (I10), the driver's kit confirmation (I13) — reads the holder columns and the history, and
// is only worth building if the two cannot disagree.
//
// Fourteen rules, each a fact here rather than a sentence in the migration:
//
//   1.  The CHECK refuses two holders, and three nulls is a legitimate row — an asset that has just
//       been unpacked is genuinely nowhere. (`stock_count_sessions` is `= 1`; this is `<= 1`.)
//   2.  A holder FK does not carry the org. A bay, a truck or a trailer belonging to another org
//       satisfies every foreign key, and `IV012` is the only thing that refuses it. Found on
//       `stock_count_sessions` by 0332's own matrix; the same three columns are here.
//   3.  ...and the BEFORE trigger does not answer for a row whose fault is a CHECK's to report.
//   4.  `display_seq` is allocated by the database, is per-org, and is never reused.
//   5.  `tag_code` is unique per org and, once set, immutable (`IV022`, D-INV18).
//   6.  The holder columns equal the last holder-moving movement, and `rebuild_asset_holders` is a
//       no-op after a mixed sequence — which is what makes them a projection rather than a second
//       source of truth.
//   7.  ...and it repairs an asset written behind its back.
//   8.  An asset cannot be in two units: moving it into 654 takes it out of 611, in the row and in
//       the ledger.
//   9.  A report moves nothing (D-INV24). `reported_missing` leaves the holder exactly where it
//       was, because a fridge reported missing from 654 is still 654's fridge, missing from it —
//       and `in_repair` is the same rule wearing a status.
//   10. D-INV27 — the same movement id twice is one movement and one holder move.
//   11. `IV020` — a unit already holding the one serialized thing it is expected to carry refuses a
//       second, and the expectation resolves per-unit, then per-kind, then per-type.
//   12. `IV021` — the ledger is append-only for the SERVICE ROLE, the only role that writes it.
//   13. `IV023` / `IV024` — retired is terminal, and an asset that is not ours is unknown.
//   14. RLS: a technician reads and moves; an auditor reads and does not; a dispatcher sees nothing.
//
// Run:  node supabase/tests/inventory-assets.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

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
const num = async (q, p = []) => Number((await one(q, p)).n);
/** Run a statement and report the SQLSTATE it raised, or null when it succeeded. */
const refuses = async (q, p = []) => {
  try {
    await db.query(q, p);
    return null;
  } catch (e) {
    return e.code ?? "unknown";
  }
};

// Supabase-managed schemas, shimmed identically to inventory-stock.test.mjs and count-sessions.test.mjs.
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

const ACTOR = "00000000-0000-4000-8000-000000000001";
await db.query(`insert into auth.users (id, email) values ($1, 'tech@test') on conflict do nothing`, [ACTOR]);

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Shop') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Rival') returning id`)).id;

const location = async (code, org = ORG) =>
  (await one(`insert into stock_locations (org_id,name,code) values ($1,$2,$3) returning id`, [org, `Bay ${code}`, code])).id;
const vehicle = async (unit, org = ORG) =>
  (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,$2,240) returning id`, [org, unit])).id;
const trailer = async (unit, org = ORG, reefer = false) =>
  (await one(`insert into trailers (org_id, unit_number, is_reefer) values ($1,$2,$3) returning id`, [org, unit, reefer])).id;
const assetType = async (name, { serialized = true, defaultQty = 0 } = {}, org = ORG) =>
  (
    await one(
      `insert into asset_types (org_id, name, serialized, default_kit_quantity)
       values ($1,$2,$3,$4) returning id`,
      [org, name, serialized, defaultQty],
    )
  ).id;
const asset = async (name, typeId, holder = {}, org = ORG) =>
  one(
    `insert into inventory_assets (org_id, asset_type_id, name, location_id, vehicle_id, trailer_id, tag_code)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [org, typeId, name, holder.locationId ?? null, holder.vehicleId ?? null, holder.trailerId ?? null, holder.tagCode ?? null],
  );

const CRIB = await location("CRIB");
const T654 = await vehicle("654");
const T611 = await vehicle("611");
const DRYVAN = await trailer("T-4102");
const REEFER = await trailer("R-8800", ORG, true);

const TABLET = await assetType("Tablet", { serialized: true, defaultQty: 1 });
const STRAP = await assetType("Ratchet strap", { serialized: false, defaultQty: 4 });
const BAR = await assetType("Load bar", { serialized: true, defaultQty: 2 });

/** Call the RPC the way the API will: a validated contract payload, verbatim, as jsonb. */
const move = async (row, org = ORG) => {
  try {
    const r = await one(`select * from move_asset($1,$2,$3::jsonb)`, [org, ACTOR, JSON.stringify(row)]);
    return { ok: true, row: r };
  } catch (e) {
    return { ok: false, code: e.code ?? null, message: e.message };
  }
};
const holderOf = async (id) =>
  one(`select location_id, vehicle_id, trailer_id, status, condition from inventory_assets where id=$1`, [id]);
const at = (hoursAgo = 0) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();

// ── 1. Exactly one holder, or none ──────────────────────────────────────────────────────────────
ok(
  "an asset cannot name two holders at once",
  (await refuses(
    `insert into inventory_assets (org_id, asset_type_id, name, vehicle_id, trailer_id) values ($1,$2,'Two places',$3,$4)`,
    [ORG, TABLET, T654, DRYVAN],
  )) === "23514",
);
// ...and unlike a count session, NO holder is a legitimate row. A tablet still in its box is
// genuinely nowhere, and forcing it into the crib would be inventing a fact about it.
const unplaced = await asset("Unpacked tablet", TABLET);
ok("...and an asset with no holder at all is accepted", unplaced.location_id === null && unplaced.vehicle_id === null);

// ── 2. A holder foreign key does not carry the org (IV012) ──────────────────────────────────────
// The finding 0332's matrix made on `stock_count_sessions`, re-made here on the three columns that
// have exactly the same shape. Every FK below is satisfied; only the trigger refuses.
const RIVAL_BAY = await location("RCRIB", OTHER);
const RIVAL_TRUCK = await vehicle("R-1", OTHER);
const RIVAL_TRAILER = await trailer("R-2", OTHER);
ok(
  "an asset cannot be held by another org's bay",
  (await refuses(
    `insert into inventory_assets (org_id, asset_type_id, name, location_id) values ($1,$2,'Stolen bay',$3)`,
    [ORG, TABLET, RIVAL_BAY],
  )) === "IV012",
);
ok(
  "...nor by another org's truck",
  (await refuses(
    `insert into inventory_assets (org_id, asset_type_id, name, vehicle_id) values ($1,$2,'Stolen truck',$3)`,
    [ORG, TABLET, RIVAL_TRUCK],
  )) === "IV012",
);
ok(
  "...nor by another org's trailer, which is the third column with the same hole",
  (await refuses(
    `insert into inventory_assets (org_id, asset_type_id, name, trailer_id) values ($1,$2,'Stolen trailer',$3)`,
    [ORG, TABLET, RIVAL_TRAILER],
  )) === "IV012",
);
// A bay that has been closed refuses a placement for the same reason `record_part_movement` refuses
// a movement into one: nothing can be acted on there.
const SHUT = await location("SHUT");
await db.query(`update stock_locations set active=false where id=$1`, [SHUT]);
ok(
  "...nor by a bay that has been closed",
  (await refuses(
    `insert into inventory_assets (org_id, asset_type_id, name, location_id) values ($1,$2,'Shut bay',$3)`,
    [ORG, TABLET, SHUT],
  )) === "IV012",
);
// The `security definer` half: the check must be the same for a browser session and for the service
// role, which bypasses RLS entirely and is the caller that actually matters.
const asServiceRole = async (sql, params) => {
  await db.exec("begin");
  await db.exec("set local role service_role");
  const out = await refuses(sql, params);
  await db.exec("rollback");
  return out;
};
ok(
  "...and the service role is refused it too, which is the point of the trigger",
  (await asServiceRole(
    `insert into inventory_assets (org_id, asset_type_id, name, location_id) values ($1,$2,'Service role',$3)`,
    [ORG, TABLET, RIVAL_BAY],
  )) === "IV012",
);

// ── 3. A BEFORE trigger runs ahead of the CHECKs, and must not answer for them ──────────
// 0332's second lesson, and the reason `inventory_holder_is_ours` returns TRUE for a row that names
// no holder instead of growing an `else` branch. A malformed row's fault belongs to the CHECK: the
// guard that tries to answer "is this null trailer ours" reports `IV012` for a row whose actual
// problem is that it names two places, or none, and then nobody can find the real rule.
ok(
  "a row naming two holders is reported by the CHECK, not by the org guard",
  (await refuses(
    `insert into inventory_assets (org_id, asset_type_id, name, location_id, vehicle_id) values ($1,$2,'Both',$3,$4)`,
    [ORG, TABLET, CRIB, T654],
  )) === "23514",
);

// ── 4. The display number is allocated by the database ──────────────────────────────────────────
const first = await asset("Crib tablet", TABLET, { locationId: CRIB });
const second = await asset("Second tablet", TABLET, { locationId: CRIB });
ok("display_seq is allocated in order", second.display_seq === first.display_seq + 1, `${first.display_seq} → ${second.display_seq}`);
ok("...and starts at 1 for the org", (await num(`select min(display_seq)::int as n from inventory_assets where org_id=$1`, [ORG])) === 1);
const rivalType = await assetType("Tablet", {}, OTHER);
const rivalAsset = await asset("Rival tablet", rivalType, {}, OTHER);
ok("...and each org has its own run of numbers", rivalAsset.display_seq === 1, `got ${rivalAsset.display_seq}`);
ok(
  "...and two assets in one org cannot share a number",
  (await refuses(`update inventory_assets set display_seq=$1 where id=$2`, [first.display_seq, second.id])) === "23505",
);

// ── 5. The tag is unique per org and assigned once (IV022, D-INV18) ─────────────────────────────
await db.query(`update inventory_assets set tag_code='7K3M9P' where id=$1`, [first.id]);
ok(
  "a second asset cannot take a tag that is already on one",
  (await refuses(`update inventory_assets set tag_code='7K3M9P' where id=$1`, [second.id])) === "IV022",
);
ok(
  "...and a tag, once printed, cannot be changed",
  (await refuses(`update inventory_assets set tag_code='X4Q2VW' where id=$1`, [first.id])) === "IV022",
);
ok(
  "...nor cleared",
  (await refuses(`update inventory_assets set tag_code=null where id=$1`, [first.id])) === "IV022",
);
ok(
  "...but another org may hold the same tag, because tags are unique per org",
  (await refuses(`update inventory_assets set tag_code='7K3M9P' where id=$1`, [rivalAsset.id])) === null,
);

// ── 6/8. A mixed sequence, and the holder that must equal its last movement ─────────────────────
// Deliberately not uniform: a crib placement, two units, a report that must NOT move it, and a
// return. A run of identical assignments would pass against an RPC that ignored the reason.
const RIG = await asset("Rig tablet", TABLET, { locationId: CRIB });
await move({ id: randomUUID(), assetId: RIG.id, reason: "assigned", toVehicleId: T611, occurredAt: at(5) });
await move({ id: randomUUID(), assetId: RIG.id, reason: "transferred", toVehicleId: T654, occurredAt: at(4) });
const afterTwo = await holderOf(RIG.id);
ok("an asset moved into 654 is in 654", afterTwo.vehicle_id === T654);
ok("...and is no longer in 611, because a thing is in one place", afterTwo.location_id === null && afterTwo.trailer_id === null);
ok(
  "...and the ledger says where it came from",
  (await one(`select from_vehicle_id as v from asset_movements where asset_id=$1 order by occurred_at desc limit 1`, [RIG.id])).v === T611,
);

// ── 9. A report moves nothing (D-INV24) ────────────────────────────────────────────────────────
const reported = await move({
  id: randomUUID(), assetId: RIG.id, reason: "reported_missing", condition: "damaged", occurredAt: at(3),
});
const afterReport = await holderOf(RIG.id);
ok("a report is recorded", reported.ok, reported.message ?? "");
ok("...and leaves the asset exactly where it was — 654's tablet is still 654's", afterReport.vehicle_id === T654);
ok("...and the ledger row carries no destination at all", reported.row.to_vehicle_id === null && reported.row.to_location_id === null);
ok("...while the condition it reported did land", afterReport.condition === "damaged");
// The same rule wearing a status: `in_repair` does not clear the holder either, so a kit check on
// 654 still sees the tablet as 654's and missing from it, rather than as correctly equipped.
await db.query(`update inventory_assets set status='in_repair' where id=$1`, [RIG.id]);
ok(
  "an asset in repair is still held by its unit (D-INV24)",
  (await num(`select count(*)::int as n from inventory_assets where vehicle_id=$1 and status='in_repair'`, [T654])) === 1,
);
// A destination on a report is unconstructable, and by CHECK rather than by the RPC alone.
ok(
  "a report carrying a destination is refused by the schema",
  (await refuses(
    `insert into asset_movements (id, org_id, asset_id, reason, to_vehicle_id, occurred_at)
     values (gen_random_uuid(),$1,$2,'reported_damaged',$3,now())`,
    [ORG, RIG.id, T611],
  )) === "23514",
);

// ── 10. D-INV27 — the replay ───────────────────────────────────────────────────────────────────
const REPLAY = { id: randomUUID(), assetId: RIG.id, reason: "removed", toLocationId: CRIB, occurredAt: at(2) };
const sent = await move(REPLAY);
const again = await move(REPLAY);
ok("a replayed move returns the same row", sent.ok && again.ok && sent.row.id === again.row.id);
ok(
  "...and the ledger holds one row for it",
  (await num(`select count(*)::int as n from asset_movements where id=$1`, [REPLAY.id])) === 1,
);
ok("...and the asset moved exactly once", (await holderOf(RIG.id)).location_id === CRIB);

// ── 6/7. The projection is rebuildable ─────────────────────────────────────────────────────────
const changed = await num(`select rebuild_asset_holders($1)::int as n`, [ORG]);
ok("rebuild_asset_holders changes nothing after every sequence above", changed === 0, `it changed ${changed} rows`);
// ...and it would notice. A projection nobody can break is not being checked.
await db.exec("alter table inventory_assets disable trigger all");
await db.query(`update inventory_assets set location_id=null, vehicle_id=$1 where id=$2`, [T611, RIG.id]);
const repaired = await num(`select rebuild_asset_holders($1)::int as n`, [ORG]);
await db.exec("alter table inventory_assets enable trigger all");
ok(
  "...and it puts back an asset that was moved behind its back",
  repaired === 1 && (await holderOf(RIG.id)).location_id === CRIB,
  `changed ${repaired}`,
);
// An asset placed at creation and never moved has an opening position no ledger row explains, and
// the rebuild leaves it alone — `rebuild_part_stock` treats a stock line with no movements the same
// way. Without this, creating an asset in the crib would silently unassign it on the next rebuild.
ok(
  "...and leaves an asset that has never moved where it was created",
  (await holderOf(first.id)).location_id === CRIB,
);

// ── 11. IV020 — one of a thing a unit is expected to carry one of ──────────────────────────────
const tabletA = await asset("Tablet A", TABLET, { locationId: CRIB });
const tabletB = await asset("Tablet B", TABLET, { locationId: CRIB });
await move({ id: randomUUID(), assetId: tabletA.id, reason: "assigned", toVehicleId: T611, occurredAt: at() });
const secondTablet = await move({ id: randomUUID(), assetId: tabletB.id, reason: "assigned", toVehicleId: T611, occurredAt: at() });
ok("a second tablet into a truck expected to carry one raises IV020", secondTablet.code === "IV020", `got ${secondTablet.code} ${secondTablet.message ?? ""}`);
ok("...and the refused asset is still in the crib", (await holderOf(tabletB.id)).location_id === CRIB);

// The expectation is resolved, not assumed. `BAR` defaults to two per unit, so the second one lands.
const barA = await asset("Bar A", BAR, { locationId: CRIB });
const barB = await asset("Bar B", BAR, { locationId: CRIB });
await move({ id: randomUUID(), assetId: barA.id, reason: "assigned", toTrailerId: DRYVAN, occurredAt: at() });
ok(
  "a type expected two to a unit accepts the second",
  (await move({ id: randomUUID(), assetId: barB.id, reason: "assigned", toTrailerId: DRYVAN, occurredAt: at() })).ok,
);
// ...and a per-unit override of one closes that trailer to a third, while the fleet default stands
// for every other trailer. This is the layer order the kit screen depends on.
await db.query(
  `insert into kit_expectations (org_id, asset_type_id, unit_kind, trailer_id, quantity) values ($1,$2,'trailer',$3,1)`,
  [ORG, BAR, DRYVAN],
);
const barC = await asset("Bar C", BAR, { locationId: CRIB });
ok(
  "a per-unit override of one beats the type's default of two",
  (await move({ id: randomUUID(), assetId: barC.id, reason: "assigned", toTrailerId: DRYVAN, occurredAt: at() })).code === "IV020",
);
ok(
  "...and the override is that trailer's alone",
  (await move({ id: randomUUID(), assetId: barC.id, reason: "assigned", toTrailerId: REEFER, occurredAt: at() })).ok,
);
// A NON-serialized type is exempt: four straps are four straps, and refusing the fourth is how the
// discipline gets abandoned in week two.
await db.query(
  `insert into kit_expectations (org_id, asset_type_id, unit_kind, quantity) values ($1,$2,'trailer',1)`,
  [ORG, STRAP],
);
const strapA = await asset("Strap A", STRAP, { locationId: CRIB });
const strapB = await asset("Strap B", STRAP, { locationId: CRIB });
await move({ id: randomUUID(), assetId: strapA.id, reason: "assigned", toTrailerId: DRYVAN, occurredAt: at() });
ok(
  "a non-serialized type is not counted against an expectation of one",
  (await move({ id: randomUUID(), assetId: strapB.id, reason: "assigned", toTrailerId: DRYVAN, occurredAt: at() })).ok,
);
// A reefer is its own unit kind, so a fleet default written for `trailer` does not reach it.
const REEFER_TYPE = await assetType("Reefer download cable", { serialized: true, defaultQty: 0 });
await db.query(
  `insert into kit_expectations (org_id, asset_type_id, unit_kind, quantity) values ($1,$2,'reefer_trailer',1)`,
  [ORG, REEFER_TYPE],
);
const cableA = await asset("Cable A", REEFER_TYPE, { locationId: CRIB });
const cableB = await asset("Cable B", REEFER_TYPE, { locationId: CRIB });
await move({ id: randomUUID(), assetId: cableA.id, reason: "assigned", toTrailerId: REEFER, occurredAt: at() });
ok(
  "a reefer resolves the reefer kit and not the dry van's",
  (await move({ id: randomUUID(), assetId: cableB.id, reason: "assigned", toTrailerId: REEFER, occurredAt: at() })).code === "IV020",
);
ok(
  "...while a dry van, whose kit says nothing about it, takes the second",
  (await move({ id: randomUUID(), assetId: cableB.id, reason: "assigned", toTrailerId: DRYVAN, occurredAt: at() })).ok,
);

// ── 12. IV021 — append-only, for the role that actually writes ──────────────────────────────────
// Each attempt in its own transaction: run together, the DELETE comes back `25P02` — the UPDATE's
// exception still standing — which is an assertion that keeps passing after the trigger is dropped.
const anyMovement = (await one(`select id from asset_movements limit 1`)).id;
const svcUpdate = await asServiceRole(`update asset_movements set note='tidied' where id=$1`, [anyMovement]);
const svcDelete = await asServiceRole(`delete from asset_movements where id=$1`, [anyMovement]);
ok("the service role cannot update the asset ledger", svcUpdate === "IV021", `got ${svcUpdate}`);
ok("the service role cannot delete from it", svcDelete === "IV021", `got ${svcDelete}`);

// ── 13. IV023 / IV024 / IV014 ──────────────────────────────────────────────────────────────────
const doomed = await asset("Old tablet", TABLET, { locationId: CRIB });
const retire = await move({ id: randomUUID(), assetId: doomed.id, reason: "retired", occurredAt: at() });
ok("retiring an asset succeeds", retire.ok, retire.message ?? "");
ok("...and sets its status and clears its holder", await (async () => {
  const h = await holderOf(doomed.id);
  return h.status === "retired" && h.location_id === null;
})());
ok(
  "...and a retired asset refuses every further movement (IV023)",
  (await move({ id: randomUUID(), assetId: doomed.id, reason: "found", toLocationId: CRIB, occurredAt: at() })).code === "IV023",
);
ok(
  "...but the movement that retired it replays cleanly, because idempotency comes first",
  await (async () => {
    const id = randomUUID();
    const row = { id, assetId: (await asset("Doomed two", TABLET, { locationId: CRIB })).id, reason: "retired", occurredAt: at() };
    const a = await move(row);
    const b = await move(row);
    return a.ok && b.ok && a.row.id === b.row.id;
  })(),
);
ok(
  "an unknown asset raises IV024",
  (await move({ id: randomUUID(), assetId: randomUUID(), reason: "assigned", toLocationId: CRIB, occurredAt: at() })).code === "IV024",
);
ok(
  "...and another org's asset is exactly as unknown",
  (await move({ id: randomUUID(), assetId: rivalAsset.id, reason: "assigned", toLocationId: CRIB, occurredAt: at() })).code === "IV024",
);
ok(
  "a clock 30 hours out raises IV014",
  (await move({ id: randomUUID(), assetId: first.id, reason: "assigned", toLocationId: CRIB, occurredAt: at(30) })).code === "IV014",
);
ok(
  "a move into another org's truck raises IV012",
  (await move({ id: randomUUID(), assetId: first.id, reason: "assigned", toVehicleId: RIVAL_TRUCK, occurredAt: at() })).code === "IV012",
);

// A kit expectation is bound to this org's unit and this org's type, by the same guard.
ok(
  "a kit expectation cannot name another org's trailer",
  (await refuses(
    `insert into kit_expectations (org_id, asset_type_id, unit_kind, trailer_id, quantity) values ($1,$2,'trailer',$3,1)`,
    [ORG, BAR, RIVAL_TRAILER],
  )) === "IV012",
);
ok(
  "...nor another org's asset type",
  (await refuses(
    `insert into kit_expectations (org_id, asset_type_id, unit_kind, quantity) values ($1,$2,'tractor',1)`,
    [ORG, rivalType],
  )) === "IV012",
);
ok(
  "...and a vehicle override cannot claim to be a trailer's kit",
  (await refuses(
    `insert into kit_expectations (org_id, asset_type_id, unit_kind, vehicle_id, quantity) values ($1,$2,'trailer',$3,1)`,
    [ORG, BAR, T654],
  )) === "23514",
);

// ── 14. RLS, from a browser session ────────────────────────────────────────────────────────────
const asRole = async (role, fn) => {
  await db.exec("begin");
  await db.exec("set local role authenticated");
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: ACTOR, org_id: ORG, user_role: role, role: "authenticated" }),
  ]);
  const out = await fn();
  await db.exec("rollback");
  return out;
};

ok("a technician's session reads the assets", (await asRole("technician", () => num(`select count(*)::int as n from inventory_assets`))) > 0);
ok(
  "...and may add one",
  (await asRole("technician", () =>
    refuses(`insert into inventory_assets (org_id, asset_type_id, name, location_id) values ($1,$2,'Tech tablet',$3)`, [ORG, TABLET, CRIB]),
  )) === null,
);
ok(
  "an auditor reads the assets and does not stock them",
  (await asRole("auditor", () => num(`select count(*)::int as n from inventory_assets`))) > 0 &&
    (await asRole("auditor", () =>
      refuses(`insert into inventory_assets (org_id, asset_type_id, name) values ($1,$2,'Audit tablet')`, [ORG, TABLET]),
    )) === "42501",
);
ok(
  "...and cannot rewrite the ledger either",
  (await asRole("auditor", async () => {
    const r = await db.query(`update asset_movements set note='nope' where id=$1`, [anyMovement]);
    return r.affectedRows ?? 0;
  })) === 0,
);
ok("a dispatcher — maintenance: none — sees no assets at all", (await asRole("dispatcher", () => num(`select count(*)::int as n from inventory_assets`))) === 0);
ok("...and no kit expectations", (await asRole("dispatcher", () => num(`select count(*)::int as n from kit_expectations`))) === 0);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
