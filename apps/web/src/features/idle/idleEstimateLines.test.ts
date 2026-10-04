import { describe, it, expect } from "vitest";
import type { IdleCostBasis } from "@silvicom/shared";
import { avoidableCoverageLine, idlePricingLine, idleScopeLine, reducibleCoverageLine } from "./idleEstimateLines";

/**
 * The lines beside the Idling totals (design verdict, move 4). The figures are `computeIdleBreakdown`'s and
 * proved in shared; what is pinned here is that each line says what it covers, what it was priced at, and
 * how far the data reaches — and says nothing it cannot back.
 */
const basis = (o: Partial<IdleCostBasis> = {}): IdleCostBasis => ({ idleGalPerHour: 0.8, fuelPricePerGal: 5.873, priceSource: "truck_stops", ...o });

describe("idlePricingLine", () => {
  it("states the burn rate and the blended day price the total actually carries", () => {
    expect(idlePricingLine({ blendedPricePerGal: 5.912, pricedDays: 30, unpricedDays: 0 }, basis())).toBe(
      "At 0.80 gal an hour idling, each day at that day's diesel price ($5.912/gal on average).",
    );
  });

  it("counts the days with no price and names the fallback and where it came from", () => {
    expect(idlePricingLine({ blendedPricePerGal: 5.9, pricedDays: 27, unpricedDays: 3 }, basis())).toBe(
      "At 0.80 gal an hour idling, each day at that day's diesel price ($5.900/gal on average). 3 of 30 days had no price and used $5.873/gal, the recent truck-stop median.",
    );
    expect(idlePricingLine({ blendedPricePerGal: 4, pricedDays: 0, unpricedDays: 1 }, basis({ fuelPricePerGal: 4, priceSource: "default" }))).toContain(
      "1 of 1 day had no price and used $4.000/gal, a default estimate.",
    );
    expect(idlePricingLine({ blendedPricePerGal: 4.25, pricedDays: 1, unpricedDays: 1 }, basis({ fuelPricePerGal: 4.25, priceSource: "settings" }))).toContain(
      "the price in Idle settings",
    );
  });

  it("says nothing for a total that charged nothing, rather than a price for no gallons", () => {
    expect(idlePricingLine({ blendedPricePerGal: null, pricedDays: 0, unpricedDays: 0 }, basis())).toBeNull();
  });
});

describe("the coverage lines", () => {
  it("names how many trucks each total counts, and how many it leaves out and why", () => {
    expect(avoidableCoverageLine({ confidentTrucks: 180, totalTrucks: 187 })).toBe("Counts 180 of 187 trucks; 7 with too little data are left out.");
    expect(avoidableCoverageLine({ confidentTrucks: 1, totalTrucks: 2 })).toBe("Counts 1 of 2 trucks; 1 with too little data is left out.");
    expect(avoidableCoverageLine({ confidentTrucks: 3, totalTrucks: 3 })).toBe("Counts 3 of 3 trucks.");
    expect(reducibleCoverageLine({ reducibleTrucks: 150, totalTrucks: 187, thinTrucks: 4 })).toBe(
      "From 150 of 187 trucks: the ones with rest idle an APU would carry. 4 seen for under half the range are left out.",
    );
    expect(reducibleCoverageLine({ reducibleTrucks: 1, totalTrucks: 1, thinTrucks: 0 })).toBe("From 1 of 1 truck: the ones with rest idle an APU would carry.");
  });
});

describe("idleScopeLine", () => {
  it("says how far the data reaches, as MM/DD/YYYY, and that the table filters do not narrow the totals", () => {
    expect(idleScopeLine({ throughDay: "2026-10-02" })).toBe(
      "Idle data through 10/02/2026. The cards are fleet totals; the search and filters below narrow the table, not them.",
    );
    expect(idleScopeLine({ throughDay: null })).toContain("No idle data in this range yet");
  });
});
