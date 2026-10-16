import { describe, expect, it } from "vitest";
import type { UnitWorkOrder } from "../../fleetpal/index.js";
import { proposeRepair, type UnitToPropose } from "./propose.js";

/**
 * What the engine proposes as an inspected unit's repair (IC11, D-IC14; Q-IC14 measured 2026-10-16). Pinned:
 * repaired-at-scene needs no work order only when EVERY violation was; the window is the inspection's day
 * through the due day in the org's zone; candidates come earliest first; and the hash moves when a
 * candidate's status does, so the pass writes the change.
 */

const ZONE = "America/Chicago";
const order = (o: Partial<UnitWorkOrder>): UnitWorkOrder => ({
  vehicleId: "v-1", trailerId: null, fleetpalId: "wo", reference: "WO-1", status: "OPEN",
  openedAt: "2026-10-03T15:00:00Z", completedAt: null, description: null, jobs: [], ...o,
});
const fleet = (orders: UnitWorkOrder[], vehicles = ["v-1"], trailers: string[] = []) => ({
  vehiclesInFleetpal: new Set(vehicles), trailersInFleetpal: new Set(trailers), orders,
});
const unit = (u: Partial<UnitToPropose> = {}): UnitToPropose => ({
  inspectionDate: "2026-10-01", vehicleId: "v-1", trailerId: null, defectVerifications: ["3"], ...u,
});

describe("proposeRepair", () => {
  it("is due fifteen days after the inspection", () => {
    expect(proposeRepair(unit(), fleet([]), ZONE).dueOn).toBe("2026-10-16");
  });

  it("needs no work order when every violation was repaired at the scene", () => {
    expect(proposeRepair(unit({ defectVerifications: ["1", "1"] }), fleet([order({})]), ZONE).outcome).toBe("repaired_at_scene");
  });

  it("⚠ still proposes when only SOME violations were repaired at the scene", () => {
    expect(proposeRepair(unit({ defectVerifications: ["1", "3"] }), fleet([order({})]), ZONE).outcome).toBe("one_candidate");
  });

  it("says when the unit is not one of ours, and when FleetPal has no unit for it", () => {
    expect(proposeRepair(unit({ vehicleId: null }), fleet([]), ZONE).outcome).toBe("unit_not_ours");
    expect(proposeRepair(unit({ vehicleId: "v-2" }), fleet([]), ZONE).outcome).toBe("no_fleetpal_unit");
  });

  it("reads a trailer's own work orders", () => {
    const p = proposeRepair(unit({ vehicleId: null, trailerId: "t-1" }), fleet([order({ fleetpalId: "wo-t", vehicleId: null, trailerId: "t-1" }), order({})], [], ["t-1"]), ZONE);
    expect(p.candidates.map((c) => c.workOrderId)).toEqual(["wo-t"]);
  });

  it("⚠ takes the inspection's day through the due day, in the org's zone", () => {
    const p = proposeRepair(
      unit(),
      fleet([
        // 00:30 UTC on 10-01 is still 09-30 in Chicago: before the inspection.
        order({ fleetpalId: "before", openedAt: "2026-10-01T00:30:00Z" }),
        order({ fleetpalId: "first-day", openedAt: "2026-10-01T06:00:00Z" }),
        // 04:30 UTC on 10-17 is still 10-16 in Chicago: the due day.
        order({ fleetpalId: "due-day", openedAt: "2026-10-17T04:30:00Z" }),
        order({ fleetpalId: "after", openedAt: "2026-10-17T06:00:00Z" }),
      ]),
      ZONE,
    );
    expect(p.candidates.map((c) => [c.workOrderId, c.openedOn])).toEqual([["first-day", "2026-10-01"], ["due-day", "2026-10-16"]]);
    expect(p.outcome).toBe("several_candidates");
  });

  it("ranks the earliest-opened first and finds none when the shop opened nothing", () => {
    const p = proposeRepair(unit(), fleet([order({ fleetpalId: "late", openedAt: "2026-10-09T15:00:00Z" }), order({ fleetpalId: "soon", openedAt: "2026-10-02T15:00:00Z" })]), ZONE);
    expect(p.candidates.map((c) => c.workOrderId)).toEqual(["soon", "late"]);
    expect(proposeRepair(unit(), fleet([]), ZONE).outcome).toBe("no_candidate");
  });

  it("⚠ hashes what a person would see: a status change is a new reading, a re-read of the same is not", () => {
    const open = proposeRepair(unit(), fleet([order({ jobs: ["Brakes", "Tyre"] })]), ZONE);
    expect(proposeRepair(unit(), fleet([order({ jobs: ["Tyre", "Brakes"] })]), ZONE).sha256).toBe(open.sha256);
    expect(proposeRepair(unit(), fleet([order({ status: "CLOSED", completedAt: "2026-10-04T00:00:00Z" })]), ZONE).sha256).not.toBe(open.sha256);
  });
});
