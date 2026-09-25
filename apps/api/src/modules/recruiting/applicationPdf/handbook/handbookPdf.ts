import { HANDBOOK_CARRIER_PLACEMENT_ID, maskedSsn } from "@silvicom/shared";
import { CONTENT_WIDTH, INK, MARGIN, MUTED, PAGE_HEIGHT, RULE, newDrawing, pdfkitText } from "../../../../lib/pdfDraw.js";
import { date } from "../packet/packetDraw.js";
import { HANDBOOK_BLOCKS, HANDBOOK_VERSION, type HandbookBlock, type HandbookRun } from "./handbookText.js";

/**
 * The carrier's DRIVER HANDBOOK, drawn — HANDBOOK-SIGNING-PLAN.md HB2 (D-HB2, D-HB4).
 *
 * ── LAID OUT FROM THE CARRIER'S OWN STRUCTURE ─────────────────────────────────────────────────
 * The owner asked for the text *exactly* and *formatted properly*. So every word comes from
 * `handbookText.json`, and the layout follows what the Word file already said: a cover sheet; the
 * sections the carrier began on a new page begin on one here; its bold and its one underline are kept;
 * the nine fuel rules get a hanging head; and the fines schedule, which Word lined up with spaces, is a
 * ruled two-column table. 10pt body, as the .docx sets it.
 *
 * ── ONE RENDERER, TWO USES ────────────────────────────────────────────────────────────────────
 * The applicant reads THIS document while signing (the link serves it with the marks made so far), and
 * the filed copy is the same call with every mark and the countersignature. A place with no mark draws
 * its empty rules, so the reading copy is the carrier's blank paper and the filed copy is the signed
 * one. Nothing is stored until it is filed.
 *
 * ⚠ The SSN prints as `•••1234` and nothing more (D-HB2). The full number is sealed (D-HIRE6).
 */

export interface HandbookMarkPrint {
  signedName: string;
  signedAt: string;
}

export interface HandbookRepresentativePrint {
  fullName: string;
  title: string;
  signature: Buffer | null;
}

export interface HandbookDocumentInput {
  carrier: { name: string };
  /** The applicant's name as the application gives it — the `name` fields' value. */
  driverName: string;
  ssnLast4: string | null;
  /** The marks made so far, by place. */
  marks: ReadonlyMap<string, HandbookMarkPrint>;
  /** The driver's adopted signature picture (D-PKT13); null prints the typed name. */
  driverSignature: Buffer | null;
  /** Set once the office has countersigned; `appliedBy` is the office user who applied it (D-HB3). */
  countersign: (HandbookRepresentativePrint & { appliedBy: string }) | null;
}

const BODY = 10;
const LINE_GAP = 1.5;
const FOOTER_SPACE = 30;
const floor = (): number => PAGE_HEIGHT - MARGIN - FOOTER_SPACE;

/** Room for `need` points, or a new sheet — so a signature block never breaks from its labels. */
function ensureRoom(doc: PDFKit.PDFDocument, need: number): void {
  if (doc.y + need > floor()) doc.addPage();
}

const face = (r: HandbookRun): string => (r.b ? "Helvetica-Bold" : "Helvetica");

/** A run list as one flowing paragraph: pdfkit's `continued` chain, one call per run. */
function runs(doc: PDFKit.PDFDocument, list: readonly HandbookRun[], opts: { x: number; width: number; align?: "center" | "left"; size?: number }): void {
  const size = opts.size ?? BODY;
  const text = list.filter((r) => r.t.length > 0);
  if (text.length === 0) return;
  // Measured first, whole, so a paragraph that will not fit starts on the next sheet rather than
  // leaving its first line alone at the foot of this one.
  doc.font("Helvetica").fontSize(size);
  const height = doc.heightOfString(pdfkitText(doc, text.map((r) => r.t).join("")), { width: opts.width, lineGap: LINE_GAP });
  ensureRoom(doc, Math.min(height, 3 * size));
  const y = doc.y;
  // ⚠ A CENTRED line of mixed runs is placed by hand. pdfkit's `continued` chain centres each run on
  // its own and draws them over each other — measured on the log-violation ladder, where
  // `1st violation-` (bold) and ` Verbal warning` printed as one smear. Every centred mixed line in
  // the handbook fits on one line; one that does not falls through to the chain below.
  if (opts.align === "center" && text.length > 1) {
    const widths = text.map((r) => doc.font(face(r)).fontSize(size).widthOfString(pdfkitText(doc, r.t)));
    const total = widths.reduce((a, w) => a + w, 0);
    if (total <= opts.width) {
      let x = opts.x + (opts.width - total) / 2;
      text.forEach((r, i) => {
        doc.fillColor(INK).font(face(r)).fontSize(size)
          // `width` is what lets pdfkit size an underline on an unwrapped run: without it the carrier's
          // underlined `must` in the passenger policy threw `unsupported number: NaN`.
          .text(pdfkitText(doc, r.t), x, y, { lineBreak: false, width: widths[i]! + 1, underline: Boolean(r.u) });
        x += widths[i]!;
      });
      doc.x = MARGIN;
      doc.y = y + doc.currentLineHeight(true) + LINE_GAP;
      return;
    }
  }
  text.forEach((r, i) => {
    doc.fillColor(INK).font(face(r)).fontSize(size);
    const t = pdfkitText(doc, r.t);
    const o = { width: opts.width, align: opts.align ?? "left", lineGap: LINE_GAP, underline: Boolean(r.u), continued: i < text.length - 1 };
    if (i === 0) doc.text(t, opts.x, y, o);
    else doc.text(t, o);
  });
  doc.x = MARGIN;
}

function paragraph(doc: PDFKit.PDFDocument, b: Extract<HandbookBlock, { k: "p" }>): void {
  if (b.size === "title") {
    doc.y = PAGE_HEIGHT * 0.32;
    runs(doc, b.runs, { x: MARGIN, width: CONTENT_WIDTH, align: "center", size: 36 });
    doc.moveDown(1.2);
    return;
  }
  if (b.size === "subtitle") {
    runs(doc, b.runs, { x: MARGIN, width: CONTENT_WIDTH, align: "center", size: 18 });
    return;
  }
  if (b.heading) {
    doc.moveDown(0.4);
    runs(doc, b.runs.map((r) => ({ ...r, b: true })), { x: MARGIN, width: CONTENT_WIDTH, size: 11 });
    doc.moveDown(0.3);
    return;
  }
  runs(doc, b.runs, { x: MARGIN, width: CONTENT_WIDTH, align: b.align === "center" ? "center" : "left" });
  doc.moveDown(0.2);
}

/** One numbered fuel rule: the bold head on its own line, the body indented under it. */
function rule(doc: PDFKit.PDFDocument, b: Extract<HandbookBlock, { k: "rule" }>): void {
  ensureRoom(doc, 3 * BODY);
  runs(doc, b.title, { x: MARGIN, width: CONTENT_WIDTH });
  runs(doc, b.body.map((r, i) => (i === 0 ? { ...r, t: r.t.replace(/^\s+/, "") } : r)), { x: MARGIN + 14, width: CONTENT_WIDTH - 14 });
  doc.moveDown(0.35);
}

/** The fines schedule and the bonus, as a ruled table. The carrier's header, never re-cased. */
function table(doc: PDFKit.PDFDocument, b: Extract<HandbookBlock, { k: "table" }>): void {
  const itemW = CONTENT_WIDTH * 0.66;
  const fineX = MARGIN + itemW + 8;
  const fineW = CONTENT_WIDTH - itemW - 8;
  const stroke = (y: number, color = RULE, width = 0.5): void => {
    doc.strokeColor(color).lineWidth(width).moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).stroke();
  };
  const header = (): void => {
    if (!b.head) return;
    const y = doc.y;
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(BODY);
    doc.text(pdfkitText(doc, b.head[0] ?? ""), MARGIN, y, { width: itemW, lineBreak: false });
    doc.text(pdfkitText(doc, b.head[1] ?? ""), fineX, y, { width: fineW, lineBreak: false });
    doc.y = y + BODY + 4;
    stroke(doc.y, INK, 0.75);
    doc.y += 4;
  };
  ensureRoom(doc, 4 * BODY);
  header();
  for (const row of b.rows) {
    // A wrapped item is one sentence the carrier broke by hand; a wrapped fine is two amounts.
    const item = pdfkitText(doc, row.item.join(" "));
    const fine = pdfkitText(doc, row.fine.join("\n"));
    doc.font("Helvetica").fontSize(BODY);
    const h = Math.max(doc.heightOfString(item, { width: itemW }), doc.heightOfString(fine || " ", { width: fineW }));
    if (doc.y + h + 6 > floor()) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    // ⚠ The face is set HERE, after any page turn: `header()` leaves bold behind, and the first row on a
    // continued sheet printed bold until this line existed.
    doc.fillColor(INK).font("Helvetica").fontSize(BODY).text(item, MARGIN, y, { width: itemW });
    doc.text(fine, fineX, y, { width: fineW });
    doc.y = y + h + 3;
    stroke(doc.y);
    doc.y += 3;
  }
  doc.x = MARGIN;
  doc.moveDown(0.4);
}

/** A caption over a rule, with the value written on the rule. */
function fieldLine(doc: PDFKit.PDFDocument, x: number, y: number, width: number, label: string, value: string): void {
  doc.strokeColor(INK).lineWidth(0.5).moveTo(x, y + 24).lineTo(x + width, y + 24).stroke();
  if (value) {
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(BODY + 1).text(pdfkitText(doc, value), x + 2, y + 12, { width: width - 4, lineBreak: false });
  }
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(pdfkitText(doc, label), x, y + 27, { width, lineBreak: false });
}

/** A signature on its rule: the adopted picture, or the typed name in italic when there is none. */
function signatureLine(doc: PDFKit.PDFDocument, x: number, y: number, width: number, label: string, picture: Buffer | null, typed: string | null): void {
  doc.strokeColor(INK).lineWidth(0.5).moveTo(x, y + 24).lineTo(x + width, y + 24).stroke();
  let drawn = false;
  if (typed && picture) {
    try {
      doc.image(picture, x + 2, y - 4, { fit: [width - 4, 27], valign: "bottom" });
      drawn = true;
    } catch (e) {
      // A bad picture costs the picture, never the document: the typed name is the signature of record.
      console.warn("[handbook] a signature image could not be drawn", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (typed && !drawn) {
    doc.fillColor(INK).font("Helvetica-Oblique").fontSize(13).text(pdfkitText(doc, typed), x + 2, y + 9, { width: width - 4, lineBreak: false });
  }
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(pdfkitText(doc, label), x, y + 27, { width, lineBreak: false });
}

/** A signature place: its fields two to a row, each row kept whole. */
function signBlock(doc: PDFKit.PDFDocument, b: Extract<HandbookBlock, { k: "sign" }>, input: HandbookDocumentInput): void {
  const carrier = b.id === HANDBOOK_CARRIER_PLACEMENT_ID;
  const mark = input.marks.get(b.id) ?? null;
  const colW = (CONTENT_WIDTH - 24) / 2;
  const rows = Math.ceil(b.fields.length / 2);
  ensureRoom(doc, rows * 44 + (carrier ? 24 : 8));
  doc.moveDown(0.6);
  for (let r = 0; r < rows; r++) {
    const y = doc.y;
    b.fields.slice(r * 2, r * 2 + 2).forEach((f, i) => {
      const x = MARGIN + i * (colW + 24);
      if (f.field === "signature") {
        const picture = carrier ? (input.countersign?.signature ?? null) : input.driverSignature;
        signatureLine(doc, x, y, colW, f.label, mark ? picture : null, mark?.signedName ?? null);
      } else if (f.field === "name") {
        fieldLine(doc, x, y, colW, f.label, input.driverName);
      } else if (f.field === "date") {
        fieldLine(doc, x, y, colW, f.label, mark ? date(mark.signedAt) : "");
      } else {
        fieldLine(doc, x, y, colW, f.label, maskedSsn(input.ssnLast4));
      }
    });
    doc.y = y + 44;
  }
  if (carrier && input.countersign && mark) {
    // D-HB3: the Representative's judgement and the hand that applied their signature are two facts.
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(
      pdfkitText(
        doc,
        `${input.countersign.fullName}, ${input.countersign.title}. Signature applied from the carrier's file by ${input.countersign.appliedBy} in Silvicom 360.`,
      ),
      MARGIN, doc.y - 6, { width: CONTENT_WIDTH },
    );
  }
  doc.x = MARGIN;
  doc.moveDown(0.4);
}

/** Every page: which document, which text version, and page x of y — stamped once the count is known. */
function footers(doc: PDFKit.PDFDocument, carrier: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // ⚠ The footer sits below the bottom margin, and pdfkit answers text drawn there by adding a page
    // — measured: 11 pages of handbook became 22, each footer alone on a sheet of its own. Lifting the
    // margin for the stamp is what lets it write there.
    doc.page.margins.bottom = 0;
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(
      pdfkitText(doc, `${carrier} · Driver handbook · text ${HANDBOOK_VERSION} · page ${i - range.start + 1} of ${range.count}`),
      MARGIN, PAGE_HEIGHT - MARGIN - 4, { width: CONTENT_WIDTH, align: "center", lineBreak: false },
    );
  }
}

export async function handbookPdf(input: HandbookDocumentInput): Promise<Buffer> {
  const { doc, done } = newDrawing(`Driver handbook — ${input.driverName}`, { bufferPages: true });
  for (const b of HANDBOOK_BLOCKS) {
    if (b.k === "p") paragraph(doc, b);
    else if (b.k === "rule") rule(doc, b);
    else if (b.k === "table") table(doc, b);
    else if (b.k === "sign") signBlock(doc, b, input);
    else if (b.k === "gap") doc.moveDown(0.5);
    else doc.addPage();
  }
  footers(doc, input.carrier.name);
  doc.end();
  return done;
}
