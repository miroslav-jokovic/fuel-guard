// Silvicom 360 — driver-held assets matrix (migration 0523; DRIVER-EQUIPMENT-AND-UNIT-TAGS-PLAN.md
// step DE1, D-DE1/D-DE2/D-DE3). Truck inventory only.
//
// A tablet follows its driver; everything else stays with the truck. Each rule below is a fact here
// rather than a sentence in the migration:
//
//   1.  The type decides (`asset_types.held_by`), and the default is the unit — every type that
//       existed before 0523 keeps the meaning it had.
//   2.  A tablet is given to a driver, handed between drivers and returned to a bay, and the ledger
//       names the driver on both sides of every move.
//   3.  IV025 — a tablet refuses a truck, and a chain refuses a driver, whether moved or created.
//   4.  IV012 — another org's driver is refused; so is a driver who has left (terminated, inactive),
//       while one on leave is not. As a SOURCE a driver who has left is fine: that is the return.
//   5.  D-DE3 — a tablet whose driver has left stays editable; "not returned" is nobody's write.
//   6.  A type cannot switch kind under assets that contradict it.
//   7.  The ledger stays append-only, except the driver columns a merge moves — and those only to a
//       driver of the same org.
//   8.  The projection still rebuilds with the fourth column.
//   9.  A roster merge with the REAL `DRIVER_REASSIGNMENTS` list moves the tablet and its history
//       onto the surviving record; without those entries it aborts instead of losing them.
//   10. One spelling: the five-argument `inventory_holder_is_ours` is gone, and the callers re-issued
//       onto the new one still refuse what they refused.
//
// Run:  node supabase/tests/inventory-driver-held.test.mjs
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

// The REAL merge list, parsed the way lint:driver-references parses it.
const tsSrc = readFileSync(join(SUPA, "..", "apps", "api", "src", "modules", "roster", "mergeDriver.ts"), "utf8");
const MOVES = [...tsSrc.matchAll(/\{\s*table:\s*"([a-z_][a-z0-9_]*)",\s*column:\s*"([a-z_][a-z0-9_]*)"(,\s*orgScoped:\s*true)?/g)]
  .map((m) => ({ table: m[1], column: m[2], org_scoped: !!m[3] }));
if (MOVES.length < 20) {
  console.error("could not parse DRIVER_REASSIGNMENTS");
  process.exit(1);
}

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

// Supabase-managed schemas, shimmed identically to inventory-assets.test.mjs.
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
    bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now()
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
const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Shop') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Rival') returning id`)).id;

const location = async (code, org = ORG) =>
  (await one(`insert into stock_locations (org_id,name,code) values ($1,$2,$3) returning id`, [org, `Bay ${code}`, code])).id;
const vehicle = async (unit, org = ORG) =>
  (await one(`insert into vehicles (org_id, unit_number, tank_capacity_gal) values ($1,$2,240) returning id`, [org, unit])).id;
const driver = async (name, status = "active", org = ORG) =>
  (await one(`insert into drivers (org_id, full_name, status) values ($1,$2,$3) returning id`, [org, name, status])).id;
const assetType = async (name, heldBy, org = ORG) =>
  (
    await one(
      `insert into asset_types (org_id, name, serialized, default_kit_quantity, held_by)
       values ($1,$2,true,1,coalesce($3,'unit')) returning id`,
      [org, name, heldBy ?? null],
    )
  ).id;
const asset = async (name, typeId, holder = {}, org = ORG) =>
  one(
    `insert into inventory_assets (org_id, asset_type_id, name, location_id, vehicle_id, driver_id)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [org, typeId, name, holder.locationId ?? null, holder.vehicleId ?? null, holder.driverId ?? null],
  );
/** Call the RPC the way the API will: a contract payload, verbatim, as jsonb. */
const move = async (row, org = ORG) => {
  try {
    const r = await one(`select * from move_asset($1,$2,$3::jsonb)`, [org, ACTOR, JSON.stringify(row)]);
    return { ok: true, row: r };
  } catch (e) {
    return { ok: false, code: e.code ?? null, message: e.message };
  }
};
const holderOf = async (id) =>
  one(`select location_id, vehicle_id, trailer_id, driver_id, notes from inventory_assets where id=$1`, [id]);
const give = (assetId, toDriverId) => move({ id: randomUUID(), assetId, reason: "assigned", toDriverId, occurredAt: new Date().toISOString() });
const asServiceRole = async (sql, params) => {
  await db.exec("begin");
  await db.exec("set local role service_role");
  const out = await refuses(sql, params);
  await db.exec("rollback");
  return out;
};

const CRIB = await location("CRIB");
const T654 = await vehicle("654");
const ANA = await driver("Ana Ruiz");
const BEN = await driver("Ben Okafor");
const LEAVE = await driver("Cy On-Leave", "on_leave");
const GONE = await driver("Dee Terminated", "terminated");
const IDLE = await driver("Eli Inactive", "inactive");
const RIVAL = await driver("Rival Driver", "active", OTHER);

// ── 1. The type decides, and the default is the unit ────────────────────────────────────────────
const CHAIN = await assetType("Chain");
const TABLET = await assetType("Tablet", "driver");
ok("a type written before 0523's column is held by a unit", (await one(`select held_by from asset_types where id=$1`, [CHAIN])).held_by === "unit");
ok(
  "...and held_by takes only 'unit' or 'driver'",
  (await refuses(`update asset_types set held_by='person' where id=$1`, [CHAIN])) === "23514",
);

// ── 2. Given, handed on, returned ───────────────────────────────────────────────────────────────
const tab = await asset("Tablet A-1", TABLET, { locationId: CRIB });
const given = await give(tab.id, ANA);
ok("a tablet is given to an active driver", given.ok, given.message ?? "");
ok("...and the driver now holds it, and nothing else does", await (async () => {
  const h = await holderOf(tab.id);
  return h.driver_id === ANA && h.location_id === null && h.vehicle_id === null;
})());
ok("...and the ledger says it came from the crib and went to her", given.row.from_location_id === CRIB && given.row.to_driver_id === ANA);

const handed = await give(tab.id, BEN);
ok("a tablet is handed from one driver to another", handed.ok && (await holderOf(tab.id)).driver_id === BEN, handed.message ?? "");
ok("...and the ledger names the driver it came from", handed.row.from_driver_id === ANA && handed.row.to_driver_id === BEN);

const returned = await move({ id: randomUUID(), assetId: tab.id, reason: "removed", toLocationId: CRIB, occurredAt: new Date().toISOString() });
ok("a tablet is returned to the shop", returned.ok && (await holderOf(tab.id)).location_id === CRIB, returned.message ?? "");
ok("...and nobody holds it any more", (await holderOf(tab.id)).driver_id === null && returned.row.from_driver_id === BEN);

ok("a driver on leave may be given a tablet", (await give(tab.id, LEAVE)).ok);

// ── 3. IV025 — the wrong kind of holder for the type ────────────────────────────────────────────
const tab2 = await asset("Tablet A-2", TABLET, { locationId: CRIB });
const intoTruck = await move({ id: randomUUID(), assetId: tab2.id, reason: "assigned", toVehicleId: T654, occurredAt: new Date().toISOString() });
ok("a tablet is refused onto a truck (IV025)", intoTruck.code === "IV025", `got ${intoTruck.code} ${intoTruck.message ?? ""}`);
ok("...and stays in the crib", (await holderOf(tab2.id)).location_id === CRIB);
const chain = await asset("Chain C-1", CHAIN, { locationId: CRIB });
const chainToDriver = await give(chain.id, ANA);
ok("a chain is refused onto a driver (IV025)", chainToDriver.code === "IV025", `got ${chainToDriver.code} ${chainToDriver.message ?? ""}`);
ok("...and a chain still goes onto a truck", (await move({ id: randomUUID(), assetId: chain.id, reason: "assigned", toVehicleId: T654, occurredAt: new Date().toISOString() })).ok);
ok(
  "a tablet cannot be CREATED in a truck either",
  (await refuses(`insert into inventory_assets (org_id, asset_type_id, name, vehicle_id) values ($1,$2,'T',$3)`, [ORG, TABLET, T654])) === "IV025",
);
ok(
  "...nor a chain created in a driver's hands",
  (await refuses(`insert into inventory_assets (org_id, asset_type_id, name, driver_id) values ($1,$2,'C',$3)`, [ORG, CHAIN, ANA])) === "IV025",
);
ok(
  "a tablet may be created already with a driver",
  (await refuses(`insert into inventory_assets (org_id, asset_type_id, name, driver_id) values ($1,$2,'Issued',$3)`, [ORG, TABLET, ANA])) === null,
);
ok(
  "two holders, one of them a driver, is the CHECK's to refuse",
  (await refuses(`insert into inventory_assets (org_id, asset_type_id, name, location_id, driver_id) values ($1,$2,'Both',$3,$4)`, [ORG, TABLET, CRIB, ANA])) === "23514",
);

// ── 4. IV012 — ours, and still here ────────────────────────────────────────────────────────────
for (const [label, who] of [
  ["another org's driver", RIVAL],
  ["a terminated driver", GONE],
  ["an inactive driver", IDLE],
]) {
  const r = await give(tab2.id, who);
  ok(`a tablet is refused to ${label} (IV012)`, r.code === "IV012", `got ${r.code} ${r.message ?? ""}`);
}
ok("...and the refused tablet never left the crib", (await holderOf(tab2.id)).location_id === CRIB);
ok(
  "a tablet cannot be created in the hands of a driver who has left",
  (await refuses(`insert into inventory_assets (org_id, asset_type_id, name, driver_id) values ($1,$2,'Late',$3)`, [ORG, TABLET, GONE])) === "IV012",
);
ok(
  "...nor another org's driver, for the service role too",
  (await asServiceRole(`insert into inventory_assets (org_id, asset_type_id, name, driver_id) values ($1,$2,'Rival',$3)`, [ORG, TABLET, RIVAL])) === "IV012",
);

// ── 5. D-DE3 — the driver leaves holding the tablet ─────────────────────────────────────────────
const kept = await asset("Tablet A-3", TABLET, { locationId: CRIB });
await give(kept.id, BEN);
await db.query(`update drivers set status='terminated' where id=$1`, [BEN]);
ok(
  "a tablet whose driver has left is still held by that driver — nothing un-assigns it",
  (await holderOf(kept.id)).driver_id === BEN,
);
ok(
  "...and it can still be written on, which a not-returned tablet will be",
  (await refuses(`update inventory_assets set notes='called him 10/27' where id=$1`, [kept.id])) === null,
);
const back = await move({ id: randomUUID(), assetId: kept.id, reason: "found", toLocationId: CRIB, occurredAt: new Date().toISOString() });
ok("...and it can be returned FROM him, because a source need only be ours", back.ok && back.row.from_driver_id === BEN, back.message ?? "");

// ── reports move nothing, with a driver as with a truck (D-INV24) ───────────────────────────────
await give(tab2.id, ANA);
const lostReport = await move({ id: randomUUID(), assetId: tab2.id, reason: "reported_missing", occurredAt: new Date().toISOString() });
ok("a tablet reported missing stays with its driver", lostReport.ok && (await holderOf(tab2.id)).driver_id === ANA);
ok(
  "...and a report naming a driver as its destination is refused by the schema",
  (await refuses(
    `insert into asset_movements (id, org_id, asset_id, reason, to_driver_id, occurred_at) values (gen_random_uuid(),$1,$2,'reported_damaged',$3,now())`,
    [ORG, tab2.id, ANA],
  )) === "23514",
);

// ── 6. A type cannot switch kind under assets that contradict it ────────────────────────────────
ok(
  "a type whose asset sits in a truck cannot become driver-held (IV025)",
  (await refuses(`update asset_types set held_by='driver' where id=$1`, [CHAIN])) === "IV025",
);
ok(
  "...nor a type whose asset sits with a driver become unit-held",
  (await refuses(`update asset_types set held_by='unit' where id=$1`, [TABLET])) === "IV025",
);
const SPARE = await assetType("Spare phone");
await asset("Phone P-1", SPARE, { locationId: CRIB });
ok(
  "...while a type whose assets are all on a shelf switches freely — the shelf is right for both",
  (await refuses(`update asset_types set held_by='driver' where id=$1`, [SPARE])) === null,
);

// ── 7. Append-only, except the merge's one correction ───────────────────────────────────────────
const aMove = given.row.id;
ok("the service role still cannot edit a movement's note (IV021)", (await asServiceRole(`update asset_movements set note='x' where id=$1`, [aMove])) === "IV021");
ok("...nor delete one", (await asServiceRole(`delete from asset_movements where id=$1`, [aMove])) === "IV021");
ok(
  "...nor change its driver AND anything else in one write",
  (await asServiceRole(`update asset_movements set to_driver_id=$2, note='x' where id=$1`, [aMove, BEN])) === "IV021",
);
ok(
  "...nor move its driver to another org's",
  (await asServiceRole(`update asset_movements set to_driver_id=$2 where id=$1`, [aMove, RIVAL])) === "IV012",
);
ok(
  "...while moving only its driver to one of ours is the merge's write, and is accepted",
  (await asServiceRole(`update asset_movements set to_driver_id=$2 where id=$1`, [aMove, BEN])) === null,
);

// ── 8. The projection, with the fourth column ───────────────────────────────────────────────────
ok("rebuild_asset_holders changes nothing after every move above", (await num(`select rebuild_asset_holders($1)::int as n`, [ORG])) === 0);
await db.exec("alter table inventory_assets disable trigger all");
await db.query(`update inventory_assets set driver_id=null, location_id=$1 where id=$2`, [CRIB, tab2.id]);
const repaired = await num(`select rebuild_asset_holders($1)::int as n`, [ORG]);
await db.exec("alter table inventory_assets enable trigger all");
ok("...and puts a tablet back in its driver's hands when the row was rewritten behind its back", repaired === 1 && (await holderOf(tab2.id)).driver_id === ANA, `changed ${repaired}`);

// ── 9. A roster merge, with the REAL list ───────────────────────────────────────────────────────
const CANON = await driver("Fay Lopez");
const DUP = await driver("FAY LOPEZ");
const merged = await asset("Tablet A-4", TABLET, { locationId: CRIB });
await give(merged.id, DUP);
const dupMovements = await num(`select count(*)::int as n from asset_movements where to_driver_id=$1 or from_driver_id=$1`, [DUP]);

const withoutInventory = JSON.stringify(MOVES.filter((m) => !["inventory_assets", "asset_movements"].includes(m.table)));
const aborted = await refuses(`select merge_driver_v2($1,$2,$3,$4::jsonb)`, [ORG, DUP, CANON, withoutInventory]);
ok("WITHOUT the inventory entries a merge aborts (on delete restrict) instead of losing the tablet", aborted === "23001", `got ${aborted}`);
ok("...and the tablet is untouched by the aborted merge", (await holderOf(merged.id)).driver_id === DUP);

const done = await refuses(`select merge_driver_v2($1,$2,$3,$4::jsonb)`, [ORG, DUP, CANON, JSON.stringify(MOVES)]);
ok("with the real DRIVER_REASSIGNMENTS a merge of a driver holding a tablet completes", done === null, `got ${done}`);
ok("...and the surviving record holds the tablet", (await holderOf(merged.id)).driver_id === CANON);
ok(
  "...and the history moved with it, every row and none lost",
  (await num(`select count(*)::int as n from asset_movements where to_driver_id=$1 or from_driver_id=$1`, [DUP])) === 0 &&
    (await num(`select count(*)::int as n from asset_movements where asset_id=$1 and to_driver_id=$2`, [merged.id, CANON])) === dupMovements,
);
// A merge into a record that has itself left must not be refused: it is the same person, and the
// tablet is now not returned by them — which is true.
const OLD = await driver("Gus Old", "terminated");
const OLD_DUP = await driver("GUS OLD");
const goneTab = await asset("Tablet A-5", TABLET, { locationId: CRIB });
await give(goneTab.id, OLD_DUP);
const intoGone = await refuses(`select merge_driver_v2($1,$2,$3,$4::jsonb)`, [ORG, OLD_DUP, OLD, JSON.stringify(MOVES)]);
ok("a merge into a terminated record that holds nothing yet still completes", intoGone === null, `got ${intoGone}`);
ok("...and the tablet is now held by the terminated record — not returned, derived", (await holderOf(goneTab.id)).driver_id === OLD);

// ── 10. One spelling ────────────────────────────────────────────────────────────────────────────
ok(
  "the five-argument inventory_holder_is_ours is gone",
  (await num(`select count(*)::int as n from pg_proc where proname='inventory_holder_is_ours'`)) === 1 &&
    (await num(`select pronargs::int as n from pg_proc where proname='inventory_holder_is_ours'`)) === 6,
);
const RIVAL_TRUCK = await vehicle("R-1", OTHER);
ok(
  "a count session still refuses another org's truck through the re-issued guard",
  (await refuses(`insert into stock_count_sessions (org_id, kind, vehicle_id) values ($1,'unit',$2)`, [ORG, RIVAL_TRUCK])) === "IV012",
);
ok(
  "...and a kit expectation too",
  (await refuses(`insert into kit_expectations (org_id, asset_type_id, unit_kind, vehicle_id, quantity) values ($1,$2,'tractor',$3,1)`, [ORG, CHAIN, RIVAL_TRUCK])) === "IV012",
);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
