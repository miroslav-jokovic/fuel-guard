import { describe, it, expect } from "vitest";
import { computeOdometerHygiene, type OdometerFillRow } from "./odometerHygiene.js";

const fill = (over: Partial<OdometerFillRow> = {}): OdometerFillRow => ({
  vehicle_id: "v1",
  driver_id: "d1",
  odometer: 100000,
  fueled_at: "2026-07-01T12:00:00Z",
  tank_type: "tractor",
  ...over,
});

describe("computeOdometerHygiene (WP4 — the 'leave it blank' dodge escalates)", () => {
  it("clean history → nothing", () => {
    const h = computeOdometerHygiene([fill(), fill({ odometer: 100600, fueled_at: "2026-07-02T12:00:00Z" })]);
    expect(h).toEqual({ missingTotal: 0, staleTotal: 0, clusters: [] });
  });
  it("counts missing and stale (per-vehicle consecutive repeats)", () => {
    const h = computeOdometerHygiene([
      fill({ odometer: 100000, fueled_at: "2026-07-01T12:00:00Z" }),
      fill({ odometer: 100000, fueled_at: "2026-07-02T12:00:00Z" }), // stale
      fill({ odometer: null, fueled_at: "2026-07-03T12:00:00Z" }), // missing
    ]);
    expect(h.missingTotal).toBe(1);
    expect(h.staleTotal).toBe(1);
  });
  it("a habit (≥3 bad AND ≥50% of the driver's fills) escalates; an occasional slip does not", () => {
    const habit = [
      fill({ odometer: null, fueled_at: "2026-07-01T00:00:00Z" }),
      fill({ odometer: null, fueled_at: "2026-07-02T00:00:00Z" }),
      fill({ odometer: null, fueled_at: "2026-07-03T00:00:00Z" }),
      fill({ odometer: 100900, fueled_at: "2026-07-04T00:00:00Z" }),
    ];
    const h = computeOdometerHygiene(habit);
    expect(h.clusters).toHaveLength(1);
    expect(h.clusters[0]).toMatchObject({ driverId: "d1", missing: 3, fills: 4 });

    const slip = [
      fill({ odometer: null, fueled_at: "2026-07-01T00:00:00Z" }),
      ...Array.from({ length: 9 }, (_, i) => fill({ odometer: 100100 + i * 500, fueled_at: `2026-07-0${Math.min(9, i + 2)}T0${i}:00:00Z` })),
    ];
    expect(computeOdometerHygiene(slip).clusters).toHaveLength(0);
  });
  it("reefer fills are excluded (no odometer expected at a reefer pump)", () => {
    const h = computeOdometerHygiene([
      fill({ odometer: null, tank_type: "reefer" }),
      fill({ odometer: null, tank_type: "reefer", fueled_at: "2026-07-02T12:00:00Z" }),
      fill({ odometer: null, tank_type: "reefer", fueled_at: "2026-07-03T12:00:00Z" }),
    ]);
    expect(h.missingTotal).toBe(0);
    expect(h.clusters).toHaveLength(0);
  });
  it("stale attribution goes to the driver who made the repeated entry, per vehicle", () => {
    const h = computeOdometerHygiene([
      fill({ vehicle_id: "vA", driver_id: "d1", odometer: 5000, fueled_at: "2026-07-01T00:00:00Z" }),
      fill({ vehicle_id: "vA", driver_id: "d2", odometer: 5000, fueled_at: "2026-07-02T00:00:00Z" }), // d2 repeated
      fill({ vehicle_id: "vB", driver_id: "d2", odometer: 5000, fueled_at: "2026-07-03T00:00:00Z" }), // different vehicle → not stale
    ]);
    expect(h.staleTotal).toBe(1);
  });
});
