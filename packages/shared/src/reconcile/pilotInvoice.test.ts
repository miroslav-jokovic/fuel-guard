import { describe, it, expect } from "vitest";
import { parsePilotInvoice, parsePilotWeeklyBill } from "./pilotInvoice.js";
import { splitTextRun, type StatementWord } from "./pilotStatement.js";

/**
 * A synthetic invoice in the REAL geometry of `Standard_Invoice_Gen_Template_INV-59656.pdf` (billing date
 * 2026-11-23): the x-positions are the measured pdfjs run origins, and each cell goes through `splitTextRun`
 * exactly as the browser's decode does. Card, vehicle and driver numbers are invented — the real file holds
 * card numbers and is not committed. The real 88-page file was verified end to end during development:
 * 960 lines, $341,127.06 against the printed Amount Purchased.
 */
const COL = { card: 19.0, unit: 57.6, date: 107.3, txn: 168.3, loc: 241.8, veh: 313.5, drv: 372.3, odo: 431.4,
  prod: 490.2, qty: 549.3, tax: 589.9, retail: 645.3, invoice: 707.5 } as const;

/** One pdfjs text run, split into words the way `readPdfWords` does (≈3.3pt per character, measured: "475 Moriarty NM" is 49.1pt). */
const run = (text: string, x: number, y: number, page: number): StatementWord[] =>
  splitTextRun({ text, x, y, page, width: text.length * 3.3 });

function meta(page: number): StatementWord[] {
  return [
    ...run("Acct No:", 13.4, 22.8, page), ...run("139445", 85.5, 22.8, page),
    ...run("Pilot Receivables LLC*", 420.8, 23, page),
    ...run("Cycle: Weekly - Mon", 13.4, 71.5, page),
    ...run("Invoice No: INV-59656", 13.4, 83.8, page),
    ...run("Billing Date: 11/23/2026", 13.4, 96, page), ...run("Due Date: 11/25/2026", 121.5, 96, page),
  ];
}

const HEADER: [string, number][] = [
  ["Card#", 19.0], ["Unit Number", 57.9], ["Date", 125.1], ["Transaction #", 178.6], ["Store Location", 249.4],
  ["Vehicle ID", 322.4], ["Driver ID", 383.4], ["Odometer", 440.0], ["Product", 502.5], ["Qty", 558.9],
  ["Sales Tax", 598.2], ["Retail $", 659.7],
];
const header = (): StatementWord[] => [
  ...run("USD Invoice $", 716.6, 152.7, 1),
  ...HEADER.flatMap(([t, x]) => run(t, x, 161.4, 1)),
];

interface Row {
  card: string; unit: string; date: string; txn: string; loc: string; veh?: string; drv: string; odo: string;
  prod: string; qty: string; tax: string; retail: string; invoice: string;
  /** The wrapped second line of Store Location / Product, ~8.4pt below. */
  wrapLoc?: string; wrapProd?: string;
}
function row(y: number, page: number, r: Row): StatementWord[] {
  const out = [
    ...run(r.card, COL.card, y, page), ...run(r.unit, COL.unit, y, page), ...run(r.date, COL.date, y, page),
    ...run(r.txn, COL.txn, y, page), ...run(r.loc, COL.loc, y, page), ...run(r.drv, COL.drv, y, page),
    ...run(r.odo, COL.odo, y, page), ...run(r.prod, COL.prod, y, page), ...run(r.qty, COL.qty, y, page),
    ...run(r.tax, COL.tax, y, page), ...run(r.retail, COL.retail, y, page), ...run(r.invoice, COL.invoice, y, page),
  ];
  if (r.veh) out.push(...run(r.veh, COL.veh, y, page));
  if (r.wrapLoc) out.push(...run(r.wrapLoc, 240.3, y + 8.4, page));
  if (r.wrapProd) out.push(...run(r.wrapProd, COL.prod, y + 8.4, page));
  return out;
}
const footer = (page: number): StatementWord[] => [
  ...run("Pilot Receivables LLC is a wholly owned subsidiary of Pilot Travel Centers LLC and your payment to", 13.4, 560, page),
  ...run("Confidential Information of Pilot Flying J", 420, 560, page),
  ...run(`Page ${page} of 2`, 420, 570, page),
];
const totals = (purchased: string, tax = "$0.00"): StatementWord[] => [
  ...run(`Amount Purchased: ${purchased}`, 13.4, 300, 2),
  ...run(`USD Total: ${purchased}`, 13.4, 312, 2),
  ...run(`Transaction Tax: ${tax}`, 13.4, 324, 2),
  ...run(`Amount Due for Billing Date 11/23/2026: ${purchased}`, 13.4, 336, 2),
];

const base = { drv: "1234", tax: "$0.00" };
const PAGE1 = [
  ...meta(1), ...header(),
  // Reefer, with the state wrapped onto the next line.
  ...row(170.5, 1, { ...base, card: "111111", unit: "813", date: "11/17/2026", txn: "0883000001", loc: "4569 Hardeeville",
    wrapLoc: "SC", veh: "530001", odo: "13445", prod: "Reefer", qty: "11.44", retail: "$60.03", invoice: "$59.37" }),
  // Tractor diesel; a transaction number with Pilot's `DB` suffix.
  ...row(207.2, 1, { ...base, card: "222222", unit: "786", date: "11/20/2026", txn: "0929000002DB", loc: "332 North Little",
    wrapLoc: "Rock AR", veh: "530002", odo: "36237", prod: "Truck Diesel", qty: "158.69", retail: "$888.51", invoice: "$752.55" }),
  // DEF, whose product name wraps — and no Vehicle ID at all.
  ...row(243.7, 1, { ...base, card: "222222", unit: "786", date: "11/20/2026", txn: "0929000002DB", loc: "332 North Little",
    wrapLoc: "Rock AR", odo: "36237", prod: "Diesel Exhaust", wrapProd: "Fluid", qty: "7.19", retail: "$35.22", invoice: "$35.22" }),
  ...footer(1),
];
const PAGE2 = [
  ...meta(2),
  // Page 2 has no column header, as on the real invoice.
  ...row(152.7, 2, { ...base, card: "333333", unit: "708", date: "11/22/2026", txn: "0564000003", loc: "612 Winslow AZ",
    veh: "TESTTR", odo: "246618", prod: "Truck Diesel", qty: "1,107.65", retail: "$6,645.76", invoice: "$5,593.25" }),
  ...row(189.4, 2, { ...base, card: "444444", unit: "637", date: "11/19/2026", txn: "0928000004", loc: "607 West Memphis",
    wrapLoc: "AR", veh: "530004", odo: "486386", prod: "Tax", qty: "1.00", retail: "$3.04", invoice: "$3.04" }),
  ...row(226.1, 2, { ...base, card: "444444", unit: "637", date: "11/16/2026", txn: "0946000005", loc: "156 Madisonville KY",
    veh: "530004", odo: "16326", prod: "Miscellaneous", qty: "1.00", retail: "$29.99", invoice: "$29.99" }),
  ...footer(2),
];
// 59.37 + 752.55 + 35.22 + 5,593.25 + 3.04 + 29.99 = 6,473.42
const DOC = [...PAGE1, ...PAGE2, ...totals("$6,473.42")];

describe("parsePilotInvoice — the 2026-11 invoice layout", () => {
  const r = parsePilotInvoice(DOC)!;

  it("recognises the layout and reads its header block", () => {
    expect(r.layout).toBe("invoice");
    expect(r.account).toBe("139445");
    expect(r.invoiceNumber).toBe("INV-59656");
    expect(r.billingDate).toBe("2026-11-23");
  });

  it("takes the period from the span of its line dates, since none is printed", () => {
    expect(r.startDate).toBe("2026-11-16");
    expect(r.endDate).toBe("2026-11-22");
  });

  it("reads rows on pages that carry no column header", () => {
    expect(r.lines).toHaveLength(6);
    expect(r.lines.filter((l) => l.tranDate === "2026-11-22")[0]!.gallons).toBe(1107.65);
  });

  it("splits Store Location into site, city and state, joining a wrapped second line", () => {
    expect(r.lines.map((l) => [l.site, l.city, l.state])).toEqual([
      ["4569", "Hardeeville", "SC"],
      ["332", "North Little Rock", "AR"],
      ["332", "North Little Rock", "AR"],
      ["612", "Winslow", "AZ"],
      ["607", "West Memphis", "AR"],
      ["156", "Madisonville", "KY"],
    ]);
  });

  it("maps product names to the old statement's codes and keeps reefer off the tractor tank", () => {
    expect(r.lines.map((l) => [l.productDescription, l.productCode, l.tank])).toEqual([
      ["Reefer", "033", "reefer"],
      ["Truck Diesel", "020", "tractor"],
      ["Diesel Exhaust Fluid", "140", "none"],
      ["Truck Diesel", "020", "tractor"],
      ["Tax", null, "none"],
      ["Miscellaneous", null, "none"],
    ]);
    expect(r.fills).toHaveLength(2);
    expect(r.reeferLines).toHaveLength(1);
    expect(r.defLines).toHaveLength(1);
  });

  it("reads non-fuel lines as merchandise with no gallons: a Tax line's charge is sales tax, the rest is misc", () => {
    expect(r.merchandise.map((l) => [l.productDescription, l.gallons, l.netAmount, l.miscAmount, l.salesTax, l.invoiceTotal])).toEqual([
      ["Tax", 0, null, null, 3.04, 3.04],
      ["Miscellaneous", 0, null, 29.99, 0, 29.99],
    ]);
  });

  it("gates Transaction Tax against the Sales Tax column only, not the Tax lines", () => {
    // The fixture's Tax line carries $3.04 while Transaction Tax prints $0.00 — exactly the real invoice.
    expect(r.tieOut.failures).toEqual([]);
    const bad = parsePilotInvoice([...PAGE1, ...PAGE2, ...totals("$6,473.42", "$3.04")])!;
    expect(bad.tieOut.failures.join(" ")).toMatch(/Sales Tax column adds up to \$0\.00, but the invoice prints Transaction Tax \$3\.04/);
  });

  it("keeps Vehicle ID and Driver ID, and a blank Vehicle ID stays blank", () => {
    expect(r.lines.map((l) => l.vehicleId)).toEqual(["530001", "530002", null, "TESTTR", "530004", "530004"]);
    expect(r.lines.every((l) => l.driverId === "1234")).toBe(true);
  });

  it("keeps a transaction number with Pilot's DB suffix, and carries it as the ticket", () => {
    expect(r.lines[1]!.ticket).toBe("0929000002DB");
    expect(r.lines[1]!.authNo).toBeNull();
  });

  it("carries retail and invoice per line and invents no per-gallon price", () => {
    expect(r.fills[0]).toMatchObject({ retailAmount: 888.51, netAmount: 752.55, invoiceTotal: 752.55, unitCost: null });
  });

  it("ties when the lines reproduce the printed Amount Purchased", () => {
    expect(r.tieOut.failures).toEqual([]);
    expect(r.tieOut.ok).toBe(true);
    expect(r.tieOut.amountDelta).toBe(0);
    expect(r.printed.amount).toBe(6473.42);
  });

  it("REFUSES an invoice whose lines do not add up to Amount Purchased", () => {
    const bad = parsePilotInvoice([...PAGE1, ...PAGE2, ...totals("$7,261.19")])!;
    expect(bad.tieOut.ok).toBe(false);
    expect(bad.tieOut.failures.join(" ")).toMatch(/off by \$-787\.77/);
  });

  it("REFUSES an invoice whose Amount Purchased cannot be read", () => {
    const bad = parsePilotInvoice([...PAGE1, ...PAGE2])!;
    expect(bad.tieOut.ok).toBe(false);
    expect(bad.tieOut.failures.join(" ")).toMatch(/Amount Purchased' could not be read/);
  });

  it("reports an unknown product name and keeps it out of every fuel bucket", () => {
    const odd = [...PAGE1, ...row(263.1, 2, { ...base, card: "555555", unit: "700", date: "11/18/2026", txn: "0900000006",
      loc: "706 Tulsa OK", veh: "530005", odo: "1000", prod: "Propane", qty: "10.00", retail: "$40.00", invoice: "$40.00" }),
      ...PAGE2, ...totals("$6,513.42")];
    const p = parsePilotInvoice(odd)!;
    expect(p.tieOut.ok).toBe(true);
    expect(p.tieOut.notes.join(" ")).toMatch(/Product "Propane" is not one this build classifies/);
    expect(p.fills.concat(p.reeferLines, p.defLines).some((l) => l.productDescription === "Propane")).toBe(false);
  });

  it("is not this layout when the header is absent", () => {
    expect(parsePilotInvoice(PAGE2)).toBeNull();
  });
});

describe("parsePilotWeeklyBill", () => {
  it("routes the 2026-11 invoice to its own reader", () => {
    const r = parsePilotWeeklyBill(DOC);
    expect(r.layout).toBe("invoice");
    expect(r.tieOut.ok).toBe(true);
  });

  it("reports no header found for a PDF that is neither layout", () => {
    const r = parsePilotWeeklyBill(run("Some other document", 10, 10, 1));
    expect(r.headerFound).toBe(false);
    expect(r.layout).toBe("statement");
  });
});
