import { describe, expect, it } from "vitest";
import type { RoadsideInspectionDto } from "./roadsideInspectionsContract.js";
import { isCleanInspection, isInspectionOfKind, roadsideStats } from "./roadsideStats.js";

const insp = (id: string, level: number | null, o: Partial<RoadsideInspectionDto> = {}): RoadsideInspectionDto => ({
  id, reportNumber: null, reportState: null, inspectionDate: "2026-10-09", level, locationDesc: null,
  hazmatPlacardRequired: null, violations: 0, driverOos: 0, vehicleOos: 0, hazmatOos: 0, ...o,
});
const work = (points: number, open: number, categories: number[]) => ({ points, open: { total: open, byOwner: { safety: open, maintenance: 0 } }, categories });

describe("the roadside statistics", () => {
  it("rates vehicle OOS over vehicle inspections (Level 1, 2, 5, 6) and driver OOS over driver ones (1, 2, 3, 6)", () => {
    const rows = [
      insp("a", 1, { vehicleOos: 1, violations: 2 }),
      insp("b", 2),
      insp("c", 3, { driverOos: 1, vehicleOos: 1, violations: 1 }), // a Level 3's vehicle order is outside the vehicle rate
      insp("d", 5),
    ];
    const s = roadsideStats(rows, null);
    expect(s.vehicleOos).toEqual({ count: 1, of: 3, share: 1 / 3 });
    expect(s.driverOos).toEqual({ count: 1, of: 3, share: 1 / 3 });
    expect(s.clean).toEqual({ count: 2, of: 4, share: 0.5 });
    expect(s.points).toBeNull();
    expect(s.needsAction).toBeNull();
  });

  it("says no share, never 0% or 100%, of nothing", () => {
    const s = roadsideStats([insp("c", 3)], null);
    expect(s.vehicleOos).toEqual({ count: 0, of: 0, share: null });
    expect(roadsideStats([], null).clean.share).toBeNull();
  });

  it("is not clean when FMCSA left the violation count blank", () => {
    expect(isCleanInspection({ violations: null })).toBe(false);
    expect(isInspectionOfKind({ level: null }, "vehicle")).toBe(false);
  });

  it("adds the points and the open work of the range only, and names its three commonest categories by inspections", () => {
    const rows = [insp("a", 1), insp("b", 2), insp("c", 1)];
    const w = new Map([
      ["a", work(30, 1, [23, 9])],
      ["b", work(12, 0, [23, 9, 9])],
      ["c", work(0, 2, [23, 40, 1])],
      ["outside", work(99, 5, [1])],
    ]);
    const s = roadsideStats(rows, w, (id) => ({ 1: "Alpha", 9: "Lighting", 23: "Tires", 40: "Brakes" })[id] ?? String(id));
    expect(s.points).toBe(42);
    expect(s.needsAction).toBe(2);
    expect(s.topCategories).toEqual([
      { categoryId: 23, inspections: 3 },
      { categoryId: 9, inspections: 2 },
      { categoryId: 1, inspections: 1 }, // ties by name: Alpha before Brakes
    ]);
  });
});
