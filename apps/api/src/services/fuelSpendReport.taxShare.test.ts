import { describe, expect, it } from "vitest";
import { analyzePolicyExceptions, type SpendLine } from "@fuelguard/shared";
import { taxSharePhrase } from "./fuelSpendReportPolicy.js";

/**
 * The document's half of F10. pdfkit compresses its content streams, so a rendered sentence cannot be
 * read back out of the bytes — which is why the phrase is built by an exported pure function and
 * drawn by a one-line caller, the same split `fuelSpendReport.widths.test.ts` uses for the column
 * arithmetic.
 *
 * What this protects is a document being forwarded. "California cost us $19,858" quoted back without
 * the rest of the sentence is a claim about somebody's dispatching, and 41% of that figure is
 * California's own tax rate — owed on the miles driven there whichever state the fuel was bought in.
 */
const fill = (o: Partial<SpendLine> & { state: string; gallons: number; netAmount: number }): SpendLine => ({
  tranDate: "2026-08-10", brand: "pilot", site: "1", city: "Somewhere", unit: "701", driver: "A DRIVER",
  product: "diesel", tank: "tractor", retailAmount: null, miscAmount: null, salesTax: null, ...o,
});

/** California fuel against Texas fuel — the shape the avoided-state report always has. */
const california = () =>
  analyzePolicyExceptions(
    [
      fill({ state: "CA", gallons: 100, netAmount: 620 }),
      fill({ state: "TX", gallons: 400, netAmount: 400 * 4.4, site: "2" }),
      fill({ state: "AZ", gallons: 300, netAmount: 300 * 4.5, site: "3" }),
    ],
    { avoidStates: ["CA"], avoidBrands: ["one9"], preferredBrands: ["pilot", "flying_j"] },
  );

describe("taxSharePhrase", () => {
  it("names the dollars of the excess that are a jurisdiction's tax rate", () => {
    const phrase = taxSharePhrase([{ name: "California", r: california().avoidedStates }])!;
    expect(phrase).toContain("state fuel tax accounts for");
    expect(phrase).toContain("of California");
    expect(phrase).toContain("owed on the miles driven there whichever state the fuel was bought in");
  });

  it("says which matrix priced it, over what share, and that it is not net of IFTA", () => {
    const phrase = taxSharePhrase([{ name: "California", r: california().avoidedStates }])!;
    expect(phrase).toContain("3Q2026 IFTA matrix");
    expect(phrase).toMatch(/measured over \d+\.\d% of those gallons/);
    expect(phrase).toContain("NOT net of IFTA");
  });

  it("stays silent where tax is not part of the gap, rather than printing a negative under the word tax", () => {
    // The off-network report selects fills wherever the truck happened to be, which averages BELOW a
    // report selecting one expensive state — a negative tax premium is its ordinary case, and a
    // sentence announcing minus four hundred dollars of tax is noise in a paragraph asking for trust.
    const offNetwork = analyzePolicyExceptions(
      [
        fill({ state: "TX", gallons: 100, netAmount: 620, brand: null, site: "x1" }),
        fill({ state: "CA", gallons: 100, netAmount: 500, site: "p1" }),
      ],
      { avoidStates: ["CA"], avoidBrands: [], preferredBrands: ["pilot", "flying_j"] },
    ).offNetwork;
    expect(taxSharePhrase([{ name: "Off the preferred network", r: offNetwork }])).toBeNull();
  });

  it("stays silent when the tax table cannot price the window at all", () => {
    const older = analyzePolicyExceptions(
      [
        fill({ state: "CA", gallons: 100, netAmount: 620, tranDate: "2024-03-01" }),
        fill({ state: "TX", gallons: 400, netAmount: 1760, tranDate: "2024-03-01", site: "2" }),
      ],
      { avoidStates: ["CA"], avoidBrands: [], preferredBrands: ["pilot"] },
    ).avoidedStates;
    expect(taxSharePhrase([{ name: "California", r: older }])).toBeNull();
  });

  it("names every report that has a tax share, not only the first", () => {
    const ex = california();
    const phrase = taxSharePhrase([
      { name: "California", r: ex.avoidedStates },
      { name: "Everything off policy", r: ex.offPolicy },
    ])!;
    expect(phrase).toContain("of California and");
    expect(phrase).toContain("Everything off policy");
  });
});
