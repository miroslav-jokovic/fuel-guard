import { describe, it, expect } from "vitest";
import { planMonthClose, monthsBetween } from "./monthClose.js";

const NOW = new Date("2026-09-03T12:00:00Z");
const tied = {
  periodStart: "2026-06-01",
  now: NOW,
  glRevenue: 5107789.04,
  glExpenses: 3633776.21,
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

  it("every nonzero drift is a named reason with its size; a missing sweep is a reason too", () => {
    const p = planMonthClose({ ...tied, settlementDrift: -12.5, billingDrift: 300.25, fuelResidual: null });
    expect(p.status).toBe("open");
    expect(p.openReasons).toEqual([
      "settlements (SET): sweep and ledger differ by $12.50",
      "billing (BILL): sweep and ledger differ by $300.25",
      "fuel (FUEL): no sweep behind this module yet",
    ]);
  });

  /**
   * G7b (owner ruling 2026-09-04). The close used to refuse a month whose per-truck allocation
   * buckets missed the ledger. Nothing allocates now, and the fleet report asserts its own
   * decomposition on every request rather than once a month — so the close proves the one thing
   * only it can, and a month whose three sweeps tie hardens on that alone.
   */
  it("hardens on the sweeps alone — there is no allocation left to tie out", () => {
    expect(planMonthClose(tied).status).toBe("hardened");
    expect(planMonthClose({ ...tied, settlementDrift: 0.01 }).status).toBe("open");
  });

  it("monthsBetween counts whole calendar months across a year end", () => {
    expect(monthsBetween("2025-12-01", new Date("2026-02-15T00:00:00Z"))).toBe(2);
    expect(monthsBetween("2026-09-01", NOW)).toBe(0);
  });
});
