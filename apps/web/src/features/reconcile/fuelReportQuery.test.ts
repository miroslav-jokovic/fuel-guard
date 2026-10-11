import { describe, expect, it } from "vitest";
import { fuelReportQuery } from "./useFuelReport";

describe("fuelReportQuery", () => {
  it("sends every filter it was given and leaves out the empty ones", () => {
    const q = new URLSearchParams(fuelReportQuery({
      from: "2026-09-01", to: "2026-09-30", vehicleIds: ["v1", "v2"], states: ["TX"], siteIds: [], networks: ["out", "unknown"],
    }));
    expect(Object.fromEntries(q)).toEqual({ from: "2026-09-01", to: "2026-09-30", vehicles: "v1,v2", states: "TX", networks: "out,unknown" });
  });
});
