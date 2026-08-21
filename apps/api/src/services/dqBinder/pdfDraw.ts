import PDFDocument from "pdfkit";

/**
 * The pdfkit primitives the binder draws with (DQ-BINDER-PLAN D-BD1).
 *
 * pdfkit stays for the pages we AUTHOR — cover, checklist, separators, history — because its text
 * layout is far better than anything else available here. It cannot copy a page out of an existing
 * PDF, which is what `merge.ts` uses pdf-lib for. Two libraries, each doing the thing it is good at.
 *
 * Separated from `render.ts` so the page content is written in one vocabulary rather than in raw
 * font/colour calls, and so a change to the house style is one file.
 */

/** Mirrors the palette `defensePacket.ts` established, so the two PDFs this product emits match. */
export const NAVY = "#1F3864";
export const INK = "#1a1a1a";
export const MUTED = "#666666";
export const RULE = "#d4d4d4";
export const DANGER = "#a11c1c";
export const WARN = "#a05a00";
export const OK = "#1a7a3a";

export const MARGIN = 54;
/** Letter, in points — every page the binder authors, so the merged file is uniform. */
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export interface Drawing {
  doc: PDFKit.PDFDocument;
  /** Resolves with the finished bytes once `doc.end()` has been called. */
  done: Promise<Buffer>;
}

/**
 * Fold text into WinAnsi, which is all the PDF standard fonts can encode.
 *
 * THIS IS A REAL COMPROMISE AND IT IS DELIBERATE. Both pdfkit's built-in Helvetica and pdf-lib's
 * StandardFonts are WinAnsi; handed a name like "Nikolić" they THROW rather than degrade, which
 * would fail the whole binder over one driver's surname. The alternatives are worse: shipping a
 * Unicode TTF adds a font binary and a licence to the repository for a handful of glyphs, and
 * dropping the characters silently would print "Nikoli".
 *
 * So Latin letters lose their diacritics — the form every DOT document a US carrier files already
 * uses — and anything genuinely unrepresentable becomes '?', which reads as a defect rather than as
 * a different person's name. Applied inside every helper below, so no drawing path can skip it.
 */
export function winAnsi(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining marks: c-acute becomes c, s-caron becomes s
    .replace(/\u0110/g, "D")
    .replace(/\u0111/g, "d") // D-with-stroke carries no combining mark
    .replace(/\u0141/g, "L")
    .replace(/\u0142/g, "l") // L-with-stroke likewise
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2022/g, "\u00b7")
    .replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, "?");
}

/**
 * A document with NO footer of its own. Footers, page numbers and the export id are stamped across
 * the WHOLE binder after the merge, when the total page count is finally known and the scanned pages
 * can be stamped identically — see `merge.ts`. Drawing them here would number each fragment 1 of 1.
 */
export function newDrawing(title: string, opts: { bufferPages?: boolean } = {}): Drawing {
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: MARGIN, bottom: MARGIN + 18, left: MARGIN, right: MARGIN },
    info: { Title: title },
    autoFirstPage: true,
    // Opt-in, because the binder deliberately does NOT want it (see the note above): its footers are
    // stamped across the merged file. A document that stands alone — the rendered §391.21
    // application (A6) — needs its pages held open so the footer pass can revisit them once the total
    // count is known, which is what `bufferedPageRange` and `switchToPage` require.
    bufferPages: opts.bufferPages === true,
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );
  return { doc, done };
}

export function title(doc: PDFKit.PDFDocument, text: string): void {
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(19).text(winAnsi(text));
}

export function heading(doc: PDFKit.PDFDocument, text: string): void {
  doc
    .moveDown(0.7)
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(winAnsi(text))
    .moveDown(0.25);
}

export function body(doc: PDFKit.PDFDocument, text: string, color = INK): void {
  doc
    .fillColor(color)
    .font("Helvetica")
    .fontSize(9.5)
    .text(winAnsi(text), { width: CONTENT_WIDTH });
}

export function muted(doc: PDFKit.PDFDocument, text: string): void {
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(8.5)
    .text(winAnsi(text), { width: CONTENT_WIDTH });
}

/** A label/value pair on one line — the shape every cover block on these pages is made of. */
export function field(doc: PDFKit.PDFDocument, label: string, value: string): void {
  const y = doc.y;
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(9)
    .text(winAnsi(label), MARGIN, y, { width: 130 });
  doc
    .fillColor(INK)
    .font("Helvetica-Bold")
    .fontSize(9.5)
    .text(winAnsi(value), MARGIN + 134, y, { width: CONTENT_WIDTH - 134 });
  doc.x = MARGIN;
  doc.y = Math.max(doc.y, y + 14);
}

export function rule(doc: PDFKit.PDFDocument): void {
  doc.moveDown(0.4);
  doc
    .strokeColor(RULE)
    .lineWidth(0.5)
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .stroke();
  doc.moveDown(0.4);
}

export interface Column {
  /** Width in points. The caller's widths must sum to CONTENT_WIDTH or less. */
  width: number;
  header: string;
  align?: "left" | "right";
}

export interface Cell {
  text: string;
  /** A second, smaller line under the value — a citation under a requirement name. */
  sub?: string;
  color?: string;
  bold?: boolean;
}

const ROW_PAD = 5;

/**
 * A table that breaks across pages and repeats its header.
 *
 * Written rather than borrowed because the checklist is the index an auditor works from: it has to
 * survive a page break with its header intact, and a row must never be split down the middle. The
 * height of every row is measured before it is drawn, and the page is turned first if it would not
 * fit whole.
 */
export function table(doc: PDFKit.PDFDocument, columns: Column[], rows: Cell[][]): void {
  const drawHeader = (): void => {
    let x = MARGIN;
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8);
    for (const c of columns) {
      doc.text(winAnsi(c.header.toUpperCase()), x, doc.y, {
        width: c.width,
        align: c.align ?? "left",
        continued: false,
        lineBreak: false,
      });
      doc.y -= doc.currentLineHeight();
      x += c.width;
    }
    doc.y += doc.currentLineHeight() + 3;
    doc
      .strokeColor(RULE)
      .lineWidth(0.5)
      .moveTo(MARGIN, doc.y)
      .lineTo(PAGE_WIDTH - MARGIN, doc.y)
      .stroke();
    doc.y += ROW_PAD;
    doc.x = MARGIN;
  };

  drawHeader();

  for (const row of rows) {
    // Measure first: a row that would straddle a page break is moved whole to the next page.
    let height = 0;
    columns.forEach((c, i) => {
      const cell = row[i];
      if (!cell) return;
      doc.font(cell.bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
      let h = doc.heightOfString(winAnsi(cell.text) || "—", { width: c.width - 6 });
      if (cell.sub) {
        doc.font("Helvetica").fontSize(7.5);
        h += doc.heightOfString(winAnsi(cell.sub), { width: c.width - 6 });
      }
      height = Math.max(height, h);
    });

    if (doc.y + height + ROW_PAD * 2 > PAGE_HEIGHT - MARGIN - 18) {
      doc.addPage();
      drawHeader();
    }

    const top = doc.y;
    let x = MARGIN;
    for (let i = 0; i < columns.length; i++) {
      const c = columns[i]!;
      const cell = row[i];
      if (cell) {
        doc
          .fillColor(cell.color ?? INK)
          .font(cell.bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(9)
          .text(winAnsi(cell.text) || "—", x, top, {
            width: c.width - 6,
            align: c.align ?? "left",
          });
        if (cell.sub) {
          doc
            .fillColor(MUTED)
            .font("Helvetica")
            .fontSize(7.5)
            .text(winAnsi(cell.sub), x, doc.y, { width: c.width - 6, align: c.align ?? "left" });
        }
      }
      x += c.width;
    }
    doc.x = MARGIN;
    doc.y = top + height + ROW_PAD;
    doc
      .strokeColor(RULE)
      .lineWidth(0.25)
      .moveTo(MARGIN, doc.y - ROW_PAD / 2)
      .lineTo(PAGE_WIDTH - MARGIN, doc.y - ROW_PAD / 2)
      .stroke();
  }
}
