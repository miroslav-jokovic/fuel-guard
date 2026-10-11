import {
  ISSUE_LABEL, STATE_NAMES,
  type IftaReturnReport, type IftaReturnTruck,
} from "@silvicom/shared";
import {
  CONTENT_WIDTH, DANGER, MARGIN, MUTED, NAVY, PAGE_HEIGHT, body, caption, field, heading, newDrawing,
  pdfkitText, table, title, type Cell, type Column,
} from "../../lib/pdfDraw.js";
import type { IftaReturnMeta } from "./returnReads.js";

/**
 * The IFTA return as a PDF (IFTA-PRECISION-PLAN IP9): the return by state, what needs a look, then
 * one block per truck — its states, miles, gallons and fills.
 *
 * Not the two grids. A 190-truck × 40-state matrix does not print on any sheet a person can read, so
 * the PDF carries the same figures a truck at a time, and the grids live in the Excel file. Every
 * figure is the same `IftaReturnReport` the workbook writes, rounded here for print only.
 */
const mi = (n: number) => Math.round(n).toLocaleString("en-US");
const g1 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const usd = (n: number | null) =>
  n == null ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mdy = (ymd: string) => `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}/${ymd.slice(0, 4)}`;

const RETURN_COLUMNS: Column[] = [
  { width: 74, header: "State" },
  { width: 56, header: "Taxable mi", align: "right" },
  { width: 54, header: "Gal used", align: "right" },
  { width: 58, header: "Gal bought", align: "right" },
  { width: 44, header: "Rate", align: "right" },
  { width: 72, header: "Tax due", align: "right" },
  { width: 72, header: "Credit", align: "right" },
  { width: 74, header: "Net", align: "right" },
];

function returnTable(doc: PDFKit.PDFDocument, r: IftaReturnReport): void {
  const p = r.position;
  const rows: Cell[][] = [...p.jurisdictions]
    .sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction))
    .map((j) => [
      { text: STATE_NAMES[j.jurisdiction] ?? j.jurisdiction, sub: j.gallonsFromReceipts ? `incl. ${g1(j.gallonsFromReceipts)} gal driver-paid` : undefined },
      { text: mi(j.taxableMiles) },
      { text: j.gallonsConsumed == null ? "—" : g1(j.gallonsConsumed) },
      { text: g1(j.gallonsPurchased) },
      { text: j.priced && j.ratePerGal != null ? `$${j.ratePerGal.toFixed(4)}` : "no rate", color: j.priced ? undefined : MUTED },
      { text: usd(j.liability) },
      { text: usd(j.credit) },
      { text: usd(j.net), bold: true },
    ]);
  rows.push([
    { text: "Total", bold: true },
    { text: mi(p.jurisdictions.reduce((s, j) => s + j.taxableMiles, 0)), bold: true },
    { text: g1(p.jurisdictions.reduce((s, j) => s + (j.gallonsConsumed ?? 0), 0)), bold: true },
    { text: g1(p.jurisdictions.reduce((s, j) => s + j.gallonsPurchased, 0)), bold: true },
    { text: " " }, // a total has no rate; " " because `table()` prints an empty cell as "—"
    { text: usd(p.liability), bold: true },
    { text: usd(p.credit), bold: true },
    { text: usd(p.net), bold: true },
  ]);
  table(doc, RETURN_COLUMNS, rows);
}

const ISSUE_COLUMNS: Column[] = [
  { width: 96, header: "What" },
  { width: 70, header: "Truck" },
  { width: 34, header: "State" },
  { width: 58, header: "Date" },
  { width: 246, header: "Detail" },
];

function issueTable(doc: PDFKit.PDFDocument, r: IftaReturnReport): void {
  if (r.issues.length === 0) {
    body(doc, "Nothing: every truck that drove bought fuel, every fill has a truck, and the figures match the IFTA page.");
    return;
  }
  table(doc, ISSUE_COLUMNS, r.issues.map((i) => [
    { text: ISSUE_LABEL[i.kind], color: i.kind === "fleet_mpg" || i.kind === "ledger_disagrees" ? DANGER : undefined, bold: i.kind === "fleet_mpg" },
    { text: i.truck ?? "" },
    { text: i.jurisdiction ?? "" },
    { text: i.day ? mdy(i.day) : "" },
    { text: i.detail },
  ]));
}

const TRUCK_COLUMNS: Column[] = [
  { width: 180, header: "State" },
  { width: 108, header: "Taxable miles", align: "right" },
  { width: 108, header: "Gallons bought", align: "right" },
  { width: 108, header: "Fills", align: "right" },
];

/** Room for a truck's heading, the table header and two rows; less than that and the block starts a page. */
const TRUCK_BLOCK_MIN = 80;

function truckBlock(doc: PDFKit.PDFDocument, t: IftaReturnTruck): void {
  if (doc.y + TRUCK_BLOCK_MIN > PAGE_HEIGHT - doc.page.margins.bottom) doc.addPage();
  const states = [...new Set([...Object.keys(t.taxableMiles), ...Object.keys(t.gallons)])].sort();
  const summary = [
    t.vehicleId ? `${mi(t.totalTaxableMiles)} taxable mi` : null,
    `${g1(t.totalGallons)} gal`,
    t.mpg != null ? `${t.mpg.toFixed(2)} mpg` : null,
  ].filter(Boolean).join(" · ");
  doc.moveDown(0.6).fillColor(NAVY).font("Helvetica-Bold").fontSize(10.5)
    .text(pdfkitText(doc, t.vehicleId ? `Unit ${t.truck}` : t.truck), MARGIN, doc.y, { continued: true })
    .fillColor(MUTED).font("Helvetica").fontSize(9).text(pdfkitText(doc, `   ${summary}`));
  doc.moveDown(0.3);
  table(doc, TRUCK_COLUMNS, states.map((j) => [
    { text: STATE_NAMES[j] ?? j },
    { text: t.taxableMiles[j] ? mi(t.taxableMiles[j]!) : "—" },
    { text: t.gallons[j] ? g1(t.gallons[j]!) : "—" },
    { text: t.fills[j] ? String(t.fills[j]) : "—" },
  ]));
}

/** "Page n of N" and the running head, once the page count is known. */
function stamp(doc: PDFKit.PDFDocument, head: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5)
      .text(pdfkitText(doc, `${head}  ·  page ${i - range.start + 1} of ${range.count}`), MARGIN, PAGE_HEIGHT - MARGIN + 4, {
        width: CONTENT_WIDTH, align: "right", lineBreak: false,
      });
    doc.page.margins.bottom = bottom;
  }
}

export async function iftaReturnPdf(r: IftaReturnReport, meta: IftaReturnMeta): Promise<{ pdf: Buffer; pages: number }> {
  const quarter = `Q${r.quarter} ${r.year}`;
  const { doc, done } = newDrawing(`IFTA return ${quarter}`, { bufferPages: true });
  const p = r.position;

  title(doc, `IFTA return, ${quarter}`);
  caption(doc, `${meta.orgName ? `${meta.orgName} · ` : ""}Working figures from Silvicom 360, not a filed return. Generated ${meta.generatedAt.slice(0, 16).replace("T", " ")} UTC.`);
  field(doc, "Fleet MPG", p.mpg.fleetMpg == null ? "could not be measured" : p.mpg.fleetMpg.toFixed(2));
  field(doc, "Taxable miles", mi(p.mpg.totalMiles));
  field(doc, "Gallons bought", `${g1(p.mpg.totalGallons)}${p.receiptGallons ? ` (incl. ${g1(p.receiptGallons)} driver-paid)` : ""}`);
  field(doc, "Net", `${usd(p.net)} ${p.net >= 0 ? "owed" : "refundable"}`);
  if (p.surcharge) field(doc, "Surcharge (not in net)", usd(p.surcharge));
  if (p.mpg.concern) { doc.moveDown(0.4); body(doc, p.mpg.concern, DANGER); }

  heading(doc, "Return by state");
  returnTable(doc, r);

  heading(doc, `Needs a look before filing (${r.issues.length})`);
  issueTable(doc, r);

  doc.addPage();
  heading(doc, "By truck");
  caption(doc, "Each truck's taxable miles and the fuel it bought, per state. The truck × state grids and every fill are in the Excel export.");
  for (const t of r.trucks) truckBlock(doc, t);

  stamp(doc, `IFTA return ${quarter}${meta.orgName ? ` · ${meta.orgName}` : ""}`);
  const pages = doc.bufferedPageRange().count;
  doc.end();
  return { pdf: await done, pages };
}
