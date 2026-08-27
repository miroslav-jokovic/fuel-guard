import {
  CONTENT_WIDTH,
  INK,
  MARGIN,
  MUTED,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  winAnsi,
  table,
  type Cell,
  type Column,
} from "../../dqBinder/pdfDraw.js";
import { CONTINUED, FOOTER } from "./packetText.js";
import type { EquipmentClass } from "@silvicom/shared";

/** Name and legal address, from `organizations` (D-PKT8). Declared here so the drawing layer does
 *  not have to import the renderer's input type and create a cycle. */
export interface PacketCarrier {
  name: string;
  address: string | null;
}

/**
 * The packet's drawing primitives — the ones `pdfDraw.ts` does not have because no other document in
 * this product looks like a government form (P4).
 *
 * `pdfDraw` gives a report: headings, a `field()` with a coloured label, a `table()` that flows and
 * repeats its header across pages. The packet is the other thing — flat labels at a fixed indent, a
 * letterhead block, two verbatim footer lines carrying the CARRIER'S page number, and tables with a
 * printed number of lines. Those live here rather than in `pdfDraw` because they are the packet's
 * shape and not the house style, and nothing else should reach for them by accident.
 */

export const blank = (v: string | null | undefined): string => (v && v.trim() !== "" ? v : "");
export const date = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : "");
export const yesNo = (v: boolean | null | undefined): string => (v === true ? "Yes" : v === false ? "No" : "");

/**
 * Six equipment classes onto the packet's four printed rows.
 *
 * ⚠ **The fold is not information loss, which is worth stating because it looks like it.** The
 * packet's second column is `TYPE OF EQUIPMENT (VAN, TANK, FLAT, ETC.)` — free text — so a tanker
 * prints as class OTHER with type "Tanker" and the reader learns exactly what the driver entered.
 * What IS lossy is multiplicity: two `tractor_semi_trailer` entries with different date ranges share
 * one printed row, which is the continuation problem below rather than a mapping problem.
 */
export const PACKET_ROW_OF: Record<EquipmentClass, number> = {
  straight_truck: 0,
  tractor_semi_trailer: 1,
  tractor_two_trailers: 2,
  tractor_tanker: 3,
  bus: 3,
  other: 3,
};

/**
 * The word that keeps a folded class legible in the type column when the driver left it blank.
 *
 * Short on purpose: the packet's own examples in that column are "VAN, TANK, FLAT", so "Tanker" reads
 * like the form and `EQUIPMENT_CLASS_LABELS`' "Tractor and tanker" does not — the class half is
 * already printed in the row beside it.
 */
const FOLDED_TYPE: Partial<Record<EquipmentClass, string>> = { tractor_tanker: "Tanker", bus: "Bus" };
export const foldedType = (cls: EquipmentClass, given: string | null | undefined): string =>
  blank(given) || FOLDED_TYPE[cls] || "";

/**
 * Fill a fixed-height packet table, and say so when there is more.
 *
 * ⚠ §391.21(b)(7)–(9) asks for ALL accidents and convictions in the period, and the packet gives each
 * table three lines. Truncating silently would produce a document that is signed, filed and
 * materially false — so the overflow is named in the last row and then printed in full underneath,
 * which is what the packet's own "ATTACH SHEET IF MORE SPACE IS NEEDED" means.
 */
export function fixedTable(
  doc: PDFKit.PDFDocument,
  columns: Column[],
  rows: Cell[][],
  printed: number,
): void {
  // ⚠ When there is overflow the marker takes the LAST printed line, so only `printed - 1` rows are
  // drawn here and the rest — starting with the one the marker displaced — go to the continuation.
  // An earlier version sliced at `printed` and then overwrote row `printed - 1` with the marker,
  // which dropped that row from the document entirely: the exact silent truncation this function
  // exists to prevent, and it was caught by "prints every row, not the first three".
  const overflow = rows.length > printed ? rows.slice(printed - 1) : [];
  const shown = rows.slice(0, overflow.length > 0 ? printed - 1 : printed);
  while (shown.length < printed) shown.push(columns.map(() => ({ text: "" })));
  if (overflow.length > 0) {
    shown[printed - 1] = [
      { text: CONTINUED, color: MUTED },
      ...columns.slice(1).map(() => ({ text: "", color: MUTED })),
    ];
  }
  table(doc, columns, shown);
  if (overflow.length === 0) return;

  doc.moveDown(0.5);
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8);
  doc.text(winAnsi(`CONTINUATION — ${overflow.length} more`), MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.3);
  table(doc, columns, overflow);
}

/** A `Label: value` line in the packet's flat style — no rules, no colour, one line each. */
export function line(doc: PDFKit.PDFDocument, label: string, value: string, width = CONTENT_WIDTH): void {
  const top = doc.y;
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5);
  doc.text(winAnsi(`${label}:`), MARGIN, top, { width, lineBreak: false });
  doc.fillColor(INK).font("Helvetica").fontSize(10);
  doc.text(winAnsi(value || "—"), MARGIN + 150, top, { width: width - 150 });
  doc.x = MARGIN;
  doc.moveDown(0.35);
}

export function sectionHeading(doc: PDFKit.PDFDocument, text: string): void {
  doc.moveDown(0.5);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(winAnsi(text), MARGIN, doc.y, {
    width: CONTENT_WIDTH,
  });
  doc.moveDown(0.3);
}

/** The carrier's block, top of every page (D-PKT8). */
export function letterhead(doc: PDFKit.PDFDocument, carrier: PacketCarrier): void {
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(12);
  doc.text(winAnsi(blank(carrier.name) || "—"), MARGIN, MARGIN, { width: CONTENT_WIDTH });
  doc.fillColor(MUTED).font("Helvetica").fontSize(9);
  // ⚠ `legal_address` is nullable (0229). A blank line where a legal address belongs is invisible;
  // saying the field is unset is not. The document is still produced either way — a missing owner
  // input must cost one line, never the whole file (§390.32(d)).
  doc.text(
    winAnsi(carrier.address ?? "(no legal address on file for this carrier)"),
    MARGIN,
    doc.y,
    { width: CONTENT_WIDTH },
  );
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5);
  doc.text(winAnsi(FOOTER.purpose), MARGIN, doc.y + 2, { width: CONTENT_WIDTH });
  doc.moveDown(0.8);
  doc.x = MARGIN;
  doc.fillColor(INK);
}

/**
 * The two verbatim lines, with the packet's own page number.
 *
 * ⚠ The number is the PACKET's, not ours: page 12 of the carrier's form stays "12" even though it is
 * the third page we print. A recruiter holding the paper copy has to be able to match them up.
 */
export function packetFooter(doc: PDFKit.PDFDocument, packetPage: number): void {
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5);
  doc.text(winAnsi(FOOTER.purpose), MARGIN, PAGE_HEIGHT - MARGIN - 16, {
    width: CONTENT_WIDTH,
    lineBreak: false,
  });
  doc.font("Helvetica-Bold").fontSize(7.5);
  doc.text(winAnsi(FOOTER.notAnApplication), MARGIN, PAGE_HEIGHT - MARGIN - 7, {
    width: CONTENT_WIDTH - 20,
    lineBreak: false,
  });
  doc.font("Helvetica").fontSize(7.5);
  doc.text(String(packetPage), PAGE_WIDTH - MARGIN - 20, PAGE_HEIGHT - MARGIN - 7, {
    width: 20,
    align: "right",
    lineBreak: false,
  });
  doc.page.margins.bottom = bottom;
  doc.fillColor(INK);
}

export const cols = (widths: number[], headers: string[]): Column[] =>
  headers.map((header, i) => ({ header, width: widths[i]! }));

/** Page 1 — Commercial driver information. */
