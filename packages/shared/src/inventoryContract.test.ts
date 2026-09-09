import { describe, expect, it } from "vitest";
import {
  partMovementDtoSchema,
  ADJUST_REASONS,
  ADJUST_REASON_LABELS,
  COUNT_SESSION_STATUS_LABELS,
  HOLDER_KINDS,
  HOLDER_KIND_LABELS,
  ITEM_CONDITIONS,
  ITEM_CONDITION_LABELS,
  PART_MOVEMENT_REASONS,
  PART_MOVEMENT_REASON_LABELS,
  UNITS_OF_MEASURE,
  UNIT_OF_MEASURE_LABELS,
  countSessionInputSchema,
  partMovementInputSchema,
} from "./inventoryContract.js";
import {
  ASSET_MOVEMENT_REASONS,
  ASSET_MOVEMENT_REASON_LABELS,
  ASSET_STATUSES,
  ASSET_STATUS_LABELS,
  UNIT_KINDS,
  UNIT_KIND_LABELS,
  assetMovementInputSchema,
  kitExpectationInputSchema,
  movesHolder,
} from "./inventoryAssetContract.js";
import { isResolvedScan, scanResultSchema } from "./inventoryScanContract.js";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const AT = "2026-09-08T12:00:00.000Z";

describe("every vocabulary has a label for every member", () => {
  const pairs: [readonly string[], Record<string, string>][] = [
    [PART_MOVEMENT_REASONS, PART_MOVEMENT_REASON_LABELS],
    [ADJUST_REASONS, ADJUST_REASON_LABELS],
    [HOLDER_KINDS, HOLDER_KIND_LABELS],
    [ITEM_CONDITIONS, ITEM_CONDITION_LABELS],
    [UNITS_OF_MEASURE, UNIT_OF_MEASURE_LABELS],
    [ASSET_STATUSES, ASSET_STATUS_LABELS],
    [ASSET_MOVEMENT_REASONS, ASSET_MOVEMENT_REASON_LABELS],
    [UNIT_KINDS, UNIT_KIND_LABELS],
  ];

  for (const [members, labels] of pairs) {
    it(`covers ${members.join(", ")}`, () => {
      // A label map with a hole renders `undefined` in a badge, which is how an enum grows a member
      // and a screen quietly stops naming it.
      expect(Object.keys(labels).sort()).toEqual([...members].sort());
      for (const label of Object.values(labels)) expect(label.length).toBeGreaterThan(0);
    });
  }

  it("names both count-session statuses", () => {
    expect(Object.keys(COUNT_SESSION_STATUS_LABELS).sort()).toEqual(["closed", "open"]);
  });

  it("has no driver among the holder kinds — D-INV3", () => {
    expect(HOLDER_KINDS).not.toContain("driver");
  });
});

describe("partMovementInputSchema — the shape is the rule", () => {
  const base = { id: ID, partId: OTHER, locationId: OTHER, occurredAt: AT };

  it("accepts a receive with a cost and a supplier", () => {
    const r = partMovementInputSchema.safeParse({
      ...base,
      reason: "received",
      quantity: 12,
      unitCost: 4.5,
      supplier: "Fleet Supply Co",
    });
    expect(r.success).toBe(true);
  });

  it("refuses an issue with no unit — a part goes to a truck or a trailer", () => {
    const r = partMovementInputSchema.safeParse({ ...base, reason: "issued", quantity: 1 });
    expect(r.success).toBe(false);
  });

  it("refuses an issue naming both a truck and a trailer", () => {
    const r = partMovementInputSchema.safeParse({
      ...base,
      reason: "issued",
      quantity: 1,
      vehicleId: OTHER,
      trailerId: ID,
    });
    expect(r.success).toBe(false);
  });

  it("accepts an issue to exactly one unit", () => {
    const r = partMovementInputSchema.safeParse({
      ...base,
      reason: "issued",
      quantity: 2,
      vehicleId: OTHER,
      workOrderRef: "WO-4471",
    });
    expect(r.success).toBe(true);
  });

  it("refuses an adjustment with no reason — an unexplained decrease is the thing this forbids", () => {
    const r = partMovementInputSchema.safeParse({ ...base, reason: "adjusted", quantityDelta: -3 });
    expect(r.success).toBe(false);
  });

  it("refuses an adjustment of zero", () => {
    const r = partMovementInputSchema.safeParse({
      ...base,
      reason: "adjusted",
      quantityDelta: 0,
      adjustReason: "correction",
    });
    expect(r.success).toBe(false);
  });

  it("refuses a transfer to the location it is already in", () => {
    const r = partMovementInputSchema.safeParse({
      ...base,
      reason: "transferred",
      quantity: 1,
      toLocationId: base.locationId,
    });
    expect(r.success).toBe(false);
  });

  it("takes an absolute total on a count, never a delta — D-INV4", () => {
    const ok = partMovementInputSchema.safeParse({
      ...base,
      reason: "counted",
      countedTotal: 0,
      blind: true,
    });
    expect(ok.success && ok.data.reason === "counted" && ok.data.countedTotal).toBe(0);
  });

  it("requires the counted total rather than accepting a bare count row", () => {
    const r = partMovementInputSchema.safeParse({ ...base, reason: "counted", blind: true });
    expect(r.success).toBe(false);
  });

  it("strips a quantity a client tries to set directly, so it cannot reach the RPC", () => {
    // The safety property is not that this is REJECTED — zod strips unknown keys rather than
    // failing on them, which was measured rather than assumed while writing this test. It is that
    // no such field exists on any payload, so a client that invents one has it dropped at the edge
    // and `quantity_on_hand` stays a projection of the ledger (D-INV4).
    const r = partMovementInputSchema.safeParse({
      ...base,
      reason: "counted",
      countedTotal: 5,
      blind: true,
      quantityOnHand: 12,
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data).not.toHaveProperty("quantityOnHand");
  });

  it("requires a client-generated uuid as the idempotency key — D-INV27", () => {
    const { id: _dropped, ...withoutId } = base;
    const r = partMovementInputSchema.safeParse({ ...withoutId, reason: "received", quantity: 1 });
    expect(r.success).toBe(false);
  });
});

describe("countSessionInputSchema — a session is about one place", () => {
  it("accepts a location count", () => {
    const r = countSessionInputSchema.safeParse({ kind: "location", locationId: ID, blind: true });
    expect(r.success).toBe(true);
  });

  it("accepts a unit count against a trailer", () => {
    const r = countSessionInputSchema.safeParse({ kind: "unit", trailerId: ID, blind: true });
    expect(r.success).toBe(true);
  });

  it("refuses a session about nowhere", () => {
    expect(countSessionInputSchema.safeParse({ kind: "location", blind: true }).success).toBe(false);
  });

  it("refuses a session about two places", () => {
    const r = countSessionInputSchema.safeParse({
      kind: "unit",
      vehicleId: ID,
      trailerId: OTHER,
      blind: true,
    });
    expect(r.success).toBe(false);
  });

  it("refuses a unit count that names a stock location", () => {
    const r = countSessionInputSchema.safeParse({ kind: "unit", locationId: ID, blind: true });
    expect(r.success).toBe(false);
  });
});

describe("assetMovementInputSchema — a report is not a move (D-INV24)", () => {
  const base = { id: ID, assetId: OTHER, occurredAt: AT };

  it("accepts an assignment to a truck", () => {
    const r = assetMovementInputSchema.safeParse({ ...base, reason: "assigned", toVehicleId: OTHER });
    expect(r.success).toBe(true);
  });

  it("refuses a destination on a missing report — the tablet is still unit 654's", () => {
    const r = assetMovementInputSchema.safeParse({
      ...base,
      reason: "reported_missing",
      toLocationId: OTHER,
    });
    expect(r.success).toBe(false);
  });

  it("accepts a missing report with no destination", () => {
    const r = assetMovementInputSchema.safeParse({ ...base, reason: "reported_missing" });
    expect(r.success).toBe(true);
  });

  it("refuses two destinations — an asset is in one place at a time", () => {
    const r = assetMovementInputSchema.safeParse({
      ...base,
      reason: "transferred",
      toVehicleId: OTHER,
      toTrailerId: ID,
    });
    expect(r.success).toBe(false);
  });

  it("splits the reasons into holder-moving and holder-preserving", () => {
    expect(movesHolder("reported_missing")).toBe(false);
    expect(movesHolder("reported_damaged")).toBe(false);
    expect(movesHolder("assigned")).toBe(true);
    expect(movesHolder("found")).toBe(true);
    expect(movesHolder("retired")).toBe(true);
  });
});

describe("kitExpectationInputSchema", () => {
  it("accepts a fleet default with no unit", () => {
    const r = kitExpectationInputSchema.safeParse({
      assetTypeId: ID,
      unitKind: "reefer_trailer",
      quantity: 2,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a quantity of zero — an override saying this unit carries none", () => {
    const r = kitExpectationInputSchema.safeParse({
      assetTypeId: ID,
      unitKind: "tractor",
      vehicleId: OTHER,
      quantity: 0,
    });
    expect(r.success).toBe(true);
  });

  it("refuses an override naming two units", () => {
    const r = kitExpectationInputSchema.safeParse({
      assetTypeId: ID,
      unitKind: "tractor",
      vehicleId: OTHER,
      trailerId: ID,
      quantity: 1,
    });
    expect(r.success).toBe(false);
  });
});

describe("scanResultSchema — the failures are members, not errors", () => {
  it("keeps the scanned code on an unresolved result, so the sheet can attach it", () => {
    const parsed = scanResultSchema.parse({ kind: "malformed", code: "036000291452" });
    expect(parsed.code).toBe("036000291452");
    expect(isResolvedScan(parsed)).toBe(false);
  });

  it("distinguishes an unknown kind from a damaged label", () => {
    const unknown = scanResultSchema.parse({
      kind: "unknown_tag",
      code: "SIL1:VEH:7K3M9P",
      tagKind: "VEH",
    });
    expect(unknown.kind).toBe("unknown_tag");
    expect(isResolvedScan(unknown)).toBe(false);
  });

  it("treats a part found by UPC as resolved even with nowhere to stock it", () => {
    const part = {
      id: ID,
      partNumber: "OF-1234",
      description: "Oil filter",
      manufacturer: null,
      category: null,
      unitOfMeasure: "each" as const,
      upc: "036000291452",
      imagePath: null,
      lastCost: 8.25,
      active: true,
      notes: null,
    };
    const parsed = scanResultSchema.parse({
      kind: "part_by_upc",
      code: "036000291452",
      part,
      stockLines: [],
    });
    expect(isResolvedScan(parsed)).toBe(true);
  });
});

describe("partMovementDtoSchema — a stored column that the DTO drops is invisible", () => {
  /**
   * The defect this pins was real and shipped: `part_movements` stored `supplier` and
   * `transfer_group_id`, `receiveStockSchema` accepted a supplier, and the DTO carried neither — so
   * a technician could type who the parts came from and nothing could ever read it back, and a
   * transfer rendered as two unexplained rows with no way to pair them. Found by the 2026-09-09
   * review of I0–I3, not by a test, which is why there is now a test.
   *
   * ⚠ The assertion is on the parsed OUTPUT's keys and not on `.safeParse` succeeding, because zod
   * STRIPS unknown keys rather than rejecting them (measured in I1). A test that only checked a full
   * row parses would have passed against the broken schema — the stripped field is exactly what it
   * would have been silently dropping.
   */
  const fullRow = {
    id: "11111111-1111-4111-8111-111111111111",
    partId: "22222222-2222-4222-8222-222222222222",
    locationId: "33333333-3333-4333-8333-333333333333",
    reason: "received" as const,
    adjustReason: null,
    quantityDelta: 24,
    countedTotal: null,
    countSessionId: null,
    unitCost: 12.5,
    vehicleId: null,
    trailerId: null,
    workOrderRef: null,
    note: null,
    actorUserId: "44444444-4444-4444-8444-444444444444",
    actorName: "Dana Reyes",
    supplier: "Fleetpride",
    transferGroupId: "55555555-5555-4555-8555-555555555555",
    blind: null,
    occurredAt: "2026-09-09T10:00:00.000Z",
    receivedAt: "2026-09-09T10:00:02.000Z",
  };

  it("keeps the supplier a receipt recorded", () => {
    const parsed = partMovementDtoSchema.parse(fullRow);
    expect(parsed.supplier).toBe("Fleetpride");
  });

  it("keeps the id that pairs the two legs of a transfer", () => {
    const parsed = partMovementDtoSchema.parse(fullRow);
    expect(parsed.transferGroupId).toBe(fullRow.transferGroupId);
  });

  it("keeps the actor's NAME, which is what a ledger screen prints", () => {
    expect(partMovementDtoSchema.parse(fullRow).actorName).toBe("Dana Reyes");
  });
});
