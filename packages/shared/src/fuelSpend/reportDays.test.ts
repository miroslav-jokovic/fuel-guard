import { describe, expect, it } from "vitest";
import { fuelReportTotals, previousFuelReportRange, type FuelReportDay } from "./reportDays.js";

/**
 * The SQL sums are pinned against `foldFuelReportDays` in `supabase/tests/fuel-report-days.test.mjs`.
 * What is pinned here is what TypeScript makes of those sums — the verdicts the page prints.
 */
const day = (o: Partial<FuelReportDay>): FuelReportDay => ({
  day: "2026-09-01", network: "in", tank: "tractor", fills: 0, gallons: 0, spend: 0,
  retailFills: 0, retailGallons: 0, retailSpend: 0, retail: 0,
  contractFills: 0, contractGallons: 0, contractSpend: 0, contract: 0, ...o,
});

describe("fuelReportTotals", () => {
  // Two in-network days (one with both quotes, one with the contract quote only); one out-of-network
  // day; one reefer; one unknown station.
  const days = [
    day({ fills: 2, gallons: 200, spend: 1000, retailFills: 1, retailGallons: 100, retailSpend: 480, retail: 560,
      contractFills: 1, contractGallons: 100, contractSpend: 480, contract: 470 }),
    // Quoted by Pilot's contract but carrying no posted price: in the quote figures, not the discount's.
    day({ day: "2026-09-02", fills: 1, gallons: 100, spend: 520, contractFills: 1, contractGallons: 100, contractSpend: 520, contract: 515 }),
    day({ network: "out", fills: 1, gallons: 50, spend: 300 }),
    day({ network: "unknown", fills: 1, gallons: 40, spend: 220 }),
    day({ tank: "reefer", fills: 1, gallons: 30, spend: 160, retailFills: 1, retailGallons: 30, retailSpend: 160, retail: 170 }),
  ];
  const t = fuelReportTotals(days);

  it("keeps reefer fuel out of the tractor figures and reports it beside them", () => {
    expect(t.tractor.gallons).toBe(390);
    expect(t.tractor.spend).toBe(2040);
    expect(t.reefer.gallons).toBe(30);
    expect(t.reefer.spend).toBe(160);
  });

  it("splits tractor fuel by network, with the unknown station as its own side", () => {
    expect(t.byNetwork.in.spend).toBe(1520);
    expect(t.byNetwork.out.spend).toBe(300);
    expect(t.byNetwork.unknown.spend).toBe(220);
    expect(t.byNetwork.in.spend + t.byNetwork.out.spend + t.byNetwork.unknown.spend).toBe(t.tractor.spend);
  });

  it("prices a gallon over every gallon", () => {
    expect(t.tractor.pricePerGal).toBe(Math.round((2040 / 390) * 10_000) / 10_000);
  });

  it("measures the discount over the quoted fills ONLY, and says how much it covers", () => {
    // 560 posted − 480 paid on the same 100 gallons. Over every gallon this would be 560 − 2040.
    expect(t.tractor.discount).toBe(80);
    expect(t.tractor.discountPerGal).toBe(0.8);
    expect(t.tractor.discountCoverage).toBe(Math.round((100 / 390) * 10_000) / 10_000);
  });

  it("reports paid vs Pilot quote over the quoted fills, positive when billed above", () => {
    // (480 − 470) + (520 − 515), over the 200 quoted gallons — not the 100 that also had a posted price.
    expect(t.tractor.paidVsQuote).toBe(15);
    expect(t.tractor.paidVsQuotePerGal).toBe(0.075);
    expect(t.tractor.quoteCoverage).toBe(Math.round((200 / 390) * 10_000) / 10_000);
  });

  it("says null, never 0, where nothing was quoted — out of network is never on Pilot's report", () => {
    expect(t.byNetwork.out.discount).toBeNull();
    expect(t.byNetwork.out.discountPerGal).toBeNull();
    expect(t.byNetwork.out.paidVsQuote).toBeNull();
    expect(t.byNetwork.out.discountCoverage).toBe(0);
  });

  it("has no price at all for a side with no gallons", () => {
    const empty = fuelReportTotals([]);
    expect(empty.tractor.pricePerGal).toBeNull();
    expect(empty.tractor.discountCoverage).toBeNull();
    expect(empty.tractor.spend).toBe(0);
  });
});

describe("previousFuelReportRange (D-FSV3)", () => {
  it("is the same number of days, ending the day before", () => {
    expect(previousFuelReportRange("2026-09-01", "2026-09-30")).toEqual({ from: "2026-08-02", to: "2026-08-31" });
  });
  it("for one day is the day before", () => {
    expect(previousFuelReportRange("2026-09-01", "2026-09-01")).toEqual({ from: "2026-08-31", to: "2026-08-31" });
  });
  it("crosses a year end", () => {
    expect(previousFuelReportRange("2026-01-01", "2026-01-07")).toEqual({ from: "2025-12-25", to: "2025-12-31" });
  });
});
