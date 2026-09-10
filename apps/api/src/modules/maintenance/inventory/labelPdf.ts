import PDFDocument from "pdfkit";
import { encode, labelSheet, toSvgPath, type LabelPreset, type LabelPresetId } from "@silvicom/qr";
import type { LabelFaceDto } from "@silvicom/shared";
import { winAnsi } from "../../../lib/pdfDraw.js";

/**
 * Drawing a sheet of labels (INVENTORY-PLAN.md I10; D-INV25, §2.4).
 *
 * ── WHY THIS DOES NOT USE `newDrawing` FROM `lib/pdfDraw.ts` ──────────────────────────────────
 * The plan says label sheets are authored documents and belong on the pdfkit side rather than the
 * pdf-lib side, and they do. But `newDrawing` opens a LETTER page with 54 pt margins and a footer
 * allowance, which is right for a §396.17 report and wrong for every preset here: `roll-single` is a
 * 2×2-inch page that IS the media, and a margin on it would push the only label off the label. So
 * the document is opened directly with the preset's own page size and no margins, and `winAnsi` —
 * the one piece of `pdfDraw` that matters at this size — is imported rather than re-implemented.
 * Folding a variable page size into `newDrawing` would have made the binder's helper answer to a
 * parameter no binder ever passes.
 *
 * ── THE GEOMETRY IS `@silvicom/qr`'s AND NOTHING HERE RECOMPUTES IT ───────────────────────────
 * `labelSheet()` decides where every label goes, including the start position and the nudge;
 * `toSvgPath()` decides what the symbol looks like. This file positions text inside a rectangle it
 * was handed and draws a path it was given. That split is what makes I10's done-when — the preview
 * and the PDF pixel-compared — a meaningful test rather than a comparison of two guesses: the web
 * preview calls the same two functions with the same numbers.
 *
 * ── ECC-H IS NOT A PARAMETER ─────────────────────────────────────────────────────────────────
 * `encode`'s default is H and it stays the default here (§2.4): 30 % recovery, for a label that will
 * be handled with greasy gloves, scuffed against a shelf edge and pressure-washed on a trailer. The
 * cost is a denser symbol, which §2.4 already paid for by keeping the payload short enough for a
 * version-4 grid. Exposing the level would let somebody trade away the one property that makes a
 * label survive its second year, in exchange for a symbol nobody was struggling to scan.
 */

/** Breathing room inside each backing square, in points. */
const PAD = 4;
/** Below this ratio a label is too short to stack the symbol above the text, so the text sits beside it. */
const STACK_RATIO = 0.8;

const CODE_SIZE = 9;
const LINE_SIZE = 7;

/**
 * How the symbol and the text share one label.
 *
 * A 1½" or 2" square stacks — symbol on top, code under it, the naming lines under that — which is
 * what somebody expects of a bin tag and what leaves the symbol as large as the stock allows. The
 * 1"-tall address labels (5160, 5520) cannot: a symbol that filled their height would leave no room
 * for a single line of text beneath it, so the text goes beside instead. That is the reason those
 * two presets are in the set at all — they are the sheet every office already has in a drawer — and
 * the layout is what makes a scannable QR fit on a one-inch-tall label.
 */
const layoutOf = (preset: LabelPreset): "stacked" | "beside" =>
  preset.label.height >= preset.label.width * STACK_RATIO ? "stacked" : "beside";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Draw one symbol so that it fills `size`, with its top-left at (x, y). */
function drawSymbol(doc: PDFKit.PDFDocument, payload: string, x: number, y: number, size: number): void {
  // The quiet zone is inside `size` — `toSvgPath` lays the four specified modules of clear space
  // into the box it is given, so the drawn square already carries the margin a scanner needs and
  // nothing here has to reserve it. Getting that wrong in the other direction is the classic
  // failure: a symbol drawn edge to edge on its backing square will not read.
  const path = toSvgPath(encode(payload), { size });
  doc.save();
  doc.translate(x, y);
  doc.fillColor("#000000").path(path).fill();
  doc.restore();
}

/** Symbol above, code below, naming lines under that. */
function drawStacked(doc: PDFKit.PDFDocument, face: LabelFaceDto, box: Box): void {
  const textHeight = CODE_SIZE + 2 + face.lines.length * (LINE_SIZE + 1);
  const symbol = Math.min(box.width, box.height - textHeight);
  const symbolX = box.x + (box.width - symbol) / 2;

  drawSymbol(doc, face.payload, symbolX, box.y, symbol);

  let cursor = box.y + symbol;
  doc
    .fillColor("#000000")
    .font("Helvetica-Bold")
    .fontSize(CODE_SIZE)
    .text(winAnsi(face.code), box.x, cursor, { width: box.width, align: "center", lineBreak: false });
  cursor += CODE_SIZE + 2;

  doc.font("Helvetica").fontSize(LINE_SIZE);
  for (const line of face.lines) {
    doc.text(winAnsi(line), box.x, cursor, { width: box.width, align: "center", lineBreak: false, ellipsis: true });
    cursor += LINE_SIZE + 1;
  }
}

/** Symbol at the left, text stacked to its right — the only layout that fits a 1"-tall label. */
function drawBeside(doc: PDFKit.PDFDocument, face: LabelFaceDto, box: Box): void {
  const symbol = box.height;
  drawSymbol(doc, face.payload, box.x, box.y, symbol);

  const textX = box.x + symbol + PAD;
  const textWidth = box.width - symbol - PAD;
  // Vertically centred against the symbol rather than hung from the top: the symbol is square and
  // fills the height, so top-aligned text reads as having slipped upwards beside it.
  const textHeight = CODE_SIZE + 2 + face.lines.length * (LINE_SIZE + 1);
  let cursor = box.y + Math.max(0, (box.height - textHeight) / 2);

  doc
    .fillColor("#000000")
    .font("Helvetica-Bold")
    .fontSize(CODE_SIZE)
    .text(winAnsi(face.code), textX, cursor, { width: textWidth, lineBreak: false, ellipsis: true });
  cursor += CODE_SIZE + 2;

  doc.font("Helvetica").fontSize(LINE_SIZE);
  for (const line of face.lines) {
    doc.text(winAnsi(line), textX, cursor, { width: textWidth, lineBreak: false, ellipsis: true });
    cursor += LINE_SIZE + 1;
  }
}

export interface LabelPdfOptions {
  presetId: LabelPresetId;
  startPosition?: number;
  nudge?: { x: number; y: number };
}

/**
 * Render the faces onto sheets of the chosen stock.
 *
 * Pages are added as the placements call for them rather than up front, because `labelSheet` is the
 * authority on how many there are and it already accounts for the start position eating into the
 * first sheet. A page is added when a placement's page index moves past the one being drawn — which
 * also means a run of zero faces produces a single blank page rather than a malformed PDF, since
 * pdfkit opens a document with one page whether or not anything is drawn on it.
 */
export async function renderLabelSheet(
  faces: LabelFaceDto[],
  options: LabelPdfOptions,
): Promise<Buffer> {
  const sheet = labelSheet(faces.length, options.presetId, {
    startPosition: options.startPosition,
    nudge: options.nudge,
  });
  const layout = layoutOf(sheet.preset);

  const doc = new PDFDocument({
    size: [sheet.preset.sheet.width, sheet.preset.sheet.height],
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    info: { Title: `Labels — ${sheet.preset.name}` },
    autoFirstPage: true,
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  let page = 0;
  sheet.placements.forEach((placement, i) => {
    const face = faces[i];
    if (!face) return;
    while (page < placement.page) {
      doc.addPage({
        size: [sheet.preset.sheet.width, sheet.preset.sheet.height],
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      page += 1;
    }
    const box: Box = {
      x: placement.x + PAD,
      y: placement.y + PAD,
      width: placement.width - PAD * 2,
      height: placement.height - PAD * 2,
    };
    if (layout === "stacked") drawStacked(doc, face, box);
    else drawBeside(doc, face, box);
  });

  doc.end();
  return done;
}
