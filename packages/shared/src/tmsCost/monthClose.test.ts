import { describe, it, expect } from "vitest";
import { planMonthClose, monthsBetween } from "./monthClose.js";

const NOW = new Date("2026-09-03T12:00:00Z");
const tied = {
  periodStart: "2026-06-01",
  now: NOW,
  glRevenue: 5107789.04,
  glExpenses: 3633776.21,
  anchored: true,
  attributedDirect: 2000000,
  fixedCharged: 573000,
  allocatedOverhead: 1000000,
  unallocatedOverhead: 0,
  ownerOperatorPool: 60776.21,
  cpmResidual: 0,
  settlementDrift: 0,
  billingDrift: 0,
  fuelResidual: 0,
};

describe("planMonthClose — the instrument behind 'hardened' (D-FIN14)", () => {
  it("a month two months old whose every tie-out reads 0.00 hardens", () => {
    expect(planMonthClose(tied)).toEqual({ status: "hardened", openReasons: [], monthsOld: 3 });
  });

  it("a month too young stays open and says so, even when it ties", () => {
    const p = planMonthClose({ ...tied, periodStart: "2026-08-01" });
    expect(p.status).toBe("open");
    expect(p.openReasons).toEqual(["month is 1 month(s) old — McLeod may still be posting it (hardens at 2)"]);
  });

  it("every nonzero residual is a named reason with its size; a missing sweep is a reason too", () => {
    const p = planMonthClose({ ...tied, cpmResidual: -12.5, billingDrift: 300.25, fuelResidual: null });
    expect(p.status).toBe("open");
    expect(p.openReasons).toEqual([
      "CPM buckets miss the ledger by $12.50",
      "billing (BILL): sweep and ledger differ by $300.25",
      "fuel (FUEL): no sweep behind this module yet",
    ]);
  });

  it("a refused anchor is its own reason, ahead of any residual", () => {
    const p = planMonthClose({ ...tied, anchored: false, cpmResidual: -500 });
    expect(p.openReasons[0]).toBe("CPM anchor refused: more was attributed than the ledger booked");
  });

  it("monthsBetween counts whole calendar months across a year end", () => {
    expect(monthsBetween("2025-12-01", new Date("2026-02-15T00:00:00Z"))).toBe(2);
    expect(monthsBetween("2026-09-01", NOW)).toBe(0);
  });
});
