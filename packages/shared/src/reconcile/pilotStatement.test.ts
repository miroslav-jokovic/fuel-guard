import { describe, it, expect } from "vitest";
import { parsePilotStatement, splitTextRun, classifyStatementProduct, type StatementWord } from "./pilotStatement.js";

/**
 * A synthetic statement in the REAL geometry of `db139445F.pdf` (invoice 795506105, 2026-08-17 →
 * 2026-08-23) — the x-positions below are the actual measured ones, so this exercises the same column
 * binding a real upload does. Kept small enough to read; the five real statements were verified
 * end-to-end through the pdfjs path during development.
 */
const X = {
  card: 19, unit: 79, loc: 95, city: 116, state: 167, ticket: 177, auth: 221, po: 264,
  date: 337, odo: 365, prod: 414, units: 448, cost: 471, amount: 511, misc: 645, tax: 678,
  invoice: 706, retail: 748,
} as const;

const HEADER_X = [24, 61, 97, 115, 156, 184, 227, 283, 339, 370, 409, 437, 472, 503, 543, 566, 600, 641, 674, 704, 744];
const HEADER_TEXT = ["Number", "Number", "Loc.", "City", "State", "Number", "Number", "Number", "Date", "Reading",
  "Prod", "Units", "Cost", "Amount", "Qts", "Amount", "Advance", "Disc.", "Tax", "Total", "Total"];

const w = (text: string, x: number, y: number, page = 1): StatementWord => ({ text, x, y, page });

function meta(y: number): StatementWord[] {
  return [
    w("Acct", 22, y), w("No:", 44, y), w("139445", 83, y),
    w("Invoice", 24, y + 10), w("Number:", 58, y + 10), w("795506105", 99, y + 10),
    w("For", 287, y + 10), w("Period", 305, y + 10), w("Beginning", 337, y + 10),
    w("08/17/26,", 384, y + 10), w("Ending", 428, y + 10), w("08/23/26", 462, y + 10),
    w("Billing", 579, y), w("Date:", 609, y), w("08/24/26", 636, y),
  ];
}
const header = (y: number) => HEADER_TEXT.map((t, i) => w(t, HEADER_X[i]!, y));

/** One transaction line. `misc`/`tax` model an in-store purchase bundled onto the same ticket. */
function line(y: number, o: { card: string; unit: string; loc: string; city: string; state: string; ticket: string;
  auth: string; po: string; date: string; odo: string; prod: string; units: string; cost: string; amount: string;
  invoice: string; retail: string; misc?: string; tax?: string }): StatementWord[] {
  const out = [
    w(o.card, X.card, y), w(o.unit, X.unit, y), w(o.loc, X.loc, y), w(o.city, X.city, y), w(o.state, X.state, y),
    w(o.ticket, X.ticket, y), w(o.auth, X.auth, y), w(o.po, X.po, y), w(o.date, X.date, y), w(o.odo, X.odo, y),
    w(o.prod, X.prod, y), w(o.units, X.units, y), w(o.cost, X.cost, y), w(o.amount, X.amount, y),
    w(o.invoice, X.invoice, y), w(o.retail, X.retail, y),
  ];
  if (o.misc) out.push(w(o.misc, X.misc, y));
  if (o.tax) out.push(w(o.tax, X.tax, y));
  return out;
}

// Two tractor fills (one carrying a bundled in-store charge), one reefer, one DEF, one merchandise line.
const LINES: StatementWord[] = [
  ...line(150, { card: "957562", unit: "684", loc: "041", city: "Mt", state: "KY", ticket: "051033249",
    auth: "367611", po: "HENRY SMITH", date: "08/17", odo: "335019", prod: "020", units: "168.6",
    cost: "4.9442", amount: "833.39", invoice: "833.39", retail: "977.50" }),
  ...line(161, { card: "987568", unit: "648", loc: "1057", city: "Pasadena", state: "TX", ticket: "051021971",
    auth: "363545", po: "BRYAN FLEMING", date: "08/18", odo: "379205", prod: "020", units: "100.0",
    cost: "5.0000", amount: "500.00", misc: "10.98", tax: "0.99", invoice: "511.97", retail: "560.00" }),
  ...line(172, { card: "327974", unit: "699", loc: "037", city: "Whiteland", state: "IN", ticket: "089272986",
    auth: "373364", po: "RALPH GARDNER", date: "08/17", odo: "217932", prod: "033", units: "30.6",
    cost: "5.2865", amount: "161.93", invoice: "161.93", retail: "180.70" }),
  ...line(183, { card: "957562", unit: "684", loc: "041", city: "Mt", state: "KY", ticket: "051033249",
    auth: "367611", po: "HENRY SMITH", date: "08/17", odo: "335019", prod: "140", units: "6.0",
    cost: "4.9000", amount: "29.40", invoice: "29.40", retail: "29.40" }),
  ...line(194, { card: "937562", unit: "732", loc: "1382", city: "Hudson", state: "CO", ticket: "082457806",
    auth: "323710", po: "ANTHONY", date: "08/18", odo: "140299", prod: "", units: "0.0",
    cost: ".0000", amount: "0.00", misc: "11.00", tax: "0.76", invoice: "11.76", retail: "11.76" }),
];

// Units: 168.6 + 100.0 + 30.6 + 6.0 = 305.2 (020 = 268.6).
// Fuel amounts: 833.39 + 500.00 + 161.93 + 29.40 = 1524.72. Retail: 977.50+560.00+180.70+29.40+11.76 = 1759.36.
// Invoice incl. misc+tax: 1524.72 + 21.98 + 1.75 = 1548.45. Savings = 1759.36 − 1548.45 = 210.91.
const TOTALS: StatementWord[] = [
  w("268.6", 432, 300), w("1,333.39", 495, 300), w("020", 96, 302), w("Customer", 117, 302), w("Total", 154, 302),
  w("30.6", 443, 313), w("161.93", 504, 313), w("033", 96, 315), w("Customer", 117, 315), w("Total", 154, 315),
  w("6.0", 437, 326), w("29.40", 500, 326), w("140", 96, 328), w("Customer", 117, 328), w("Total", 154, 328),
  w("**", 94, 340), w("Customer", 102, 340), w("Total", 139, 340),
  w("305.2", 433, 340), w("1,524.72", 496, 340), w(".00", 622, 340), w("1.75", 679, 340), w("1,759.36", 734, 340),
  w("Savings", 94, 372), w("Total", 124, 372), w("210.91", 500, 372),
  // the legend Pilot prints on the summary page
  w("020", 620, 400), w("Truck", 640, 400), w("Diesel", 665, 400),
  w("033", 620, 411), w("Reefer", 640, 411),
  w("140", 620, 422), w("Diesel", 640, 422), w("Exhaust", 665, 422), w("Fluid", 700, 422),
];

const DOC = [...meta(20), ...header(133), ...LINES, ...TOTALS];

describe("classifyStatementProduct", () => {
  it("keeps reefer off the tractor tank and never guesses an unknown code", () => {
    expect(classifyStatementProduct("020")).toEqual({ product: "diesel", tank: "tractor", known: true });
    expect(classifyStatementProduct("033")).toEqual({ product: "diesel", tank: "reefer", known: true });
    expect(classifyStatementProduct("140")).toEqual({ product: "def", tank: "none", known: true });
    expect(classifyStatementProduct("777")).toEqual({ product: "other", tank: "none", known: false });
  });
});

describe("splitTextRun", () => {
  it("splits a merged run and interpolates each word's position", () => {
    // pdfjs returns the Unit and Loc. columns merged when they abut, e.g. "699 037".
    const parts = splitTextRun({ text: "699 037", x: 79.3, y: 150, page: 1, width: 33 });
    expect(parts.map((p) => p.text)).toEqual(["699", "037"]);
    expect(parts[0]!.x).toBeCloseTo(79.3, 1);
    expect(parts[1]!.x).toBeGreaterThan(93); // lands in the Loc. column, not Unit
  });
  it("passes a single word through untouched and drops blanks", () => {
    expect(splitTextRun({ text: "833.39", x: 511, y: 150, page: 1, width: 30 })).toEqual([
      { text: "833.39", x: 511, y: 150, page: 1 },
    ]);
    expect(splitTextRun({ text: "   ", x: 1, y: 1, page: 1, width: 5 })).toEqual([]);
  });
});

describe("parsePilotStatement", () => {
  const r = parsePilotStatement(DOC);

  it("reads the invoice header", () => {
    expect(r.headerFound).toBe(true);
    expect(r.account).toBe("139445");
    expect(r.invoiceNumber).toBe("795506105");
    expect(r.startDate).toBe("2026-08-17");
    expect(r.endDate).toBe("2026-08-23");
    expect(r.billingDate).toBe("2026-08-24");
  });

  it("splits the products by tank, keeping reefer out of the tractor fills", () => {
    expect(r.fills.map((f) => f.productCode)).toEqual(["020", "020"]);
    expect(r.reeferLines.map((f) => f.productCode)).toEqual(["033"]);
    expect(r.defLines.map((f) => f.productCode)).toEqual(["140"]);
    expect(r.merchandise).toHaveLength(1);
  });

  it("binds every column, including P.O. whose values sit left of their header token", () => {
    const f = r.fills[0]!;
    expect(f.cardRef).toBe("957562");
    expect(f.unit).toBe("684");
    expect(f.site).toBe("41"); // leading zeros stripped so it joins fuel_stations.store_number
    expect(f.state).toBe("KY");
    expect(f.poNumber).toBe("HENRY SMITH");
    expect(f.authNo).toBe("367611");
    expect(f.ticket).toBe("051033249");
    expect(f.odometer).toBe(335019);
    expect(f.gallons).toBeCloseTo(168.6);
    expect(f.unitCost).toBeCloseTo(4.9442);
    expect(f.netAmount).toBeCloseTo(833.39);
    expect(f.retailAmount).toBeCloseTo(977.5);
    expect(f.tranDate).toBe("2026-08-17");
  });

  it("keeps fuel cost separate from a bundled in-store charge", () => {
    const f = r.fills[1]!;
    expect(f.netAmount).toBeCloseTo(500.0); // fuel only — what fuel_transactions.total_cost holds
    expect(f.miscAmount).toBeCloseTo(10.98);
    expect(f.salesTax).toBeCloseTo(0.99);
    expect(f.invoiceTotal).toBeCloseTo(511.97); // what Pilot actually bills
  });

  it("ties out to the totals the statement prints for itself", () => {
    expect(r.tieOut.failures).toEqual([]);
    expect(r.tieOut.ok).toBe(true);
    expect(r.tieOut.amountDelta).toBeCloseTo(0, 2);
    expect(r.tieOut.retailDelta).toBeCloseTo(0, 2);
    expect(r.tieOut.savingsDelta).toBeCloseTo(0, 2);
  });

  it("rejects the file when a column is mis-read, rather than reporting wrong money", () => {
    // Shift one line's Amount into the neighbouring column — the sort of drift a layout change causes.
    const broken = DOC.map((x) => (x.text === "833.39" && x.x === X.amount ? { ...x, x: X.amount + 40 } : x));
    const bad = parsePilotStatement(broken);
    expect(bad.tieOut.ok).toBe(false);
    expect(bad.tieOut.failures.join(" ")).toMatch(/does not match the statement's printed/);
  });

  it("reports gallons as a note, never a rejection — Pilot totals unrounded quantities", () => {
    expect(r.tieOut.ok).toBe(true);
    expect(r.tieOut.unitsDelta).toBeCloseTo(0, 1);
  });
});
