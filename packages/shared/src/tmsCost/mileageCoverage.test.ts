import { describe, it, expect } from "vitest";
import { assessMileageCoverage, periodDenominator, type MonthMileageInput } from "./mileageCoverage.js";

/**
 * The fixture is the real 2026 rollout, measured against production on 2026-09-03: Samsara truck
 * counts from `samsara_ifta_jurisdiction_miles`, delivering truck counts and billed miles from
 * `mcleod_billing` re-dated to `delivery_date`. January and February are genuinely short — that is
 * the whole reason this module exists, and inventing a cleaner fixture would test nothing.
 */
const MONTHS: MonthMileageInput[] = [
  { month: "2026-01", measuredTrucks: 130, measuredMiles: 1_224_329, deliveringTrucks: 139, billedMiles: 1_170_273 },
  { month: "2026-02", measuredTrucks: 135, measuredMiles: 1_179_719, deliveringTrucks: 151, billedMiles: 1_234_486 },
  { month: "2026-03", measuredTrucks: 149, measuredMiles: 1_370_444, deliveringTrucks: 149, billedMiles: 1_391_350 },
  { month: "2026-04", measuredTrucks: 157, measuredMiles: 1_492_407, deliveringTrucks: 155, billedMiles: 1_348_180 },
  { month: "2026-07", measuredTrucks: 172, measuredMiles: 1_552_337, deliveringTrucks: 160, billedMiles: 1_389_814 },
];

const byMonth = (m: string) => assessMileageCoverage(MONTHS).find((x) => x.month === m)!;

describe("assessMileageCoverage", () => {
  it("marks a month short when trucks delivered that Samsara never measured", () => {
    expect(byMonth("2026-02").complete).toBe(false);
    expect(byMonth("2026-02").unmeasuredTrucks).toBe(16);
    expect(byMonth("2026-01").unmeasuredTrucks).toBe(9);
  });

  it("counts a month complete when measurement reaches every delivering truck", () => {
    expect(byMonth("2026-03").complete).toBe(true);
    expect(byMonth("2026-03").unmeasuredTrucks).toBe(0);
  });

  it("treats more measured trucks than delivering ones as healthy, not as an error", () => {
    // July measures 172 against 160 delivering: the extra twelve ran without delivering a load —
    // repositioning, shop, out of service — which billing cannot see and Samsara can.
    const july = byMonth("2026-07");
    expect(july.complete).toBe(true);
    expect(july.unmeasuredTrucks).toBe(0);
  });

  it("refuses an empty-mile figure for a short month, because it would read negative", () => {
    // February's billed miles EXCEED its measured miles — physically impossible, and exactly what a
    // short denominator produces. The answer is null, never −4.6%.
    const feb = byMonth("2026-02");
    expect(feb.measuredMiles).toBeLessThan(feb.billedMiles);
    expect(feb.emptyMiles).toBeNull();
    expect(feb.emptyPct).toBeNull();
  });

  it("reports empty miles for a complete month", () => {
    const july = byMonth("2026-07");
    expect(july.emptyMiles).toBe(162_523);
    expect(july.emptyPct).toBe(10.5);
  });

  it("treats a month with no measurement at all as short, never as complete with zero", () => {
    const [m] = assessMileageCoverage([
      { month: "2026-09", measuredTrucks: 0, measuredMiles: 0, deliveringTrucks: 0, billedMiles: 0 },
    ]);
    expect(m!.complete).toBe(false);
    expect(m!.emptyMiles).toBeNull();
  });

  it("returns months newest first", () => {
    expect(assessMileageCoverage(MONTHS).map((m) => m.month)).toEqual([
      "2026-07",
      "2026-04",
      "2026-03",
      "2026-02",
      "2026-01",
    ]);
  });
});

describe("periodDenominator", () => {
  const assessed = assessMileageCoverage(MONTHS);
  const only = (months: string[]) => assessed.filter((m) => months.includes(m.month));

  it("gives miles and a truck count when every month in the period is complete", () => {
    const d = periodDenominator(only(["2026-03", "2026-04", "2026-07"]));
    expect(d.miles).toBe(4_415_188);
    // The busiest month, not a sum: a truck measured in three months is still one truck.
    expect(d.trucks).toBe(172);
    expect(d.reason).toBeNull();
  });

  it("refuses a denominator when any month in the period is short, and names which", () => {
    const d = periodDenominator(only(["2026-02", "2026-03"]));
    expect(d.miles).toBeNull();
    expect(d.trucks).toBeNull();
    expect(d.reason).toContain("2026-02");
    expect(d.reason).toContain("16");
    expect(d.reason).not.toContain("2026-03");
  });

  it("names every short month, not just the first", () => {
    const d = periodDenominator(only(["2026-01", "2026-02"]));
    expect(d.reason).toContain("2026-02");
    expect(d.reason).toContain("2026-01");
    expect(d.reason).toContain("25"); // 9 + 16 trucks unmeasured
  });

  it("says so plainly when the period has no months at all", () => {
    const d = periodDenominator([]);
    expect(d.miles).toBeNull();
    expect(d.reason).toContain("No months");
  });

  it("distinguishes 'nothing recorded' from 'some trucks missing'", () => {
    const none = assessMileageCoverage([
      { month: "2026-09", measuredTrucks: 0, measuredMiles: 0, deliveringTrucks: 0, billedMiles: 0 },
    ]);
    expect(periodDenominator(none).reason).toContain("No mileage was recorded");
  });
});
