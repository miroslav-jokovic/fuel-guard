import { describe, expect, it } from "vitest";
import { metersFromMiles } from "../smartFueling/units.js";
import {
  assessMpg, computeIftaPosition, IFTA_MPG_BAND,
  type IftaFuelPurchase, type IftaJurisdictionMiles,
} from "./position.js";

/**
 * The liability side of an IFTA return, and the two things that decide whether it can be filed on.
 *
 *   1. IT SCALES WITH MPG, SO THE MPG MUST BE MEASURED AND SHOWN. A hardcoded figure moves every
 *      jurisdiction's liability by whatever the fleet differs from it, invisibly.
 *   2. A JURISDICTION THE TABLE CANNOT PRICE IS REPORTED, NOT ZEROED. Zero liability and unknown
 *      liability look identical on a total and are opposite facts (D-IF7).
 */
const miles = (jurisdiction: string, taxableMiles: number, totalMiles = taxableMiles): IftaJurisdictionMiles => ({
  jurisdiction,
  taxableMeters: metersFromMiles(taxableMiles),
  totalMeters: metersFromMiles(totalMiles),
  taxPaidLiters: 0,
});
const bought = (jurisdiction: string, gallons: number, tranDate = "2026-08-15"): IftaFuelPurchase => ({
  jurisdiction, gallons, tranDate,
});

describe("assessMpg", () => {
  it("calls a normal Class-8 figure plausible and says nothing further", () => {
    const a = assessMpg(700_000, 100_000); // 7.0
    expect(a.verdict).toBe("plausible");
    expect(a.fleetMpg).toBeCloseTo(7, 6);
    expect(a.concern).toBeNull();
  });

  it("catches the shape that exposed the missing month: miles with no fuel behind them", () => {
    // 2026 Q2's real figures — 4,611,351 miles against the 439,153 gallons on file — imply 10.5 mpg,
    // and chasing that found a 31-day hole in the fuel feed worth about $1.03M.
    const a = assessMpg(4_611_351, 439_153);
    expect(a.fleetMpg).toBeCloseTo(10.5, 1);
    expect(a.verdict).toBe("implausibly_high");
    expect(a.concern).toContain("no fuel behind them");
  });

  it("would NOT have caught it against the wider band `fuelSpend` already had", () => {
    // `PLAUSIBLE_FLEET_MPG` is { low: 3, high: 12 } and judges a single truck-period, where genuine
    // oddities are common. 10.5 sits comfortably inside it. Reusing it here — the obvious economy —
    // would have let the defect through, which is the whole reason this band exists separately.
    expect(assessMpg(4_611_351, 439_153).fleetMpg!).toBeGreaterThan(IFTA_MPG_BAND.max);
    expect(assessMpg(4_611_351, 439_153).fleetMpg!).toBeLessThan(12);
  });

  it("catches the other direction — fuel with no miles behind it", () => {
    const a = assessMpg(100_000, 100_000); // 1.0
    expect(a.verdict).toBe("implausibly_low");
    expect(a.concern).toContain("no miles behind it");
  });

  it("refuses to divide by nothing", () => {
    expect(assessMpg(0, 100).verdict).toBe("unmeasurable");
    expect(assessMpg(100, 0).verdict).toBe("unmeasurable");
    expect(assessMpg(100, 0).fleetMpg).toBeNull();
  });
});

describe("computeIftaPosition", () => {
  /** Drives 70,000 miles in Texas and California; buys 10,000 gallons, all of it in Texas. */
  const lopsided = () =>
    computeIftaPosition(
      [miles("TX", 35_000), miles("CA", 35_000)],
      [bought("TX", 10_000)],
      "2026-08-15",
    );

  it("computes liability from miles ÷ measured MPG × the jurisdiction's own rate", () => {
    const p = lopsided();
    expect(p.mpg.fleetMpg).toBeCloseTo(7, 6); // 70,000 ÷ 10,000
    const ca = p.jurisdictions.find((j) => j.jurisdiction === "CA")!;
    expect(ca.gallonsConsumed).toBeCloseTo(5000, 0);
    // California's 3Q2026 rate is 0.9790.
    expect(ca.ratePerGal).toBe(0.979);
    expect(ca.liability).toBeCloseTo(5000 * 0.979, 0);
  });

  it("credits the jurisdiction the fuel was BOUGHT in, at that jurisdiction's rate", () => {
    const p = lopsided();
    const tx = p.jurisdictions.find((j) => j.jurisdiction === "TX")!;
    expect(tx.gallonsPurchased).toBe(10_000);
    expect(tx.credit).toBeCloseTo(10_000 * 0.2, 0);
  });

  it("nets to what is owed and what is refundable, per jurisdiction", () => {
    // Buying every gallon in Texas while driving half the miles in California is the classic shape:
    // California is owed, Texas has overpaid, and the fleet total is the sum of both.
    const p = lopsided();
    const ca = p.jurisdictions.find((j) => j.jurisdiction === "CA")!;
    const tx = p.jurisdictions.find((j) => j.jurisdiction === "TX")!;
    expect(ca.net!).toBeGreaterThan(0);
    expect(tx.net!).toBeLessThan(0);
    expect(p.net).toBeCloseTo(ca.net! + tx.net!, 1);
  });

  it("carries the MPG it used, because every liability above scales with it", () => {
    const p = lopsided();
    expect(p.mpg.verdict).toBe("plausible");
    expect(p.mpg.totalMiles).toBeCloseTo(70_000, 0);
    expect(p.mpg.totalGallons).toBe(10_000);
  });

  it("says so when the position rests on an impossible MPG", () => {
    const p = computeIftaPosition([miles("TX", 700_000)], [bought("TX", 10_000)], "2026-08-15");
    expect(p.mpg.verdict).toBe("implausibly_high");
    expect(p.mpg.concern).toContain("overstated until it is closed");
  });

  it("reports a jurisdiction it cannot price rather than zeroing its liability", () => {
    // Ontario: the tax table excludes Canada deliberately (D-FX12), because its US-column rate is an
    // exchange-rate conversion. Those miles were still driven.
    const p = computeIftaPosition(
      [miles("TX", 35_000), miles("ON", 35_000)],
      [bought("TX", 10_000)],
      "2026-08-15",
    );
    const on = p.jurisdictions.find((j) => j.jurisdiction === "ON")!;
    expect(on.priced).toBe(false);
    expect(on.liability).toBeNull();
    expect(on.net).toBeNull();
    expect(p.unpriced).toEqual(["ON"]);
    expect(p.pricedMileShare).toBeCloseTo(0.5, 3);
  });

  it("keeps a return-billed surcharge out of the net, because it is not creditable", () => {
    // Kentucky's $0.1050 is levied on the return over gallons BURNED there with no credit for
    // tax-paid gallons. Folding it into `net` would make the figure unreconcilable against a filing.
    const p = computeIftaPosition([miles("KY", 70_000)], [bought("KY", 10_000)], "2026-08-15");
    const ky = p.jurisdictions.find((j) => j.jurisdiction === "KY")!;
    expect(ky.surcharge).toBeCloseTo(10_000 * 0.105, 0);
    expect(ky.net).toBeCloseTo(0, 0); // 10,000 gal consumed and 10,000 bought, at one rate
    expect(p.surcharge).toBe(ky.surcharge);
    expect(p.net).not.toBe(p.net + p.surcharge);
  });

  it("keeps a jurisdiction with purchases but no miles — the credit is real either way", () => {
    const p = computeIftaPosition([miles("TX", 70_000)], [bought("TX", 5_000), bought("NM", 5_000)], "2026-08-15");
    const nm = p.jurisdictions.find((j) => j.jurisdiction === "NM")!;
    expect(nm.taxableMiles).toBe(0);
    expect(nm.gallonsPurchased).toBe(5_000);
    expect(nm.credit!).toBeGreaterThan(0);
    expect(nm.net!).toBeLessThan(0);
  });

  it("sums the per-truck rows into one fleet figure per jurisdiction", () => {
    // The stored rows are per truck; a position is per fleet.
    const p = computeIftaPosition(
      [miles("TX", 10_000), miles("TX", 25_000), miles("CA", 35_000)],
      [bought("TX", 10_000)],
      "2026-08-15",
    );
    expect(p.jurisdictions.filter((j) => j.jurisdiction === "TX")).toHaveLength(1);
    expect(p.jurisdictions.find((j) => j.jurisdiction === "TX")!.taxableMiles).toBe(35_000);
  });

  it("normalises the jurisdiction code, because two spellings are not two jurisdictions", () => {
    const p = computeIftaPosition([miles(" tx ", 35_000), miles("TX", 35_000)], [bought("tx", 10_000)], "2026-08-15");
    expect(p.jurisdictions).toHaveLength(1);
    expect(p.jurisdictions[0]!.jurisdiction).toBe("TX");
  });

  it("returns an unmeasurable position rather than throwing on an empty period", () => {
    const p = computeIftaPosition([], [], "2026-08-15");
    expect(p.jurisdictions).toEqual([]);
    expect(p.mpg.verdict).toBe("unmeasurable");
    expect(p.net).toBe(0);
    expect(p.pricedMileShare).toBeNull();
  });

  it("prices each period from its own quarter's rate", () => {
    // California moved 0.9710 → 0.9790 on 2026-07-01, so a Q2 position and a Q3 one are not the same
    // return computed twice.
    const q2 = computeIftaPosition([miles("CA", 70_000)], [bought("CA", 10_000, "2026-05-15")], "2026-05-15");
    const q3 = computeIftaPosition([miles("CA", 70_000)], [bought("CA", 10_000, "2026-08-15")], "2026-08-15");
    expect(q2.jurisdictions[0]!.ratePerGal).toBe(0.971);
    expect(q3.jurisdictions[0]!.ratePerGal).toBe(0.979);
  });
});
