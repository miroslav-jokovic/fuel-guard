import { describe, it, expect } from "vitest";
import { stationTime, stationDateTime, stationDate } from "./stationTime";

// A fill imported as 15:25 local at a Texas (Central) station in summer → stored 20:25Z (CDT, −5).
// The display must reproduce the STATION-local 15:25, not the UTC 20:25 or the viewer's browser time.
describe("stationTime", () => {
  it("renders the station-local time of day, reversing the import's UTC conversion", () => {
    expect(stationTime("2026-06-29T20:25:00.000Z", "TX")).toBe("15:25"); // CDT −5
    expect(stationTime("2026-01-15T20:25:00.000Z", "TX")).toBe("14:25"); // CST −6
  });
  it("returns — for the date-only (noon-UTC) sentinel", () => {
    expect(stationTime("2026-06-29T12:00:00.000Z", "TX")).toBe("—");
    expect(stationTime(null, "TX")).toBe("—");
  });
  it("falls back to UTC when the state has no timezone mapping (import stored naive-UTC)", () => {
    expect(stationTime("2026-06-29T20:25:00.000Z", null)).toBe("20:25");
    expect(stationTime("2026-06-29T20:25:00.000Z", "ZZ")).toBe("20:25");
  });
});

describe("stationDateTime / stationDate", () => {
  it("includes the station-local time when present", () => {
    expect(stationDateTime("2026-06-29T20:25:00.000Z", "TX")).toContain("15:25");
    expect(stationDateTime("2026-06-29T20:25:00.000Z", "TX")).toContain("2026");
  });
  it("shows only the date for a date-only row", () => {
    const s = stationDateTime("2026-06-29T12:00:00.000Z", "TX");
    expect(s).toContain("Jun 29");
    expect(s).not.toMatch(/\d{1,2}:\d{2}/); // no time component
  });
  it("stationDate renders the station-local calendar date", () => {
    // 00:30Z is still the prior evening in Central — the date must not roll forward.
    expect(stationDate("2026-06-30T00:30:00.000Z", "TX")).toBe("6/29/2026");
  });
});
