import { describe, it, expect } from "vitest";
import { analyzeContractCapture, weeklyContractCapture, CONTRACT_TOLERANCE_PER_GAL } from "./contractCapture.js";
import type { SpendLine } from "./types.js";

/**
 * The reconciliation this module exists for has one failure mode that matters more than the arithmetic:
 * a fill with no quote and a fill billed exactly at contract both contribute zero to the variance, and
 * they mean opposite things. Most of what is asserted below is that the two never merge.
 */
const fill = (o: Partial<SpendLine> & { gallons: number; netAmount: number }): SpendLine => ({
  tranDate: "2026-08-11", brand: "pilot", state: "TX", site: "436", city: "Amarillo",
  unit: "754", driver: "A DRIVER", product: "diesel", tank: "tractor",
  retailAmount: null, contractAmount: null, quoteStaleDays: 0, miscAmount: null, salesTax: null,
  ...o,
});

/** A fill billed at exactly the quoted price. */
const atContract = (gallons: number, perGal: number, posted?: number): SpendLine =>
  fill({
    gallons,
    netAmount: gallons * perGal,
    contractAmount: gallons * perGal,
    retailAmount: posted == null ? null : gallons * posted,
  });

describe("analyzeContractCapture", () => {
  it("reports a fleet billed exactly at contract as zero variance, not as an absence of data", () => {
    const c = analyzeContractCapture([atContract(100, 5), atContract(150, 5.2)]);
    expect(c.measuredLines).toBe(2);
    expect(c.netVariance).toBe(0);
    expect(c.honouredLines).toBe(2);
    expect(c.honouredShare).toBe(1);
    expect(c.unmeasuredLines).toBe(0);
  });

  it("finds a fill billed above contract and states the dollars", () => {
    // 100 gal quoted at $5.00, billed at $5.10 → $10 over.
    const c = analyzeContractCapture([
      atContract(100, 5),
      fill({ gallons: 100, netAmount: 510, contractAmount: 500 }),
    ]);
    expect(c.overLines).toBe(1);
    expect(c.overDollars).toBe(10);
    expect(c.netVariance).toBe(10);
    expect(c.exceptions).toHaveLength(1);
    expect(c.exceptions[0]!.variancePerGal).toBeCloseTo(0.1, 6);
  });

  it("keeps overcharges and undercharges separate as well as netting them", () => {
    const c = analyzeContractCapture([
      fill({ gallons: 100, netAmount: 510, contractAmount: 500 }), // +$10
      fill({ gallons: 100, netAmount: 496, contractAmount: 500 }), // −$4
    ]);
    expect(c.overDollars).toBe(10);
    expect(c.underDollars).toBe(-4);
    expect(c.netVariance).toBe(6);
    // Netting alone would report $6 and hide the $10 that is actually recoverable.
    expect(c.overLines).toBe(1);
    expect(c.underLines).toBe(1);
  });

  it("treats sub-tolerance deviation as billed at contract rather than as 1,400 exceptions", () => {
    // Half a cent a gallon: vendor rounding, measured on 75 of 1,470 production fills.
    const c = analyzeContractCapture([fill({ gallons: 100, netAmount: 500.5, contractAmount: 500 })]);
    expect(c.honouredLines).toBe(1);
    expect(c.exceptions).toHaveLength(0);
    // …but the money is still counted, so the total does not quietly lose it.
    expect(c.netVariance).toBe(0.5);
  });

  it("puts a fill just beyond tolerance on the actionable list", () => {
    const perGal = CONTRACT_TOLERANCE_PER_GAL + 0.001;
    const c = analyzeContractCapture([fill({ gallons: 100, netAmount: 500 + 100 * perGal, contractAmount: 500 })]);
    expect(c.exceptions).toHaveLength(1);
    expect(c.honouredLines).toBe(0);
  });

  // ── the distinction the module is built around ────────────────────────────────────────────────
  it("does NOT count a fill with no quote as billed at contract", () => {
    const c = analyzeContractCapture([atContract(100, 5), fill({ gallons: 80, netAmount: 420 })]);
    expect(c.measuredLines).toBe(1);
    expect(c.unmeasuredLines).toBe(1);
    expect(c.unmeasuredGallons).toBe(80);
    expect(c.unmeasuredPaid).toBe(420);
    // The unmeasured fill's $420 must not appear in the measured totals.
    expect(c.paid).toBe(500);
    expect(c.honouredLines).toBe(1);
    expect(c.honouredShare).toBe(1);
  });

  // ── how big is the answer? ────────────────────────────────────────────────────────────────────
  // `honouredShare` says how much of what we MEASURED was billed correctly, which reads as a verdict
  // on the fleet. `measuredSpendShare` says how much of the BILL we measured at all, which is the
  // figure that decides whether the verdict means anything. On production they were 100% and 27.8%.
  it("states the share of spend it measured, not only the share of measured fills it honoured", () => {
    const c = analyzeContractCapture([atContract(100, 5), fill({ gallons: 80, netAmount: 420 })]);
    expect(c.paid).toBe(500);
    expect(c.unmeasuredPaid).toBe(420);
    expect(c.measuredSpendShare).toBeCloseTo(500 / 920, 6); // 54.3% of the bill, on a perfect score
    expect(c.honouredShare).toBe(1);
  });

  it("has no share to report when nothing is in scope, rather than claiming full coverage", () => {
    expect(analyzeContractCapture([]).measuredSpendShare).toBeNull();
  });

  it("reports nothing measured rather than a perfect score when no fill has a quote", () => {
    const c = analyzeContractCapture([fill({ gallons: 80, netAmount: 420 }), fill({ gallons: 90, netAmount: 460 })]);
    expect(c.measuredLines).toBe(0);
    expect(c.honouredShare).toBeNull();
    expect(c.paidPerGal).toBeNull();
    expect(c.contractPerGal).toBeNull();
    expect(c.netVariance).toBe(0);
    expect(c.unmeasuredLines).toBe(2);
  });

  it("excludes reefer diesel, which is bought under different terms", () => {
    const c = analyzeContractCapture([atContract(100, 5), { ...atContract(50, 4), tank: "reefer" }]);
    expect(c.measuredLines).toBe(1);
    expect(c.unmeasuredLines).toBe(0); // excluded outright, not reported as unmeasured
  });

  it("measures the discount against posted retail only where a posted price exists", () => {
    const c = analyzeContractCapture([
      atContract(100, 5, 5.6), // $60 captured
      atContract(100, 5), // quoted but no posted price
    ]);
    expect(c.capturedLines).toBe(1);
    expect(c.captured).toBe(60);
    expect(c.capturedPerGal).toBeCloseTo(0.6, 6);
    expect(c.measuredLines).toBe(2); // still measurable against contract
  });

  it("counts how many fills leaned on a quote carried forward from the day before", () => {
    const c = analyzeContractCapture([
      atContract(100, 5),
      { ...atContract(100, 5), quoteStaleDays: 1 },
    ]);
    expect(c.carriedForwardLines).toBe(1);
    expect(c.measuredLines).toBe(2);
  });

  it("ranks sites by the money, so the worst one is the first thing read", () => {
    const c = analyzeContractCapture([
      fill({ gallons: 100, netAmount: 510, contractAmount: 500, site: "436", city: "Amarillo" }),
      fill({ gallons: 100, netAmount: 502, contractAmount: 500, site: "099", city: "Ocala" }),
    ]);
    expect(c.bySite[0]!.key).toContain("436");
    expect(c.bySite[0]!.variance).toBe(10);
  });

  it("computes the two headline rates on gallons, not on a mean of per-fill rates", () => {
    // A big cheap fill and a small dear one: gallon-weighting is the only correct answer. An unweighted
    // mean of the two rates would read $5.00 — a dollar a gallon out on a fleet that bought at $4.02.
    const c = analyzeContractCapture([atContract(1000, 4), atContract(10, 6)]);
    // Rates are held to four decimals, the precision "Your Price" is quoted at.
    expect(c.paidPerGal).toBe(4.0198);
    expect(c.contractPerGal).toBe(c.paidPerGal);
  });

  it("survives a period with no lines at all without emitting NaN", () => {
    const c = analyzeContractCapture([]);
    expect(c.netVariance).toBe(0);
    expect(c.paidPerGal).toBeNull();
    expect(Number.isNaN(c.captured)).toBe(false);
  });
});

describe("weeklyContractCapture", () => {
  it("splits by week and carries the variance into each", () => {
    const wk = weeklyContractCapture([
      fill({ tranDate: "2026-08-03", gallons: 100, netAmount: 510, contractAmount: 500 }),
      fill({ tranDate: "2026-08-11", gallons: 100, netAmount: 500, contractAmount: 500 }),
    ]);
    expect(wk).toHaveLength(2);
    expect(wk[0]!.netVariance).toBe(10);
    expect(wk[1]!.netVariance).toBe(0);
    expect(wk[0]!.overLines).toBe(1);
  });

  it("ignores lines with no date rather than bucketing them under a fake week", () => {
    expect(weeklyContractCapture([fill({ tranDate: null, gallons: 100, netAmount: 500, contractAmount: 500 })])).toHaveLength(0);
  });
});
