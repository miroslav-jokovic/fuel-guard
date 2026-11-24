import ExcelJS from "exceljs";
import type { WeeklyBillReport, WeeklyBillRow } from "@silvicom/shared";
import type { WeeklyBillStatement } from "./weeklyBillRead.js";

/**
 * The weekly Pilot bill as an Excel workbook, in the OLD statement's column order
 * (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §3). The office compared weeks in Excel on the old file; this is
 * that file again, plus the quote columns the old one never had. Where each column comes from is
 * `weeklyBillReport.ts`'s header; this file only lays it out.
 *
 * Totals are live SUMs with their values cached (the IFTA workbook's rule): Excel shows them on open and
 * recomputes them if a cell is edited. A blank cell is a figure the bill does not carry — never a 0.
 */
const MONEY = "$#,##0.00;[Red]-$#,##0.00";
const PRICE = "$0.0000;[Red]-$0.0000";
const UNITS = "#,##0.00";
const DATE = "mm/dd/yyyy";

/** The old statement's 21 columns, in its order, then Vehicle/Driver ID and the quote check. */
const COLUMNS: { header: string; width: number; fmt?: string; value: (r: WeeklyBillRow) => unknown }[] = [
  { header: "Card Number", width: 10, value: (r) => r.card },
  { header: "Unit Number", width: 8, value: (r) => r.unit },
  { header: "Loc.", width: 7, value: (r) => r.site },
  { header: "City", width: 16, value: (r) => r.city },
  { header: "State", width: 6, value: (r) => r.state },
  { header: "Ticket Number", width: 14, value: (r) => r.ticket },
  { header: "AUTH. Number", width: 10, value: (r) => r.auth },
  { header: "P.O. Number", width: 14, value: (r) => r.po },
  { header: "Tran Date", width: 11, fmt: DATE, value: (r) => (r.date ? new Date(`${r.date}T00:00:00Z`) : null) },
  { header: "Odometer Reading", width: 10, value: (r) => r.odometer },
  { header: "Prod", width: 6, value: (r) => r.productCode ?? "misc" },
  { header: "Units", width: 9, fmt: UNITS, value: (r) => r.units },
  { header: "Fuel Cost", width: 9, fmt: PRICE, value: (r) => r.fuelCost },
  { header: "Amount", width: 11, fmt: MONEY, value: (r) => r.amount },
  { header: "Qts", width: 5, value: () => null },
  { header: "Oil Amount", width: 8, value: () => null },
  { header: "Cash Advance", width: 8, value: () => null },
  { header: "Misc./Disc.", width: 10, fmt: MONEY, value: (r) => r.misc || null },
  { header: "Sales Tax", width: 9, fmt: MONEY, value: (r) => r.tax || null },
  { header: "Invoice Total", width: 11, fmt: MONEY, value: (r) => r.invoiceTotal },
  { header: "Retail Total", width: 11, fmt: MONEY, value: (r) => r.retailTotal },
  { header: "Savings", width: 10, fmt: MONEY, value: (r) => r.savings },
  { header: "Vehicle ID", width: 9, value: (r) => r.vehicleId },
  { header: "Driver ID", width: 8, value: (r) => r.driverId },
  { header: "Pilot quote (Your Price)", width: 11, fmt: PRICE, value: (r) => r.quotedPrice },
  { header: "Billed − quote $/gal", width: 10, fmt: PRICE, value: (r) => r.overQuotePerGal },
  { header: "Billed − quote $", width: 10, fmt: MONEY, value: (r) => r.overQuoteUsd },
];
const col = (header: string) => String.fromCharCode(65 + COLUMNS.findIndex((c) => c.header === header));
const SUMMED = ["Units", "Amount", "Misc./Disc.", "Sales Tax", "Invoice Total", "Retail Total", "Savings"];

function header(ws: ExcelJS.Worksheet, values: string[]): void {
  const row = ws.addRow(values);
  row.font = { bold: true };
  row.alignment = { vertical: "bottom", wrapText: true };
  row.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8ECF4" } };
    c.border = { bottom: { style: "thin", color: { argb: "FF9AA5B8" } } };
  });
}

function linesSheet(wb: ExcelJS.Workbook, s: WeeklyBillStatement, r: WeeklyBillReport): void {
  const ws = wb.addWorksheet("Statement", { views: [{ state: "frozen", ySplit: 5 }] });
  ws.addRow([`Pilot weekly bill ${s.invoiceNo} · ${s.periodStart} to ${s.periodEnd}`]).font = { bold: true, size: 14 };
  ws.addRow([`Account ${s.accountNo ?? "—"} · billing date ${s.billingDate ?? "—"} · file ${s.sourceFilename ?? "—"}`]);
  ws.addRow([
    "Rebuilt in the old statement's columns by Silvicom 360. Fuel Cost = amount ÷ units when Pilot did not print it; " +
      "Savings = Retail Total − Invoice Total; Pilot quote = that store's \"Your Price\" from Pilot's daily price file. " +
      "A blank cell is a figure the bill does not carry.",
  ]).font = { italic: true, color: { argb: "FF666666" } };
  ws.addRow([]);
  header(ws, COLUMNS.map((c) => c.header));
  COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
    if (c.fmt) ws.getColumn(i + 1).numFmt = c.fmt;
  });
  const first = ws.rowCount + 1;
  for (const row of r.rows) ws.addRow(COLUMNS.map((c) => c.value(row)));
  const last = ws.rowCount;
  const total = ws.addRow(COLUMNS.map((c) => {
    if (c.header === "Card Number") return "** Customer Total";
    if (!SUMMED.includes(c.header)) return null;
    const key = { Units: "units", Amount: "amount", "Misc./Disc.": "misc", "Sales Tax": "tax", "Invoice Total": "invoiceTotal", "Retail Total": "retailTotal", Savings: "savings" }[c.header] as keyof WeeklyBillReport["totals"];
    const L = col(c.header);
    return { formula: `SUM(${L}${first}:${L}${last})`, result: r.totals[key] };
  }));
  total.font = { bold: true };
  total.eachCell((c) => { c.border = { top: { style: "thin", color: { argb: "FF9AA5B8" } } }; });
}

function summarySheet(wb: ExcelJS.Workbook, s: WeeklyBillStatement, r: WeeklyBillReport): void {
  const ws = wb.addWorksheet("Totals");
  ws.getColumn(1).width = 34;
  for (const i of [2, 3, 4, 5, 6]) ws.getColumn(i).width = 14;
  ws.addRow([`Totals · ${s.invoiceNo}`]).font = { bold: true, size: 14 };
  ws.addRow([]);
  header(ws, ["Product", "Lines", "Units", "Amount", "Retail Total", "Savings"]);
  for (const p of r.byProduct) {
    const row = ws.addRow([`${p.code} Customer Total`, p.lines, p.units, p.amount, p.retail, p.savings]);
    row.getCell(3).numFmt = UNITS;
    for (const c of [4, 5, 6]) row.getCell(c).numFmt = MONEY;
  }
  ws.addRow([]);
  const facts: [string, number | null, string][] = [
    ["Invoice Total (all lines)", r.totals.invoiceTotal, MONEY],
    ["Pilot printed (Amount Purchased / Customer Total)", s.printed.amount, MONEY],
    ["Retail Total", r.totals.retailTotal, MONEY],
    ["Savings Total (Retail − Invoice)", r.totals.savings, MONEY],
    ["Pilot printed Savings Total", s.printed.savings, MONEY],
  ];
  for (const [label, v, fmt] of facts) {
    const row = ws.addRow([label, v]);
    row.getCell(2).numFmt = fmt;
  }
  ws.addRow([]);
  ws.addRow([
    `Tractor diesel lines checked against Pilot's quote: ${r.quote.quoted} of ${r.quote.tractorLines}` +
      (r.quote.unquoted ? ` (${r.quote.unquoted} had no quote that day or the day before)` : ""),
  ]);
  ws.addRow([`Billed above the quote by $${r.quote.floorUsd.toFixed(2)} or more: ${r.overQuote.length} line(s)`]).font = { bold: true };
  if (r.overQuote.length) {
    header(ws, ["Date · store", "Units", "Billed $/gal", "Quote $/gal", "Over $/gal", "Over $"]);
    for (const o of r.overQuote) {
      const row = ws.addRow([`${o.date ?? "—"} · ${o.site ?? "—"} ${o.city ?? ""} ${o.state ?? ""} · ticket ${o.ticket ?? "—"}`, o.units, o.fuelCost, o.quotedPrice, o.overQuotePerGal, o.overQuoteUsd]);
      row.getCell(2).numFmt = UNITS;
      for (const c of [3, 4, 5]) row.getCell(c).numFmt = PRICE;
      row.getCell(6).numFmt = MONEY;
    }
  }
}

export async function weeklyBillWorkbook(s: WeeklyBillStatement, r: WeeklyBillReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Silvicom 360";
  linesSheet(wb, s, r);
  summarySheet(wb, s, r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
