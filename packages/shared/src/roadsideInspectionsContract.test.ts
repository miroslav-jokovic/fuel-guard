import { describe, expect, it } from "vitest";
import { hasOosOf, type RoadsideInspectionDto } from "./roadsideInspectionsContract.js";

const insp = (driverOos: number | null, vehicleOos: number | null, hazmatOos: number | null): RoadsideInspectionDto => ({
  id: "i", reportNumber: null, reportState: null, inspectionDate: "2026-10-09", level: 1, locationDesc: null,
  hazmatPlacardRequired: null, violations: 1, driverOos, vehicleOos, hazmatOos,
});

describe("an out-of-service order", () => {
  it("is a count above zero, and a count FMCSA left blank is not an order", () => {
    expect(hasOosOf(insp(0, 2, 0), "vehicle")).toBe(true);
    expect(hasOosOf(insp(0, 2, 0), "driver")).toBe(false);
    expect(hasOosOf(insp(null, null, null), "vehicle")).toBe(false);
  });
});
