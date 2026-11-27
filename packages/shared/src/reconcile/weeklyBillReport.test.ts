import { describe, it, expect } from "vitest";
import { buildWeeklyBillReport, pickPilotQuote, type PilotQuote, type WeeklyBillLineIn } from "./weeklyBillReport.js";
import { MIN_CONTRACT_OVERBILL_USD } from "../fuelSpend/exceptions.js";

/**
 * The rebuilt old columns. Figures are shaped on INV-59656 (2026-11-16 → 11-23): a diesel line billed at
 * exactly its quote, one billed above it (store 4599 TN on 11/18 was $0.1323/gal over), a ticket whose
 * in-store items and their tax arrive as separate lines, a reefer line, and a ticket of merchandise alone.
 * Card and vehicle numbers are invented.
 */
const L = (o: Partial<WeeklyBillLineIn> & { lineNumber: number }): WeeklyBillLineIn => ({
  productCode: null, tank: "none", tranDate: "2026-11-18", cardRef: "111111", unit: "700", poName: null, authNo: null,
  ticket: null, odometer: 1000, site: "706", city: "Tulsa", state: "OK", stationId: "st-706", vehicleId: "530001",
  driverId: "1234", gallons: 0, unitCost: null, fuelAmount: null, miscAmount: null, salesTax: 0, invoiceTotal: null,
  retailTotal: null, ...o,
});
const diesel = (o: Partial<WeeklyBillLineIn> & { lineNumber: number }) =>
  L({ productCode: "020", tank: "tractor", ...o });

const LINES: WeeklyBillLineIn[] = [
  // At its quote: 100 gal × 4.6488 = 464.88; retail 565.90.
  diesel({ lineNumber: 1, ticket: "T1", gallons: 100, fuelAmount: 464.88, invoiceTotal: 464.88, retailTotal: 565.9 }),
  // Above its quote: billed 5.0543 vs quoted 4.922 on 151.37 gal = $20.03 over.
  diesel({ lineNumber: 2, ticket: "T2", site: "4599", city: "Monteagle", state: "TN", stationId: "st-4599",
    gallons: 151.37, fuelAmount: 765.07, invoiceTotal: 765.07, retailTotal: 896.11 }),
  // The same ticket's in-store item and its tax, as the new invoice prints them — separate lines.
  L({ lineNumber: 3, ticket: "T2", stationId: "st-4599", miscAmount: 29.99, invoiceTotal: 29.99, retailTotal: 29.99 }),
  L({ lineNumber: 4, ticket: "T2", stationId: "st-4599", salesTax: 1.8, invoiceTotal: 1.8, retailTotal: 1.8 }),
  L({ lineNumber: 5, productCode: "033", tank: "reefer", ticket: "T3", gallons: 11.44, fuelAmount: 59.37, invoiceTotal: 59.37, retailTotal: 60.03 }),
  // Merchandise on a ticket with no fuel: stays its own row, misc and tax together.
  L({ lineNumber: 6, ticket: "T4", miscAmount: 21.99, invoiceTotal: 21.99, retailTotal: 21.99 }),
  L({ lineNumber: 7, ticket: "T4", salesTax: 1.81, invoiceTotal: 1.81, retailTotal: 1.81 }),
  // A diesel line on a day with no quote.
  diesel({ lineNumber: 8, ticket: "T5", tranDate: "2026-11-16", gallons: 50, fuelAmount: 240, invoiceTotal: 240, retailTotal: 280 }),
];
const QUOTES: Record<string, PilotQuote[]> = {
  "st-706": [{ posted: 5.659, net: 4.6488, date: "2026-11-18" }],
  "st-4599": [{ posted: 6.0, net: 4.922, date: "2026-11-17" }],
};
const r = buildWeeklyBillReport(LINES, (station, date) => pickPilotQuote(QUOTES[station] ?? [], date));

describe("buildWeeklyBillReport — the old columns, rebuilt", () => {
  it("folds a ticket's in-store item and its tax onto that ticket's fuel line, as the old statement printed them", () => {
    const t2 = r.rows.find((x) => x.ticket === "T2")!;
    expect(t2.lines).toEqual([2, 3, 4]);
    expect([t2.amount, t2.misc, t2.tax, t2.invoiceTotal]).toEqual([765.07, 29.99, 1.8, 796.86]);
    expect(r.rows).toHaveLength(5);
  });

  it("keeps merchandise with no fuel on its ticket as one row of its own", () => {
    const t4 = r.rows.find((x) => x.ticket === "T4")!;
    expect([t4.productCode, t4.units, t4.misc, t4.tax, t4.invoiceTotal]).toEqual([null, 0, 21.99, 1.81, 23.8]);
  });

  it("derives Fuel Cost from amount ÷ units when the bill does not print it, and keeps a printed one", () => {
    expect(r.rows[0]!.fuelCost).toBe(4.6488);
    const printed = buildWeeklyBillReport([diesel({ lineNumber: 1, gallons: 100, unitCost: 4.5, fuelAmount: 464.88, invoiceTotal: 464.88 })], () => null);
    expect(printed.rows[0]!.fuelCost).toBe(4.5);
  });

  it("computes Savings as Retail Total minus Invoice Total, the old printed Savings Total's definition", () => {
    expect(r.rows[0]!.savings).toBe(101.02);
    expect(r.totals.savings).toBe(r.rows.reduce((a, x) => Math.round((a + (x.savings ?? 0)) * 100) / 100, 0));
    expect(r.totals.invoiceTotal).toBe(1584.91); // 464.88 + 796.86 + 59.37 + 23.80 + 240.00
  });

  it("checks tractor diesel against the day's quote and lists what was billed above it, largest first", () => {
    expect(r.rows[0]).toMatchObject({ quotedPrice: 4.6488, overQuotePerGal: 0, overQuoteUsd: 0 });
    expect(r.overQuote.map((x) => [x.ticket, x.overQuoteUsd])).toEqual([["T2", 20.03]]);
    expect(r.quote).toEqual({ tractorLines: 3, quoted: 2, unquoted: 1, floorUsd: MIN_CONTRACT_OVERBILL_USD });
  });

  it("leaves a line with no quote unmeasured — null, never 0", () => {
    const t5 = r.rows.find((x) => x.ticket === "T5")!;
    expect([t5.quotedPrice, t5.overQuoteUsd]).toEqual([null, null]);
  });

  it("never quotes reefer or merchandise — Pilot's price file is Truck Diesel only", () => {
    expect(r.rows.filter((x) => x.tank !== "tractor").every((x) => x.quotedPrice === null)).toBe(true);
  });

  it("totals per product, with merchandise as its own group", () => {
    expect(r.byProduct.map((p) => [p.code, p.lines, p.units, p.amount])).toEqual([
      ["020", 3, 301.37, 1469.95],
      ["033", 1, 11.44, 59.37],
      ["merchandise", 1, 0, 23.8],
    ]);
  });
});

describe("pickPilotQuote — the rule fuel_spend_lines applies (D-FC4)", () => {
  const q = (date: string): PilotQuote => ({ posted: 1, net: 1, date });
  it("takes the newest quote at or before the day, at most a day old", () => {
    expect(pickPilotQuote([q("2026-11-16"), q("2026-11-17")], "2026-11-18")?.date).toBe("2026-11-17");
    expect(pickPilotQuote([q("2026-11-18"), q("2026-11-17")], "2026-11-18")?.date).toBe("2026-11-18");
  });
  it("never uses a quote from after the fill, or one more than a day old", () => {
    expect(pickPilotQuote([q("2026-11-19")], "2026-11-18")).toBeNull();
    expect(pickPilotQuote([q("2026-11-16")], "2026-11-18")).toBeNull();
  });
});
