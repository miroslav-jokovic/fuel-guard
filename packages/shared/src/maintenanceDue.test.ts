import { describe, it, expect } from "vitest";
import { annualDisagreement, annualWarning, classifyPmName, pmDueOn, pmStatus, pmWarning, sortWarnings, type PmInterval } from "./maintenanceDue.js";

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

describe("pmStatus — the one judgement the board's chip and the truck's page share (F11, M3)", () => {
  const sixMonth: PmInterval = { intervalType: "TIME", value: 6, valueUnit: "MONTH", threshold: 30, thresholdUnit: "DAY", lastDoneMeterMeters: null };
  const oil: PmInterval = { intervalType: "ODOMETER", value: 20_000 * MI, valueUnit: null, threshold: 7_000 * MI, thresholdUnit: null, lastDoneMeterMeters: 100_000 * MI };

  it("answers ok with room left — where the chip says nothing — and carries the due point either way", () => {
    expect(pmStatus(sixMonth, "2026-06-01T00:00:00Z", null, NOW)).toEqual({ verdict: "ok", dueOn: "2026-12-01", dueAtMiles: null, milesLeft: null });
    expect(pmStatus(oil, null, 110_000, NOW)).toEqual({ verdict: "ok", dueOn: null, dueAtMiles: 120_000, milesLeft: 10_000 });
  });

  it("agrees with pmWarning on due and overdue", () => {
    expect(pmStatus(oil, null, 118_867, NOW)).toMatchObject({ verdict: "due", milesLeft: 1_133 });
    expect(pmStatus(sixMonth, "2026-03-01T00:00:00Z", null, NOW)).toMatchObject({ verdict: "overdue", dueOn: "2026-09-01" });
  });

  it("⚠ is null, never ok, for what it cannot judge", () => {
    expect(pmStatus(sixMonth, null, null, NOW)).toBeNull();
    expect(pmStatus(oil, null, null, NOW)).toBeNull();
    expect(pmStatus({ ...oil, lastDoneMeterMeters: null }, null, 125_000, NOW)).toBeNull();
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

  it("puts a random test with the overdue items, and the driver's before the truck's (DBV4)", () => {
    const w = (unit: "driver" | "truck", kind: "random_test" | "medical_card" | "cdl" | "oil", verdict: "due" | "overdue") =>
      ({ unit, kind, verdict, dueOn: null, milesLeft: null });
    const sorted = sortWarnings([w("driver", "cdl", "due"), w("truck", "oil", "overdue"), w("driver", "medical_card", "overdue"), w("driver", "random_test", "due")]);
    expect(sorted.map((x) => `${x.unit}:${x.kind}:${x.verdict}`)).toEqual([
      "driver:random_test:due", "driver:medical_card:overdue", "truck:oil:overdue", "driver:cdl:due",
    ]);
  });
});

describe("pmDueOn — when a time interval next falls due", () => {
  const annual = (value: number, unit: string): PmInterval => ({ intervalType: "TIME", value, valueUnit: unit, threshold: null, thresholdUnit: null, lastDoneMeterMeters: null });

  it("adds the interval to the day it was done, in FleetPal's three annual shapes (12 MONTH, 365 DAY, 1 YEAR)", () => {
    expect(pmDueOn(annual(12, "MONTH"), "2025-11-03T15:00:00Z")).toBe("2026-11-03");
    expect(pmDueOn(annual(365, "DAY"), "2025-11-03T15:00:00Z")).toBe("2026-11-03");
    expect(pmDueOn(annual(1, "YEAR"), "2025-11-03T15:00:00Z")).toBe("2026-11-03");
  });

  it("says nothing for a mileage interval, a schedule never done, or a unit it does not know", () => {
    expect(pmDueOn({ ...annual(20_000, "MONTH"), intervalType: "ODOMETER" }, "2025-11-03T15:00:00Z")).toBeNull();
    expect(pmDueOn(annual(12, "MONTH"), null)).toBeNull();
    expect(pmDueOn(annual(12, "FORTNIGHT"), "2025-11-03T15:00:00Z")).toBeNull();
    expect(pmDueOn(annual(0, "MONTH"), "2025-11-03T15:00:00Z")).toBeNull();
  });
});

describe("annualDisagreement — FleetPal's annual against our record (Q-DBV2, second half)", () => {
  const T = "2026-10-16";

  it("is silent when both say the same and are within the 30-day warning window of each other", () => {
    expect(annualDisagreement("2027-03-01", "2027-03-01", T)).toBeNull();
    expect(annualDisagreement("2027-03-01", "2027-03-31", T)).toBeNull();
    expect(annualDisagreement("2027-03-31", "2027-03-01", T)).toBeNull();
  });

  it("flags two valid dates more than 30 days apart, with the gap signed FleetPal minus ours", () => {
    expect(annualDisagreement("2027-03-01", "2027-04-01", T)).toEqual({ ours: "valid", fleetpal: "valid", gapDays: 31 });
    expect(annualDisagreement("2027-04-01", "2027-03-01", T)).toEqual({ ours: "valid", fleetpal: "valid", gapDays: -31 });
  });

  it("flags any pair whose verdicts differ, however close — the board's chip would change", () => {
    // Ours expired yesterday, FleetPal's in five days: four days apart, but red against amber.
    expect(annualDisagreement("2026-10-15", "2026-10-21", T)).toEqual({ ours: "expired", fleetpal: "expiring", gapDays: 6 });
    // FleetPal says due inside the window, ours a day past it.
    expect(annualDisagreement("2026-11-16", "2026-11-14", T)).toEqual({ ours: "valid", fleetpal: "expiring", gapDays: -2 });
  });

  it("flags a unit we hold no record for, and is silent where FleetPal schedules no annual", () => {
    expect(annualDisagreement(null, "2027-01-01", T)).toEqual({ ours: "unknown", fleetpal: "valid", gapDays: null });
    expect(annualDisagreement("2027-01-01", null, T)).toBeNull();
    expect(annualDisagreement(null, null, T)).toBeNull();
  });
});
