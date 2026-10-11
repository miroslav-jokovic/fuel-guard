import ExcelJS from "exceljs";
import {
  ISSUE_LABEL, SOURCE_LABEL, STATE_NAMES,
  type IftaJurisdictionPosition, type IftaReturnReport,
} from "@silvicom/shared";
import type { IftaReturnMeta } from "./returnReads.js";

/**
 * The IFTA return as an Excel workbook (IFTA-PRECISION-PLAN IP9): the return by state, the two
 * truck × state grids the office asked for (miles, and fuel with each truck's MPG), every fill the
 * fuel grid is made of, and what needs a look before filing.
 *
 * Grid cells carry the UNROUNDED figures under a display format, and every total is a live SUM over
 * them with its value cached, so Excel shows the figure on open and recomputes it if a cell is
 * edited. A total of rounded cells would drift from the return tab by up to half a mile a truck
 * (`returnReport.ts` says why that matters). Dates are real date cells, shown MM/DD/YYYY.
 */
const MILES = "#,##0";
const GALLONS = "#,##0.0";
const MONEY = "$#,##0.00;[Red]-$#,##0.00";
const RATE = "$0.0000";
const PRICE = "$0.000";
const MPG = "0.00";
const DATE = "mm/dd/yyyy";

const stateName = (j: string) => STATE_NAMES[j] ?? j;
const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

function headerRow(ws: ExcelJS.Worksheet, values: string[]): ExcelJS.Row {
  const row = ws.addRow(values);
  row.font = { bold: true };
  row.alignment = { vertical: "bottom", wrapText: true };
  row.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8ECF4" } };
    c.border = { bottom: { style: "thin", color: { argb: "FF9AA5B8" } } };
  });
  return row;
}

function totalRow(row: ExcelJS.Row): void {
  row.font = { bold: true };
  row.eachCell((c) => { c.border = { top: { style: "thin", color: { argb: "FF9AA5B8" } } }; });
}

/** A live SUM with its value cached, so the figure shows without a recalculation. */
const sum = (range: string, result: number): ExcelJS.CellFormulaValue => ({ formula: `SUM(${range})`, result });

function returnSheet(wb: ExcelJS.Workbook, r: IftaReturnReport, meta: IftaReturnMeta): void {
  const ws = wb.addWorksheet("Return by state", { views: [{ state: "frozen", ySplit: 8 }] });
  const p = r.position;
  ws.addRow([`IFTA return, Q${r.quarter} ${r.year}`]).font = { bold: true, size: 14 };
  ws.addRow([meta.orgName ?? ""]);
  ws.addRow([
    p.mpg.fleetMpg == null
      ? "Fleet MPG: could not be measured, so no tax could be computed."
      : `Fleet MPG ${p.mpg.fleetMpg.toFixed(2)}: ${Math.round(p.mpg.totalMiles).toLocaleString("en-US")} taxable miles ÷ ${p.mpg.totalGallons.toLocaleString("en-US", { maximumFractionDigits: 1 })} gallons bought.`,
  ]);
  if (p.mpg.concern) ws.addRow([p.mpg.concern]).font = { bold: true, color: { argb: "FFA11C1C" } };
  else ws.addRow([]);
  ws.addRow([`${r.issues.length} line${r.issues.length === 1 ? "" : "s"} on the "Needs a look" tab.`]);
  ws.addRow([`Working figures from Silvicom 360, not a filed return. Generated ${meta.generatedAt.slice(0, 16).replace("T", " ")} UTC.`]).font = { italic: true, color: { argb: "FF666666" } };
  ws.addRow([]);
  headerRow(ws, [
    "State", "Name", "Total miles", "Taxable miles", "Gallons used (taxable miles ÷ fleet MPG)", "Gallons bought",
    "of which driver-paid", "Diesel rate $/gal", "Tax due", "Credit (paid at the pump)", "Net (+ owed, − refund)", "Surcharge (not in net)",
  ]);
  const lines = [...p.jurisdictions].sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
  const first = ws.rowCount + 1;
  for (const j of lines) ws.addRow(returnLine(j));
  const last = ws.rowCount;
  const total = ws.addRow([
    "Total", "",
    sum(`C${first}:C${last}`, lines.reduce((s, j) => s + j.totalMiles, 0)),
    sum(`D${first}:D${last}`, lines.reduce((s, j) => s + j.taxableMiles, 0)),
    sum(`E${first}:E${last}`, lines.reduce((s, j) => s + (j.gallonsConsumed ?? 0), 0)),
    sum(`F${first}:F${last}`, lines.reduce((s, j) => s + j.gallonsPurchased, 0)),
    sum(`G${first}:G${last}`, lines.reduce((s, j) => s + j.gallonsFromReceipts, 0)),
    "",
    sum(`I${first}:I${last}`, p.liability),
    sum(`J${first}:J${last}`, p.credit),
    sum(`K${first}:K${last}`, p.net),
    sum(`L${first}:L${last}`, p.surcharge),
  ]);
  totalRow(total);
  const formats = [null, null, MILES, MILES, GALLONS, GALLONS, GALLONS, RATE, MONEY, MONEY, MONEY, MONEY];
  formats.forEach((f, i) => { if (f) ws.getColumn(i + 1).numFmt = f; });
  [8, 18, 12, 12, 16, 12, 12, 11, 13, 14, 14, 13].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

function returnLine(j: IftaJurisdictionPosition): ExcelJS.CellValue[] {
  return [
    j.jurisdiction, stateName(j.jurisdiction), j.totalMiles, j.taxableMiles, j.gallonsConsumed, j.gallonsPurchased,
    j.gallonsFromReceipts || null, j.priced ? j.ratePerGal : "no rate", j.liability, j.credit, j.net, j.surcharge || null,
  ];
}

/** Trucks down, states across, a total column and a total row. `extra` adds the columns after the total. */
function gridSheet(
  wb: ExcelJS.Workbook,
  name: string,
  r: IftaReturnReport,
  pick: (t: IftaReturnReport["trucks"][number]) => Record<string, number>,
  cols: { total: string; format: string; columnTotals: Record<string, number> },
  extra: Array<{ header: string; format: string; value: (t: IftaReturnReport["trucks"][number]) => ExcelJS.CellValue; total: (first: number, last: number) => ExcelJS.CellValue }>,
): void {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  const states = r.jurisdictions;
  headerRow(ws, ["Truck", ...states, cols.total, ...extra.map((e) => e.header)]);
  const totalCol = columnLetter(states.length + 2);
  const firstState = columnLetter(2);
  const lastState = columnLetter(states.length + 1);
  const first = 2;
  r.trucks.forEach((t, i) => {
    const row = first + i;
    const values = pick(t);
    const rowTotal = Object.values(values).reduce((s, v) => s + v, 0);
    ws.addRow([
      t.truck,
      ...states.map((j) => values[j] ?? null),
      states.length ? sum(`${firstState}${row}:${lastState}${row}`, rowTotal) : 0,
      ...extra.map((e) => e.value(t)),
    ]);
  });
  const last = ws.rowCount;
  const grand = Object.values(cols.columnTotals).reduce((s, v) => s + v, 0);
  const total = ws.addRow([
    "Total",
    ...states.map((j, i) => {
      const col = columnLetter(i + 2);
      return sum(`${col}${first}:${col}${last}`, cols.columnTotals[j] ?? 0);
    }),
    sum(`${totalCol}${first}:${totalCol}${last}`, grand),
    ...extra.map((e) => e.total(first, last)),
  ]);
  totalRow(total);
  ws.getColumn(1).width = 26;
  for (let c = 2; c <= states.length + 2; c++) {
    ws.getColumn(c).numFmt = cols.format;
    ws.getColumn(c).width = c === states.length + 2 ? 12 : 9;
  }
  extra.forEach((e, i) => {
    ws.getColumn(states.length + 3 + i).numFmt = e.format;
    ws.getColumn(states.length + 3 + i).width = 13;
  });
}

function milesSheet(wb: ExcelJS.Workbook, r: IftaReturnReport): void {
  gridSheet(wb, "Miles by truck", r, (t) => t.taxableMiles,
    { total: "Taxable miles", format: MILES, columnTotals: r.columnTotals.taxableMiles },
    [{
      header: "All miles (incl. non-taxable)",
      format: MILES,
      value: (t) => t.totalMiles || null,
      total: (first, last) => {
        const col = columnLetter(r.jurisdictions.length + 3);
        return sum(`${col}${first}:${col}${last}`, r.trucks.reduce((s, t) => s + t.totalMiles, 0));
      },
    }],
  );
}

/** The column letter of a 1-based index, for the cells written after the state columns. */
function columnLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function fuelSheet(wb: ExcelJS.Workbook, r: IftaReturnReport): void {
  const milesCol = columnLetter(r.jurisdictions.length + 3);
  const totalMiles = r.trucks.reduce((s, t) => s + (t.vehicleId ? t.totalTaxableMiles : 0), 0);
  gridSheet(wb, "Fuel by truck", r, (t) => t.gallons,
    { total: "Gallons bought", format: GALLONS, columnTotals: r.columnTotals.gallons },
    [
      {
        header: "Taxable miles",
        format: MILES,
        value: (t) => (t.vehicleId ? t.totalTaxableMiles : null),
        total: (first, last) => sum(`${milesCol}${first}:${milesCol}${last}`, totalMiles),
      },
      {
        // Values, not a formula: the MPG is `buildIftaReturnReport`'s (D-MPG2), and a second division
        // here would be a second definition of it (`lint:mpg`).
        header: "MPG",
        format: MPG,
        value: (t) => t.mpg,
        total: () => r.position.mpg.fleetMpg,
      },
    ],
  );
}

function fillsSheet(wb: ExcelJS.Workbook, r: IftaReturnReport): void {
  const ws = wb.addWorksheet("Every fill", { views: [{ state: "frozen", ySplit: 1 }] });
  headerRow(ws, ["Truck", "Date", "State", "Gallons", "Price $/gal", "Total $", "Station", "Source"]);
  for (const f of r.fills) {
    ws.addRow([f.truck, day(f.day), f.jurisdiction, f.gallons, f.pricePerGal, f.totalCost, f.location, SOURCE_LABEL[f.source]]);
  }
  const last = ws.rowCount;
  totalRow(ws.addRow(["Total", null, null, sum(`D2:D${last}`, r.fills.reduce((s, f) => s + f.gallons, 0)), null,
    sum(`F2:F${last}`, r.fills.reduce((s, f) => s + (f.totalCost ?? 0), 0))]));
  [null, DATE, null, "#,##0.000", PRICE, MONEY, null, null].forEach((f, i) => { if (f) ws.getColumn(i + 1).numFmt = f; });
  [26, 11, 7, 11, 11, 12, 36, 38].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.autoFilter = { from: "A1", to: `H${last}` };
}

function issuesSheet(wb: ExcelJS.Workbook, r: IftaReturnReport): void {
  const ws = wb.addWorksheet("Needs a look", { views: [{ state: "frozen", ySplit: 1 }] });
  headerRow(ws, ["What", "Truck", "State", "Date", "Figure", "Detail"]);
  if (r.issues.length === 0) ws.addRow(["Nothing: every truck that drove bought fuel, and every fill has a truck."]);
  for (const i of r.issues) {
    const row = ws.addRow([ISSUE_LABEL[i.kind], i.truck, i.jurisdiction, i.day ? day(i.day) : null, i.figure, i.detail]);
    row.alignment = { vertical: "top", wrapText: true };
    row.getCell(5).numFmt = i.kind === "fleet_mpg" || i.kind === "truck_mpg_implausible" ? MPG : "#,##0.0";
  }
  ws.getColumn(4).numFmt = DATE;
  [24, 22, 7, 11, 12, 90].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

export async function iftaReturnWorkbook(r: IftaReturnReport, meta: IftaReturnMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Silvicom 360";
  wb.created = new Date(meta.generatedAt);
  returnSheet(wb, r, meta);
  milesSheet(wb, r);
  fuelSheet(wb, r);
  fillsSheet(wb, r);
  issuesSheet(wb, r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
