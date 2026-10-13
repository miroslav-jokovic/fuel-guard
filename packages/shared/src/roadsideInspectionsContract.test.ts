import { describe, expect, it } from "vitest";
import { hasOosOf, roadsidePeriodStart, summarizeRoadside, type RoadsideInspectionDto } from "./roadsideInspectionsContract.js";

const insp = (driverOos: number | null, vehicleOos: number | null, hazmatOos: number | null): RoadsideInspectionDto => ({
  id: "i", reportNumber: null, reportState: null, inspectionDate: "2026-10-09", level: 1, locationDesc: null,
  hazmatPlacardRequired: null, violations: 1, driverOos, vehicleOos, hazmatOos,
});

describe("the roadside window", () => {
  it("counts today in: 90 days ending 2026-10-12 start 2026-07-15, 365 start a year and a day on", () => {
    expect(roadsidePeriodStart("90d", "2026-10-12")).toBe("2026-07-15");
    expect(roadsidePeriodStart("365d", "2026-10-12")).toBe("2025-10-13");
    expect(roadsidePeriodStart("all", "2026-10-12")).toBeNull();
  });
});

describe("the roadside summary", () => {
  it("counts inspections carrying each kind, so an inspection with two kinds counts in both and the kinds never sum", () => {
    const rows = [insp(0, 1, 1), insp(1, 0, 0), insp(0, 0, 0), insp(0, 3, 0)];
    expect(summarizeRoadside("2026-07-15", rows)).toEqual({ from: "2026-07-15", inspections: 4, driverOos: 1, vehicleOos: 2, hazmatOos: 1 });
  });

  it("does not read a count FMCSA left blank as an order", () => {
    expect(hasOosOf(insp(null, null, null), "vehicle")).toBe(false);
  });
});
