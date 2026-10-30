import { describe, expect, it } from "vitest";
import type { AssetDto, AssetTypeDto, ScanResult } from "@silvicom/shared";
import { assignPayload, assignReason, holderPartner, judgeScan, type AssignTarget } from "./assignLine";

/**
 * EA1's one judgement: what a scan on a truck's, trailer's or driver's Assign list will do. The
 * cases are the ones the line must say BEFORE Confirm — a tablet on a truck, a strap to a driver, a
 * retired item, a shop part — because after Confirm the person has walked away.
 */
const TABLET_TYPE = "11111111-1111-4111-8111-111111111111";
const STRAP_TYPE = "22222222-2222-4222-8222-222222222222";
const types: AssetTypeDto[] = [
  { id: TABLET_TYPE, name: "Tablet", category: null, serialized: true, defaultKitQuantity: 0, imagePath: null, heldBy: "driver" },
  { id: STRAP_TYPE, name: "Ratchet strap", category: null, serialized: false, defaultKitQuantity: 0, imagePath: null, heldBy: "unit" },
];
const truck: AssignTarget = { kind: "vehicle", id: "v-654", label: "Truck 654" };
const dana: AssignTarget = { kind: "driver", id: "d-1", label: "Dana Reyes" };

function asset(over: Omit<Partial<AssetDto>, "holder"> & { holder?: Partial<AssetDto["holder"]> } = {}): AssetDto {
  const { holder, ...rest } = over;
  return {
    id: "a-1",
    tagCode: "7K3M9P",
    displayNo: "A-0412",
    assetTypeId: STRAP_TYPE,
    assetTypeName: "Ratchet strap",
    name: "Strap 1",
    serialNumber: null,
    imei: null,
    model: null,
    manufacturer: null,
    status: "in_service",
    condition: "good",
    holder: { kind: "location", id: "bay-1", label: "Shop", inferredDriverName: null, since: null, ...holder },
    purchasedAt: null,
    purchaseCost: null,
    warrantyExpiresAt: null,
    imagePath: null,
    notes: null,
    ...rest,
  } as AssetDto;
}
const scanned = (a: AssetDto): ScanResult => ({ kind: "asset", code: "SIL1:AST:7K3M9P", asset: a });

describe("a scan on a truck's list", () => {
  it("assigns truck equipment from the shelf, as an assignment", () => {
    const v = judgeScan(scanned(asset()), truck, types, dana);
    expect(v).toMatchObject({ kind: "assign", to: truck, fromLabel: null, reason: "assigned" });
  });

  it("moves it from another truck, says from where, and writes a transfer", () => {
    const v = judgeScan(scanned(asset({ holder: { kind: "vehicle", id: "v-702", label: "Truck 702" } })), truck, types, dana);
    expect(v).toMatchObject({ kind: "assign", fromLabel: "Truck 702", reason: "transferred" });
  });

  it("says it is already here rather than writing a move to where it is", () => {
    const v = judgeScan(scanned(asset({ holder: { kind: "vehicle", id: "v-654", label: "Truck 654" } })), truck, types, dana);
    expect(v.kind).toBe("here");
  });

  it("refuses a tablet, and offers the truck's driver instead", () => {
    const v = judgeScan(scanned(asset({ assetTypeId: TABLET_TYPE, assetTypeName: "Tablet" })), truck, types, dana);
    expect(v).toMatchObject({ kind: "wrong_holder", instead: dana });
    expect(v.kind === "wrong_holder" && v.message).toBe("A tablet goes to a driver, not on a truck.");
  });

  it("refuses a retired item", () => {
    expect(judgeScan(scanned(asset({ status: "retired" })), truck, types, dana).kind).toBe("retired");
  });

  it("refuses a shop part — the two inventories never mix", () => {
    const part = { kind: "part_by_upc", code: "012345678905", part: {}, stockLines: [] } as unknown as ScanResult;
    expect(judgeScan(part, truck, types, null)).toMatchObject({ kind: "refused", message: "That is a shop part, not equipment." });
  });

  it("offers Add it for an IMEI nothing carries, with the IMEI filled in", () => {
    const v = judgeScan({ kind: "malformed", code: "490154203237518" }, truck, types, null);
    expect(v).toMatchObject({ kind: "new", seed: { imei: "490154203237518" } });
  });

  it("refuses a misread IMEI rather than offering to add it", () => {
    expect(judgeScan({ kind: "malformed", code: "490154203237519" }, truck, types, null).kind).toBe("refused");
  });
});

describe("a scan on a driver's list", () => {
  it("gives a tablet from the shelf", () => {
    const v = judgeScan(scanned(asset({ assetTypeId: TABLET_TYPE, assetTypeName: "Tablet" })), dana, types, truck);
    expect(v).toMatchObject({ kind: "assign", to: dana, reason: "assigned" });
  });

  it("refuses a strap and offers the driver's truck instead", () => {
    const v = judgeScan(scanned(asset()), dana, types, truck);
    expect(v).toMatchObject({ kind: "wrong_holder", instead: truck });
  });

  it("treats a thing a driver already holds as driver-held before the types arrive", () => {
    const held = asset({ assetTypeId: TABLET_TYPE, holder: { kind: "driver", id: "d-2", label: "Sam Lee" } });
    expect(judgeScan(scanned(held), dana, undefined, null)).toMatchObject({ kind: "assign", fromLabel: "Sam Lee", reason: "transferred" });
  });
});

describe("the move a line writes", () => {
  it("names exactly one destination column, the target's", () => {
    const v = judgeScan(scanned(asset()), truck, types, null);
    if (v.kind !== "assign") throw new Error("expected assign");
    expect(assignPayload("m-1", v, "2026-10-30T12:00:00.000Z")).toMatchObject({
      id: "m-1",
      assetId: "a-1",
      reason: "assigned",
      toLocationId: null,
      toVehicleId: "v-654",
      toTrailerId: null,
      toDriverId: null,
    });
  });

  it("calls a move from the shelf an assignment and from a holder a transfer", () => {
    expect(assignReason(asset())).toBe("assigned");
    expect(assignReason(asset({ holder: { kind: "location", id: null, label: null } }))).toBe("assigned");
    expect(assignReason(asset({ holder: { kind: "trailer", id: "t-1", label: "Trailer 9" } }))).toBe("transferred");
  });
});

describe("the holder a refused line offers", () => {
  const vehicles = [
    { id: "v-654", unit_number: "654", assigned_driver_id: "d-1", co_driver_id: "d-3" },
    { id: "v-702", unit_number: "702", assigned_driver_id: null, co_driver_id: null },
  ];
  const drivers = [
    { id: "d-1", full_name: "Dana Reyes" },
    { id: "d-3", full_name: "Kim Ortiz" },
  ];

  it("is a truck's assigned driver", () => {
    expect(holderPartner(truck, vehicles, drivers)).toEqual(dana);
  });

  it("is nobody for a truck without a driver, or a trailer", () => {
    expect(holderPartner({ kind: "vehicle", id: "v-702", label: "Truck 702" }, vehicles, drivers)).toBeNull();
    expect(holderPartner({ kind: "trailer", id: "t-1", label: "Trailer 9" }, vehicles, drivers)).toBeNull();
  });

  it("is a driver's truck, including the co-driver's team truck", () => {
    expect(holderPartner(dana, vehicles, drivers)).toEqual(truck);
    expect(holderPartner({ kind: "driver", id: "d-3", label: "Kim Ortiz" }, vehicles, drivers)).toEqual(truck);
  });
});

describe("a truck's or trailer's own label on a list (DE4, DE5)", () => {
  const label = (kind: "vehicle" | "trailer", id: string, unitNumber: string): ScanResult => ({ kind: "unit", code: "SIL1:VEH:7K3M9P", unit: { kind, id, unitNumber } });

  it("is never equipment: another unit's label moves the list on to it, and this unit's says it is its own", () => {
    expect(judgeScan(label("trailer", "t-1203", "1203"), truck, types, dana)).toEqual({
      kind: "switch",
      code: "SIL1:VEH:7K3M9P",
      to: { kind: "trailer", id: "t-1203", label: "Trailer 1203" },
    });
    expect(judgeScan(label("vehicle", truck.id, "654"), truck, types, dana)).toMatchObject({ kind: "refused", message: "That is Truck 654's own label." });
  });
});

