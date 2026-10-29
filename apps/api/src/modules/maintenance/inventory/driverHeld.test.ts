import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * Tablets held by drivers, above the database (DE2; D-DE1–D-DE4). 0524's matrix
 * (`supabase/tests/inventory-driver-held.test.mjs`) owns what SQL promises — a tablet given, returned,
 * refused to a truck or to a driver who has left. What is only true in TypeScript is pinned here:
 *
 *   · **the round trip owed since DE1**: `driver_id` comes back as a `driver` holder named for the
 *     driver, and a movement's driver ends come back as `driver` endpoints;
 *   · **"not returned" is derived from the driver's status (D-DE3)**, on the holder and as a count the
 *     database makes, never a page total;
 *   · **"unassigned" stays four nulls** — a driver's tablet has the other three null and is not loose;
 *   · **a truck's kit counts its driver's tablet (D-DE4)**, in the list and on the unit's page;
 *   · **the refusals reach the person as sentences** — IV025 on a move and on a type, IV012 naming a driver.
 *
 * ⚠ Fixtures are FUNCTIONS that honour the filters the service sent; `supabaseRecorder` applies none.
 */

const ORG = "org-1";
const USER = "user-1";
const CRIB = "11111111-1111-4111-8111-111111111111";
const TRUCK = "22222222-2222-4222-8222-222222222222";
const TRUCK_NO_DRIVER = "22222222-2222-4222-8222-000000000002";
const TABLET = "33333333-3333-4333-8333-333333333333";
const DANA = "44444444-4444-4444-8444-444444444444";
const LEFT = "44444444-4444-4444-8444-000000000002";
const A_DANA = "aaaaaaaa-1111-4111-8111-111111111111";
const A_LEFT = "aaaaaaaa-2222-4222-8222-222222222222";
const A_CRIB = "aaaaaaaa-3333-4333-8333-333333333333";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));

const { listAssets, getAsset } = await import("./assets.js");
const { moveAsset, listAssetMovements } = await import("./assetMovements.js");
const { updateAssetType } = await import("./assetTypes.js");
const { listUnitKits, getUnitKit } = await import("./units.js");
const { statusForServiceError } = await import("./httpStatus.js");

let seq = 0;
const asset = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  tag_code: null,
  display_seq: ++seq,
  asset_type_id: TABLET,
  name: "Cab tablet",
  serial_number: null,
  imei: null,
  model: null,
  manufacturer: null,
  status: "in_service",
  condition: "good",
  location_id: null,
  vehicle_id: null,
  trailer_id: null,
  driver_id: null,
  purchased_at: null,
  purchase_cost: null,
  warranty_expires_at: null,
  image_path: null,
  notes: null,
  asset_types: { name: "Tablet" },
  stock_locations: null,
  vehicles: null,
  trailers: null,
  drivers: null,
  ...over,
});

const DRIVERS = [
  { id: DANA, full_name: "Dana Reyes", status: "active" },
  { id: LEFT, full_name: "Sam Ortiz", status: "terminated" },
];
const ROWS = () => [
  asset(A_DANA, { driver_id: DANA, drivers: { full_name: "Dana Reyes", status: "active" } }),
  asset(A_LEFT, { driver_id: LEFT, drivers: { full_name: "Sam Ortiz", status: "terminated" } }),
  asset(A_CRIB, { location_id: CRIB, stock_locations: { name: "Tool crib" } }),
];

/** Applies `.eq`, `.in`, `.is(null)` and `.not(col, "is", null)` the way Postgres would. */
function applied(rows: Array<Record<string, unknown>>, q: RecordedQuery) {
  return rows.filter((r) =>
    q.ops.every((o) => {
      const [col, a, b] = o.args as [string, unknown, unknown];
      if (o.method === "eq") return col === "org_id" || r[col] === a;
      if (o.method === "in") return (a as unknown[]).includes(r[col]);
      if (o.method === "is") return a === null ? r[col] === null || r[col] === undefined : true;
      if (o.method === "not" && a === "is" && b === null) return r[col] !== null && r[col] !== undefined;
      if (o.method === "neq") return r[col] !== a;
      return true;
    }),
  );
}

const SCOPED = { exempt: ["user_profiles"] };

describe("a tablet's holder is its driver (D-DE1)", () => {
  beforeEach(() => {
    rec = createSupabaseRecorder({
      tables: {
        inventory_assets: (q) => applied(ROWS(), q),
        drivers: (q) => applied(DRIVERS, q),
        asset_movements: [{ occurred_at: "2026-10-20T08:00:00.000Z" }],
      },
    });
  });

  it("comes back as a driver holder, named for the driver, with nothing inferred", async () => {
    const one = await getAsset(rec.client, ORG, A_DANA);
    if (!one || "error" in one) throw new Error("unexpected");
    expect(one.holder).toMatchObject({ kind: "driver", id: DANA, label: "Dana Reyes", inferredDriverName: null, notReturned: false });
    expect(rec.forTable("inventory_assets")[0]?.ops.find((o) => o.method === "select")?.args[0]).toContain("drivers(full_name, status)");
  });

  it("is flagged not returned when the driver has left, and only then (D-DE3)", async () => {
    const page = await listAssets(rec.client, ORG);
    if ("error" in page) throw new Error("unexpected");
    const flags = Object.fromEntries(page.assets.map((a) => [a.id, a.holder.notReturned]));
    expect(flags).toEqual({ [A_DANA]: false, [A_LEFT]: true, [A_CRIB]: false });
  });

  it("lists a driver's tablets by the driver column", async () => {
    const page = await listAssets(rec.client, ORG, { driverId: DANA });
    if ("error" in page) throw new Error("unexpected");
    expect(page.assets.map((a) => a.id)).toEqual([A_DANA]);
  });

  it("does not call a driver's tablet unassigned — four nulls, not three", async () => {
    const page = await listAssets(rec.client, ORG, { unassigned: true });
    if ("error" in page) throw new Error("unexpected");
    expect(page.assets).toEqual([]);
  });

  /**
   * The shop's "Tablets not returned": the database counts, through the left drivers' ids. A page total
   * would undercount the day there are more than a page of them.
   */
  it("counts the tablets whose driver has left, by the database's count", async () => {
    rec = createSupabaseRecorder({
      tables: {
        inventory_assets: (q) => ({ data: applied(ROWS(), q), count: applied(ROWS(), q).length }),
        drivers: (q) => applied(DRIVERS, q),
      },
    });
    const page = await listAssets(rec.client, ORG, { notReturned: true, limit: 1 });
    if ("error" in page) throw new Error("unexpected");
    expect(page.assets.map((a) => a.id)).toEqual([A_LEFT]);
    expect(page.total).toBe(1);
    const asked = rec.forTable("drivers").find((q) => q.ops.some((o) => o.method === "in" && o.args[0] === "status"));
    expect(asked?.ops.find((o) => o.method === "in" && o.args[0] === "status")?.args[1]).toEqual(["inactive", "terminated"]);
    expectOrgScoped(rec, ORG, SCOPED);
  });

  it("answers zero without asking for the page when nobody who left holds anything", async () => {
    rec = createSupabaseRecorder({
      tables: { inventory_assets: (q) => applied(ROWS().slice(0, 1), q), drivers: (q) => applied(DRIVERS, q) },
    });
    expect(await listAssets(rec.client, ORG, { notReturned: true })).toEqual({ assets: [], total: 0 });
  });
});

describe("a driver's own list says since when (DE2b)", () => {
  // Newest first, as the service orders them: Dana took A_DANA on 10/29 after an earlier give on 10/02;
  // a report on 10/30 moved nothing (no destination) and is not "since"; A_LEFT's give went to somebody else.
  const MOVES = [
    { asset_id: A_DANA, to_driver_id: null, occurred_at: "2026-10-30T08:00:00.000Z" },
    { asset_id: A_DANA, to_driver_id: DANA, occurred_at: "2026-10-29T15:00:00.000Z" },
    { asset_id: A_LEFT, to_driver_id: LEFT, occurred_at: "2026-10-15T09:00:00.000Z" },
    { asset_id: A_DANA, to_driver_id: DANA, occurred_at: "2026-10-02T09:00:00.000Z" },
  ];
  beforeEach(() => {
    rec = createSupabaseRecorder({
      tables: {
        inventory_assets: (q) => applied(ROWS(), q),
        drivers: (q) => applied(DRIVERS, q),
        asset_movements: (q) => applied(MOVES, q),
      },
    });
  });

  it("is the latest give to THIS driver, read once and org-scoped", async () => {
    const page = await listAssets(rec.client, ORG, { driverId: DANA });
    if ("error" in page) throw new Error("unexpected");
    expect(page.assets.map((a) => [a.id, a.holder.since])).toEqual([[A_DANA, "2026-10-29T15:00:00.000Z"]]);
    expect(rec.forTable("asset_movements")).toHaveLength(1);
    expectOrgScoped(rec, ORG, SCOPED);
  });

  it("stays null on a page that is not one driver's — that read would be unbounded", async () => {
    const page = await listAssets(rec.client, ORG);
    if ("error" in page) throw new Error("unexpected");
    expect(page.assets.every((a) => a.holder.since === null)).toBe(true);
    expect(rec.forTable("asset_movements")).toHaveLength(0);
  });
});

describe("giving and returning goes through move_asset", () => {
  it("carries the driver ends of a movement back as driver endpoints", async () => {
    const row = {
      id: "m-1", asset_id: A_DANA, reason: "assigned",
      from_location_id: CRIB, from_vehicle_id: null, from_trailer_id: null, from_driver_id: null,
      to_location_id: null, to_vehicle_id: null, to_trailer_id: null, to_driver_id: DANA,
      condition: null, note: null, actor_user_id: null, actor_driver_id: null, count_session_id: null,
      occurred_at: "2026-10-29T10:00:00Z", received_at: "2026-10-29T10:00:00Z",
    };
    rec = createSupabaseRecorder({ tables: { asset_movements: (q) => ({ data: applied([row], q), count: 1 }) } });
    const page = await listAssetMovements(rec.client, ORG, { assetId: A_DANA });
    if ("error" in page) throw new Error("unexpected");
    expect(page.movements[0]?.fromHolder).toMatchObject({ kind: "location", id: CRIB });
    expect(page.movements[0]?.toHolder).toMatchObject({ kind: "driver", id: DANA });
    expect(rec.forTable("asset_movements")[0]?.ops.find((o) => o.method === "select")?.args[0]).toContain("to_driver_id");
  });

  it("passes toDriverId to the RPC as it came", async () => {
    rec = createSupabaseRecorder({ rpc: { move_asset: { data: null, error: null } } });
    const input = { id: "m-2", assetId: A_DANA, reason: "assigned", toDriverId: DANA, occurredAt: "2026-10-29T10:00:00Z" } as const;
    await moveAsset(rec.client, ORG, USER, input);
    expect(rec.rpcs()[0]?.args).toMatchObject({ p_org: ORG, p_row: { toDriverId: DANA } });
  });

  it.each([
    ["IV025", "a tablet goes to a driver"],
    ["IV012", "a driver must be active or on leave"],
  ])("words %s as a sentence and answers 409/422, never a 500", async (code, words) => {
    rec = createSupabaseRecorder({ rpc: () => ({ data: null, error: { code, message: "raised" } }) });
    const out = await moveAsset(rec.client, ORG, USER, { id: "m-3", assetId: A_DANA, reason: "assigned", occurredAt: "2026-10-29T10:00:00Z" });
    expect(out).toMatchObject({ code });
    expect((out as { error: string }).error).toContain(words);
    expect(statusForServiceError(code)).toBeLessThan(500);
  });

  it("answers a second tablet with the same IMEI as a conflict, not a server failure", () => {
    expect(statusForServiceError("duplicate_imei")).toBe(409);
  });
});

describe("who holds a type is a setting (D-DE1)", () => {
  it("writes held_by when it is sent, and leaves it alone when it is not", async () => {
    rec = createSupabaseRecorder({ tables: { asset_types: [{ id: TABLET, name: "Tablet", category: null, serialized: true, default_kit_quantity: 0, image_path: null, held_by: "driver" }] } });
    const out = await updateAssetType(rec.client, ORG, TABLET, { heldBy: "driver" });
    expect(out).toMatchObject({ heldBy: "driver" });
    expect(rec.writes()[0]?.write?.payload).toMatchObject({ held_by: "driver" });

    rec.reset();
    await updateAssetType(rec.client, ORG, TABLET, { name: "Cab tablet" });
    expect(rec.writes()[0]?.write?.payload).not.toHaveProperty("held_by");
  });

  it.each([
    ["driver", "on a truck or trailer"],
    ["unit", "with a driver"],
  ] as const)("refuses a switch to %s while things sit with the other kind of holder, saying what to move", async (heldBy, where) => {
    rec = createSupabaseRecorder({ tables: { asset_types: { data: [], error: { code: "IV025", message: "raised" } } } });
    const out = await updateAssetType(rec.client, ORG, TABLET, { heldBy });
    expect(out).toMatchObject({ code: "held_by_conflict" });
    expect((out as { error: string }).error).toContain(where);
    expect(statusForServiceError("held_by_conflict")).toBe(409);
  });
});

/**
 * D-DE4: truck 654's "Tablet 1 of 1" stays true when the tablet is Dana's, because Dana is 654's driver;
 * truck 655, with no driver, is short of it.
 */
describe("a truck's kit counts its driver's tablet (D-DE4)", () => {
  const VEHICLES = [
    { id: TRUCK, unit_number: "654", vin: null, plate: null, status: "active", assigned_driver_id: DANA },
    { id: TRUCK_NO_DRIVER, unit_number: "655", vin: null, plate: null, status: "active", assigned_driver_id: null },
  ];
  beforeEach(() => {
    rec = createSupabaseRecorder({
      tables: {
        vehicles: (q) => applied(VEHICLES, q),
        trailers: [],
        asset_types: [{ id: TABLET, name: "Tablet", default_kit_quantity: 1, held_by: "driver" }],
        kit_expectations: [],
        stock_count_sessions: [],
        inventory_assets: (q) => applied(ROWS().slice(0, 1), q),
        drivers: (q) => applied(DRIVERS, q),
      },
    });
  });

  it("counts the tablet on the truck its driver is assigned to, names the driver, and leaves the other truck short", async () => {
    const out = await listUnitKits(rec.client, ORG, { kind: "tractor" });
    if ("error" in out) throw new Error(out.error);
    const byNumber = Object.fromEntries(out.units.map((u) => [u.unitNumber, u]));
    expect(byNumber["654"]?.lines.find((l) => l.assetTypeId === TABLET)).toMatchObject({ expected: 1, held: 1 });
    expect(byNumber["654"]?.state).not.toBe("short");
    expect(byNumber["654"]?.inferredDriverName).toBe("Dana Reyes");
    expect(byNumber["655"]?.lines.find((l) => l.assetTypeId === TABLET)).toMatchObject({ expected: 1, held: 0 });
    expect(byNumber["655"]?.state).toBe("short");
    expectOrgScoped(rec, ORG, SCOPED);
  });

  it("lists the driver's tablet among what the truck carries on its own page", async () => {
    const out = await getUnitKit(rec.client, ORG, "tractor", TRUCK);
    if (!out || "error" in out) throw new Error("unexpected");
    expect(out.assets.map((a) => a.id)).toEqual([A_DANA]);
    expect(out.unit.lines.find((l) => l.assetTypeId === TABLET)).toMatchObject({ held: 1 });
    expect(out.unit.inferredDriverName).toBe("Dana Reyes");
  });
});
