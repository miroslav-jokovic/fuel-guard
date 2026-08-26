import { describe, expect, it } from "vitest";
import { dieselTaxSplit, type TaxPremiumFill } from "./taxPremium.js";

const f = (state: string, perGal: number, gallons = 100, tranDate = "2026-08-10"): TaxPremiumFill => ({
  gallons,
  netAmount: perGal * gallons,
  state,
  tranDate,
});

describe("dieselTaxSplit", () => {
  it("splits a pump premium into the jurisdictions' rates and the price of the fuel", () => {
    // California at $6.00 against Texas at $4.50: $1.50 of pump premium, of which 0.9790 − 0.2000 =
    // 0.7790 is the two states' tax rates and $0.721 is what the fuel itself cost more.
    const split = dieselTaxSplit([f("CA", 6)], [f("TX", 4.5)])!;
    expect(split.pumpPremiumPerGal).toBeCloseTo(1.5, 10);
    expect(split.taxPremiumPerGal).toBeCloseTo(0.779, 10);
    expect(split.preTaxPremiumPerGal).toBeCloseTo(0.721, 10);
    expect(split.taxExcess).toBeCloseTo(77.9, 10);
  });

  it("adds up: the three figures are one comparison over one set of gallons", () => {
    const selected = [f("CA", 6.2), f("CA", 5.9, 60)];
    const baseline = [f("TX", 4.4), f("AZ", 4.7, 250), f("IL", 5.1, 80)];
    const split = dieselTaxSplit(selected, baseline)!;
    expect(split.taxPremiumPerGal! + split.preTaxPremiumPerGal!).toBeCloseTo(split.pumpPremiumPerGal!, 10);
  });

  it("measures the premium over the priced gallons only, and says what share that was", () => {
    // Half the selected fills are in a jurisdiction the table cannot price. Both the pump premium and
    // the tax premium describe the priced half; the unpriced half is reported rather than averaged in
    // at some implied rate. Divide a partial numerator by the full gallon count and the three figures
    // stop adding up on screen — B3's defect, in a new denominator.
    const split = dieselTaxSplit([f("CA", 6), f("ON", 4.1)], [f("TX", 4.5)])!;
    expect(split.measuredGallons).toBe(100);
    expect(split.measuredShare).toBeCloseTo(0.5, 10);
    expect(split.unpricedGallons).toBe(100);
    expect(split.pumpPremiumPerGal).toBeCloseTo(1.5, 10);
  });

  it("keeps weight-mile gallons out of both populations rather than counting them as untaxed", () => {
    // Oregon's fuel carries no per-gallon tax because the tax is on the weight-mile return. Left in
    // the baseline it would drag the baseline's tax rate down and inflate every other state's
    // measured tax premium — 1.05% of production's gallons today, and the property must not depend
    // on that staying small.
    const withOregon = dieselTaxSplit([f("CA", 6)], [f("TX", 4.5), f("OR", 4.5)])!;
    const without = dieselTaxSplit([f("CA", 6)], [f("TX", 4.5)])!;
    expect(withOregon.taxPremiumPerGal).toBeCloseTo(without.taxPremiumPerGal!, 10);
    expect(withOregon.baselineTaxPerGal).toBeCloseTo(0.2, 10);
    expect(dieselTaxSplit([f("OR", 4.5)], [f("TX", 4.5)])!.weightMileGallons).toBe(100);
  });

  it("prices each fill from the quarter its own date falls in", () => {
    // The same California station on either side of 2026-07-01 carries a different rate, so a window
    // spanning a quarter boundary is a weighted mix and not one rate applied to all of it.
    const split = dieselTaxSplit([f("CA", 6, 100, "2026-06-30"), f("CA", 6, 100, "2026-07-01")], [f("TX", 4.5)])!;
    expect(split.taxPerGal).toBeCloseTo((0.971 + 0.979) / 2, 10);
    expect(split.versions).toEqual(["2Q2026", "3Q2026"]);
  });

  it("flags a figure that drew on a matrix IFTA has not finalised", () => {
    expect(dieselTaxSplit([f("CA", 6, 100, "2026-05-01")], [f("TX", 4.5, 100, "2026-05-01")])!.provisional).toBe(false);
    expect(dieselTaxSplit([f("CA", 6)], [f("TX", 4.5)])!.provisional).toBe(true);
  });

  it("returns null when nothing on either side could be priced", () => {
    expect(dieselTaxSplit([f("ON", 4)], [f("ON", 4)])).toBeNull();
    expect(dieselTaxSplit([], [])).toBeNull();
  });

  it("gives no premium when only one side has priced gallons, rather than inventing a baseline", () => {
    const split = dieselTaxSplit([f("CA", 6)], [f("ON", 4)])!;
    expect(split.taxPerGal).toBeCloseTo(0.979, 10);
    expect(split.baselineTaxPerGal).toBeNull();
    expect(split.pumpPremiumPerGal).toBeNull();
    expect(split.taxExcess).toBeNull();
  });
});
