import { describe, it, expect } from "vitest";
import { analyzeDiscountCapture, weeklyDiscountCapture } from "./discountCapture.js";
import { analyzePolicyExceptions, exceptionReport, DEFAULT_FUEL_POLICY } from "./policyExceptions.js";
import { analyzeAncillary, DEF_EXPECTED_RATIO } from "./ancillary.js";
import { totalsOf, isTractorFuel, weekOf, type SpendLine } from "./types.js";

const fill = (o: Partial<SpendLine> & { gallons: number; netAmount: number }): SpendLine => ({
  tranDate: "2026-08-17", brand: "pilot", state: "TX", site: "1", city: "Somewhere", unit: "100",
  driver: null, product: "diesel", tank: "tractor", retailAmount: null, ...o,
});
/** A fill at a given posted price with a given discount, so intent reads off the call site. */
type FillOverrides = Omit<Partial<SpendLine>, "gallons" | "netAmount" | "retailAmount">;
const at = (gal: number, retailPpg: number, discPpg: number, o: FillOverrides = {}): SpendLine =>
  fill({ gallons: gal, netAmount: gal * (retailPpg - discPpg), retailAmount: gal * retailPpg, ...o });

describe("totalsOf / isTractorFuel", () => {
  it("reports no $/gal rather than $0.00 when there are no gallons", () => {
    const t = totalsOf([]);
    expect(t.netPerGal).toBeNull(); // 0 would read as free fuel
    expect(t.capturePct).toBeNull();
  });
  it("counts tractor diesel only — reefer is dyed off-road fuel and DEF is not fuel", () => {
    expect(isTractorFuel(at(100, 5, 0.5))).toBe(true);
    expect(isTractorFuel(at(30, 5, 0, { tank: "reefer" }))).toBe(false);
    expect(isTractorFuel(at(6, 4.9, 0, { product: "def", tank: "none" }))).toBe(false);
  });
  it("keys weeks to Monday, matching how the vendor's statements run", () => {
    expect(weekOf("2026-08-17")).toBe("2026-08-17"); // a Monday
    expect(weekOf("2026-08-23")).toBe("2026-08-17"); // the Sunday that closes it
    expect(weekOf("2026-08-24")).toBe("2026-08-24");
  });

  // ── the retail denominator ──────────────────────────────────────────────────────────────────
  // Measured on production 2026-08-25, only 27.8% of the default window's spend carries a posted
  // price, so a total mixing priced and unpriced fills is the normal case rather than an edge one.
  it("measures the discount over the gallons that HAVE a posted price, not over all of them", () => {
    // 100 gal priced and discounted $0.60/gal; 100 gal with no quote at all.
    const t = totalsOf([at(100, 5, 0.6), fill({ gallons: 100, netAmount: 440 })]);
    expect(t.gallons).toBe(200);
    expect(t.retailGallons).toBe(100);
    expect(t.retailShare).toBe(0.5); // the caller can say what the figure covers
    // $0.60/gal over the priced 100 gal — NOT $60 spread across 200 gal, which would read as $0.30.
    expect(t.discountPerGal).toBeCloseTo(0.6, 6);
    expect(t.retailPerGal).toBeCloseTo(5, 6);
    // netPerGal still spans everything: what we PAID is known for every fill.
    expect(t.netPerGal).toBeCloseTo((440 + 440) / 200, 6);
  });

  it("says it cannot tell rather than reporting a negative discount when nothing has a posted price", () => {
    // The off-network case: EFS records what we paid, and no Pilot quote covers these sites. Divided
    // by all gallons this produced −$4.40/gal under the label "Discount captured".
    const t = totalsOf([fill({ gallons: 100, netAmount: 440 }), fill({ gallons: 50, netAmount: 260 })]);
    expect(t.retailLines).toBe(0);
    expect(t.retailShare).toBe(0);
    expect(t.discountPerGal).toBeNull();
    expect(t.retailPerGal).toBeNull();
    expect(t.capturePct).toBeNull();
    expect(t.discount).toBe(0); // no measured discount, not a negative one
  });
});

describe("analyzeDiscountCapture", () => {
  // Nine ordinary fills near $0.60/gal, plus two that captured nothing.
  const lines = [
    ...Array.from({ length: 9 }, (_, i) => at(100, 5, 0.6, { site: `p${i}` })),
    at(100, 5, 0, { brand: "one9", site: "z1" }),
    at(50, 5, 0, { brand: "one9", site: "z2" }),
  ];

  it("benchmarks against the median, which a floor of zeroes cannot drag down", () => {
    const c = analyzeDiscountCapture(lines);
    expect(c.benchmarkPerGal).toBeCloseTo(0.6, 4);
    // the mean of these rates is 0.49 — a mean benchmark would call the zero-discount fills less bad
    expect(c.totalShortfall).toBeCloseTo(150 * 0.6, 2);
  });

  it("counts only fills BELOW the benchmark, so the total reads as money left behind", () => {
    const c = analyzeDiscountCapture([at(100, 5, 0.9), at(100, 5, 0.3), at(100, 5, 0.6)]);
    expect(c.benchmarkPerGal).toBeCloseTo(0.6, 4);
    expect(c.totalShortfall).toBeCloseTo(30, 2); // the 0.9 fill does not net off the 0.3 fill
  });

  it("bands every fill exactly once", () => {
    const c = analyzeDiscountCapture(lines);
    expect(c.bands.reduce((a, b) => a + b.lines, 0)).toBe(lines.length);
    expect(c.bands.find((b) => b.key === "none")!.lines).toBe(2);
  });

  it("names the sites and brands the shortfall is concentrated in", () => {
    const c = analyzeDiscountCapture(lines);
    expect(c.byBrand[0]!.key).toBe("one9");
    expect(c.byBrand[0]!.shortfall).toBeCloseTo(90, 2);
    expect(c.zeroDiscount).toHaveLength(2);
  });

  it("takes a contract rate instead, turning the report into 'below what we are owed'", () => {
    const c = analyzeDiscountCapture([at(100, 5, 0.6)], 0.8);
    expect(c.benchmarkPerGal).toBe(0.8);
    expect(c.totalShortfall).toBeCloseTo(20, 2);
  });

  it("benchmarks each week against itself, so a moving market cannot manufacture a loss", () => {
    // Two weeks, very different price levels but identical discipline: every fill gets the week's rate.
    const wk = weeklyDiscountCapture([
      ...Array.from({ length: 3 }, () => at(100, 4.2, 0.85, { tranDate: "2026-06-15" })),
      ...Array.from({ length: 3 }, () => at(100, 5.7, 0.53, { tranDate: "2026-08-17" })),
    ]);
    expect(wk).toHaveLength(2);
    expect(wk[0]!.benchmarkPerGal).toBeCloseTo(0.85, 4);
    expect(wk[1]!.benchmarkPerGal).toBeCloseTo(0.53, 4);
    expect(wk[0]!.shortfall).toBe(0);
    expect(wk[1]!.shortfall).toBe(0); // a fixed benchmark would have invented ~$96 of "loss" here
  });

  it("abstains when nothing carries a retail price to compare against", () => {
    const c = analyzeDiscountCapture([fill({ gallons: 100, netAmount: 500 })]);
    expect(c.benchmarkPerGal).toBeNull();
    expect(c.totalShortfall).toBe(0);
  });
});

describe("policy exceptions", () => {
  const lines = [
    at(100, 5.0, 0.6, { state: "TX", brand: "pilot", unit: "701" }),
    at(100, 5.0, 0.6, { state: "OK", brand: "flying_j", unit: "702" }),
    at(80, 6.8, 0.4, { state: "CA", brand: "pilot", unit: "703" }),
    at(60, 5.4, 0.0, { state: "SC", brand: "one9", unit: "754" }),
    at(40, 5.4, 0.0, { state: "OH", brand: "one9", unit: "754" }),
    at(30, 7.0, 0.0, { state: "CA", brand: null, unit: "705", site: null, city: "Olancha" }),
  ];

  it("measures the avoid-brand policy nobody was checking", () => {
    const p = analyzePolicyExceptions(lines);
    expect(p.avoidedBrands.lines).toBe(2);
    expect(p.avoidedBrands.gallons).toBe(100);
    expect(p.avoidedBrands.discountPerGal).toBeCloseTo(0, 4); // not one cent captured
    expect(p.avoidedBrands.byUnit[0]!.key).toBe("754"); // repeat offender, by unit
  });

  it("prices California against what the rest of the fleet paid, not a fixed number", () => {
    const p = analyzePolicyExceptions(lines);
    expect(p.avoidedStates.lines).toBe(2);
    // baseline excludes CA itself, so a large exception cannot shrink its own measured cost
    const nonCa = totalsOf(lines.filter((l) => l.state !== "CA"));
    expect(p.avoidedStates.baselinePerGal).toBeCloseTo(nonCa.netPerGal!, 6);
    expect(p.avoidedStates.excess).toBeGreaterThan(0);
  });

  it("reports fill size beside price, because the policy is 'cross CA on as little as possible'", () => {
    const p = analyzePolicyExceptions(lines);
    expect(p.avoidedStateFillSize.inside).toBeCloseTo(55, 2);
    expect(p.avoidedStateFillSize.outside).toBeCloseTo(75, 2);
  });

  it("counts an unidentified site as off-network rather than assuming compliance", () => {
    const p = analyzePolicyExceptions(lines);
    const keys = p.offNetwork.fills.map((f) => f.line.brand);
    expect(keys).toContain(null);
    expect(keys).toContain("one9");
    expect(keys).not.toContain("pilot");
  });

  it("surfaces the extreme per-gallon fill that a dollar-sorted list buries", () => {
    const r = exceptionReport(lines, (l) => l.brand == null);
    expect(r.fills[0]!.netPerGal).toBeCloseTo(7.0, 4);
    expect(r.fills[0]!.premiumPerGal).toBeGreaterThan(1.5);
  });

  it("uses route_fuel_settings' own defaults", () => {
    expect(DEFAULT_FUEL_POLICY.avoidStates).toEqual(["CA"]);
    expect(DEFAULT_FUEL_POLICY.avoidBrands).toEqual(["one9"]);
  });
});

describe("analyzeAncillary", () => {
  const lines: SpendLine[] = [
    at(1000, 5, 0.6),
    at(42, 4.9, 0, { product: "def", tank: "none" }),
    at(30, 5.2, 0, { tank: "reefer" }),
    fill({ gallons: 0, netAmount: 0, miscAmount: 21.99, salesTax: 1.32 }),
    fill({ gallons: 100, netAmount: 500, retailAmount: 560, miscAmount: 10.98, salesTax: 0.99 }),
  ];

  it("keeps reefer and DEF out of the tractor total", () => {
    const a = analyzeAncillary(lines);
    expect(a.tractorFuel.gallons).toBe(1100);
    expect(a.reeferFuel.gallons).toBe(30);
    expect(a.def.gallons).toBe(42);
  });

  it("counts merchandise bundled onto a fuel ticket, not just standalone lines", () => {
    const a = analyzeAncillary(lines);
    expect(a.merchandise.lines).toBe(2); // one standalone, one riding on a fuel line
    expect(a.merchandise.spend).toBeCloseTo(32.97, 2);
    expect(a.salesTax).toBeCloseTo(2.31, 2);
  });

  it("flags a DEF ratio the engines cannot burn", () => {
    const a = analyzeAncillary(lines);
    expect(a.def.ratio).toBeCloseTo(42 / 1100, 6); // 3.8%
    expect(a.def.outsideExpected).toBe(true);
    const normal = analyzeAncillary([at(1000, 5, 0.6), at(25, 4.9, 0, { product: "def", tank: "none" })]);
    expect(normal.def.ratio).toBeCloseTo(0.025, 4);
    expect(normal.def.outsideExpected).toBe(false);
    expect(DEF_EXPECTED_RATIO.high).toBe(0.03);
  });
});
