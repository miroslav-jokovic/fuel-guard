import { describe, it, expect } from "vitest";
import { annualWarning, classifyPmName, pmWarning, sortWarnings, type PmInterval } from "./maintenanceDue.js";

const NOW = new Date("2026-10-16T12:00:00Z");
const MI = 1609.344;

describe("classifyPmName — FleetPal's free-text schedule names (production, 2026-10-16)", () => {
  it.each([
    ["Annual DOT Inspection", "annual"], ["Annual lDOT Inspection", "annual"], ["DOT Annual", "annual"], ["Annual Inspection", "annual"],
    ["6-Month Inspection", "six_month"], ["6 Month Inspection", "six_month"], ["6-Month Isnpection", "six_month"],
    ["Oil Change", "oil"], ["OIL CHANGE", "oil"], ["Oil Chnage", "oil"], ["PM Service - Oil Change", "oil"],
    ["Replace Suction Manifold", "other"], [null, "other"],
  ])("%s → %s", (name, kind) => {
    expect(classifyPmName(name)).toBe(kind);
  });
});

describe("pmWarning", () => {
  const sixMonth: PmInterval = { intervalType: "TIME", value: 6, valueUnit: "MONTH", threshold: 30, thresholdUnit: "DAY", lastDoneMeterMeters: null };
  // Every 20,000 mi, warned 7,000 mi ahead — the fleet's commonest oil interval, in FleetPal's metres.
  const oil: PmInterval = { intervalType: "ODOMETER", value: 20_000 * MI, valueUnit: null, threshold: 7_000 * MI, thresholdUnit: null, lastDoneMeterMeters: 100_000 * MI };

  it("says a 6-month inspection is overdue past six months, due inside FleetPal's 30 days, and nothing before", () => {
    expect(pmWarning("six_month", "trailer", sixMonth, "2026-03-01T00:00:00Z", null, NOW)).toEqual({
      unit: "trailer", kind: "six_month", verdict: "overdue", dueOn: "2026-09-01", milesLeft: null,
    });
    expect(pmWarning("six_month", "truck", sixMonth, "2026-05-01T00:00:00Z", null, NOW)).toMatchObject({ verdict: "due", dueOn: "2026-11-01" });
    expect(pmWarning("six_month", "truck", sixMonth, "2026-06-01T00:00:00Z", null, NOW)).toBeNull();
  });

  it("counts an oil change in miles against the truck's odometer", () => {
    expect(pmWarning("oil", "truck", oil, null, 118_867, NOW)).toEqual({ unit: "truck", kind: "oil", verdict: "due", dueOn: null, milesLeft: 1_133 });
    expect(pmWarning("oil", "truck", oil, null, 125_062, NOW)).toMatchObject({ verdict: "overdue", milesLeft: -5_062 });
    expect(pmWarning("oil", "truck", oil, null, 110_000, NOW)).toBeNull();
  });

  it("says nothing it cannot establish: never done, no odometer, no interval", () => {
    expect(pmWarning("six_month", "truck", sixMonth, null, null, NOW)).toBeNull();
    expect(pmWarning("oil", "truck", oil, null, null, NOW)).toBeNull();
    expect(pmWarning("oil", "truck", { ...oil, lastDoneMeterMeters: null }, null, 125_000, NOW)).toBeNull();
    expect(pmWarning("six_month", "truck", { ...sixMonth, value: null }, "2026-01-01T00:00:00Z", null, NOW)).toBeNull();
  });
});

describe("annualWarning — the record, not FleetPal (Q-DBV2)", () => {
  it("is overdue once expired, due inside the record's 30 days, and silent with no date", () => {
    expect(annualWarning("truck", "2026-09-30", "2026-10-16")).toMatchObject({ verdict: "overdue", dueOn: "2026-09-30" });
    expect(annualWarning("trailer", "2026-11-01", "2026-10-16")).toMatchObject({ unit: "trailer", verdict: "due" });
    expect(annualWarning("truck", "2027-06-01", "2026-10-16")).toBeNull();
    expect(annualWarning("truck", null, "2026-10-16")).toBeNull();
  });
});

describe("sortWarnings", () => {
  it("puts overdue first, the truck before its trailer, then annual, 6-month, oil, repair order", () => {
    const w = (unit: "truck" | "trailer", kind: "annual" | "six_month" | "oil" | "repair_order", verdict: "due" | "overdue") =>
      ({ unit, kind, verdict, dueOn: null, milesLeft: null });
    const sorted = sortWarnings([w("truck", "oil", "due"), w("trailer", "annual", "overdue"), w("truck", "six_month", "overdue"), w("truck", "annual", "due")]);
    expect(sorted.map((x) => `${x.unit}:${x.kind}:${x.verdict}`)).toEqual([
      "truck:six_month:overdue", "trailer:annual:overdue", "truck:annual:due", "truck:oil:due",
    ]);
  });
});
