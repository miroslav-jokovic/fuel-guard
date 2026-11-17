import { describe, expect, it } from "vitest";
import type { CoverageMonth } from "@silvicom/shared";
import { boundLabel, money, periodLabel, repairsLabel, unitPath } from "./repairCostRows";

const cov = (month: string, ratio: number | null): CoverageMonth => ({
  month, fleetpalInvoiced: 0, glMaintenance: 1, confirmedInLedger: 0, ratioLowerBound: ratio,
  matchedExactlyOne: 0, matchedSeveral: 0, matchedNone: 0, amountDiffers: 0,
});
const coverage = [cov("2026-08", 0.5), cov("2026-09", 0.412), cov("2026-10", 0.38), cov("2026-11", null)];

describe("Repair cost words", () => {
  it("a month prints its own bound, always as 'at least' (D-FP15)", () => {
    expect(boundLabel(["2026-09"], coverage)).toBe("at least 41%");
  });

  it("a week straddling a month end prints BOTH months' bounds, each named (Q10 (a))", () => {
    expect(boundLabel(["2026-09", "2026-10"], coverage)).toBe("at least 41% (Sep) · at least 38% (Oct)");
  });

  it("a year prints the lowest month's, which is true of every month", () => {
    expect(boundLabel(["2026-08", "2026-09", "2026-10"], coverage)).toBe("at least 38% every month");
  });

  it("an unknown month is said, never skipped", () => {
    expect(boundLabel(["2026-10", "2026-11"], coverage)).toBe("not known");
  });

  it("nothing priced is a dash, never $0", () => {
    expect(money(null)).toBe("—");
    expect(money(0)).toBe("$0");
    expect(repairsLabel({ operational: null, external: null, repairs: 3, unpriced: 3 })).toBe("3 repairs, 3 not priced");
    expect(repairsLabel({ operational: 5, external: 5, repairs: 1, unpriced: 0 })).toBe("1 repair");
  });

  it("names a period: a month by name, a week by its clipped MM/DD/YYYY span", () => {
    expect(periodLabel({ key: "2026-10", from: "2026-10-01", to: "2026-11-01" }, "month")).toBe("October 2026");
    expect(periodLabel({ key: "2026", from: "2026-01-01", to: "2026-11-01" }, "year")).toBe("2026");
    expect(periodLabel({ key: "2026-09-28", from: "2026-10-01", to: "2026-10-05" }, "week")).toBe("10/01/2026 – 10/04/2026");
  });

  it("opens a truck's or trailer's page, and nothing for a unit we could not match", () => {
    expect(unitPath({ kind: "tractor", vehicleId: "v1", trailerId: null })).toBe("/shop/units/tractor/v1");
    expect(unitPath({ kind: "trailer", vehicleId: null, trailerId: "t1" })).toBe("/shop/units/trailer/t1");
    expect(unitPath({ kind: "unmatched", vehicleId: null, trailerId: null })).toBeNull();
  });
});
