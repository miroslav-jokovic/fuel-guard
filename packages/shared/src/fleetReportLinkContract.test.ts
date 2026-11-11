import { describe, expect, it } from "vitest";
import { FLEET_REPORT_QUERY_KEYS, fleetReportGrainOf, fleetReportToQuery } from "./fleetReportLinkContract.js";

describe("the Fleet report link contract (F21 R4b (e))", () => {
  it("writes inclusive months, the grain, and a tab other than the overview", () => {
    expect(fleetReportToQuery({ grain: "quarter", from: "2026-07-01", to: "2026-09-30" })).toEqual({ from: "2026-07", to: "2026-09", grain: "quarter" });
    expect(fleetReportToQuery({ grain: "month", from: "2026-10-01", to: "2026-10-31", tab: "statement" })).toMatchObject({ tab: "statement" });
    expect(fleetReportToQuery({ grain: "month", from: "2026-10-01", to: "2026-10-31", tab: "overview" })).not.toHaveProperty("tab");
    expect(FLEET_REPORT_QUERY_KEYS).toEqual({ from: "from", to: "to", grain: "grain", tab: "tab" });
  });

  it("names the grain whole months step as", () => {
    expect(fleetReportGrainOf("2026-10-01", "2026-10-31")).toBe("month");
    expect(fleetReportGrainOf("2026-07-01", "2026-09-30")).toBe("quarter");
    expect(fleetReportGrainOf("2026-08-01", "2026-10-31")).toBe("custom"); // three months, not a quarter
    expect(fleetReportGrainOf("2026-01-01", "2026-05-31")).toBe("ytd");
    expect(fleetReportGrainOf("2025-11-01", "2026-02-28")).toBe("custom");
    // January to March is a quarter, unless the question was about the year.
    expect(fleetReportGrainOf("2026-01-01", "2026-03-31")).toBe("quarter");
    expect(fleetReportGrainOf("2026-01-01", "2026-03-31", true)).toBe("ytd");
    expect(fleetReportGrainOf("2026-01-01", "2026-01-31", true)).toBe("ytd");
  });
});
