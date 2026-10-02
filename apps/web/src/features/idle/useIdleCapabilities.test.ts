import { describe, expect, it } from "vitest";
import type { IdleEquipmentRow } from "@silvicom/shared";
import { shapeIdleEquipment } from "./useIdleCapabilities";

/**
 * The equipment tab's shaping of `GET /api/idle/equipment` (IE1, D-IE7). The verdict is the
 * server's; what this pins is that the page shows it honestly — a review is "disagree", agreement
 * needs both a definite behaviour AND a declaration, and the review queue comes first.
 */
const row = (o: Partial<IdleEquipmentRow> & { unitNumber: string }): IdleEquipmentRow => ({
  vehicleId: `v${o.unitNumber}`,
  batch: "Freightliner|Cascadia|2021|2020-12",
  hasApu: false,
  apuType: "none",
  hasOptimizedIdle: false,
  equipmentSource: "owner_ruling_2026-10-01",
  declared: "no_apu",
  parks: 40,
  idlingPct: 50,
  offPct: 30,
  behavesLike: "no_apu",
  review: false,
  idleCapability: null,
  idleOptimizedPct: 0,
  ...o,
});

describe("shapeIdleEquipment", () => {
  it("shows a server review as a disagreement and puts it first", () => {
    const out = shapeIdleEquipment([
      row({ unitNumber: "506" }),
      row({ unitNumber: "1000", behavesLike: "mixed" }),
      row({ unitNumber: "728", declared: "battery_apu", behavesLike: "no_apu", review: true }),
    ]);
    expect(out.map((t) => [t.unit_number, t.cross_check])).toEqual([
      ["728", "disagree"],
      ["506", "agree"],
      ["1000", "na"],
    ]);
  });

  it("never calls a truck with nothing recorded a match, nor mixed or thin evidence", () => {
    const out = shapeIdleEquipment([
      row({ unitNumber: "830", declared: "not_entered", behavesLike: "not_enough_parks" }),
      row({ unitNumber: "722", declared: "not_entered", behavesLike: "mixed" }),
      row({ unitNumber: "654", behavesLike: "not_enough_parks" }),
    ]);
    expect(out.every((t) => t.cross_check === "na")).toBe(true);
  });

  it("sorts units as numbers within a group and labels the batch in plain words", () => {
    const out = shapeIdleEquipment([row({ unitNumber: "1000" }), row({ unitNumber: "99" })]);
    expect(out.map((t) => t.unit_number)).toEqual(["99", "1000"]);
    expect(out[0]!.batch).toBe("Freightliner Cascadia 2021, bought 12/2020");
  });

  it("keeps the learned capability for the fleet figure, unknown when the server has none", () => {
    expect(shapeIdleEquipment([row({ unitNumber: "506" })])[0]!.idle_capability).toBe("unknown");
  });
});
