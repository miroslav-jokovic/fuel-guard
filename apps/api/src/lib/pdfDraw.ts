import PDFDocument from "pdfkit";
import { winAnsi } from "./winAnsi.js";

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

/**
 * The house style for the documents this product FILES: the DQ binder, the §391.21 application packet
 * and the roadside defense packet.
 *
 * ── WHY THIS IS NOT THE PRODUCT'S WEB PALETTE, AND SHOULD NOT BECOME IT ──────────────────────────
 * The fuel-spend report draws with the app's own tokens (`fuelSpendReportTheme`), and the obvious
 * conclusion — that these should follow — is wrong. Measured 2026-08-25 as deltaE-OK against the
 * nearest product token: RULE 0.009, DANGER 0.018, MUTED 0.020, WARN 0.025, OK 0.050, INK 0.075.
 * Five of the six are at or below the threshold where anyone could tell them apart on paper. Moving
 * them would be churn on documents that get filed with the FMCSA, for no visible gain.
 *
 * The seventh is NAVY, and it is the only real difference: 0.250 from `--viz-brand`. That gap should
 * STAY. `--viz-brand` is the purple the dashboard uses for its brand series, and a driver
 * qualification binder handed to a DOT auditor should not be purple. These documents are a different
 * genre from an analytical report and are allowed to look like a filing.
 *
 * So: two palettes, on purpose, each suited to its genre — not drift waiting to be tidied up.
 * `defensePacket.ts` used to keep its own copies of NAVY, INK and MUTED, which is what actual drift
 * looks like; it imports these now.
 */
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
 * ⚠ Re-exported, not re-implemented. It moved to its own module when this file hit its line budget
 * (AUD-21); every helper below still folds through it and no caller had to change.
 */
export { winAnsi };


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

/**
 * The air a heading sits in, in multiples of its own line.
 *
 * ⚠ Named because `section()` below has to PREDICT a heading's height before drawing it, and two
 * copies of `0.7` — one that draws and one that measures — would drift the first time somebody
 * loosened the spacing. The measurement reads these.
 */
const HEADING_LEAD_ABOVE = 0.7;
const HEADING_LEAD_BELOW = 0.25;
const HEADING_SIZE = 12;

export function heading(doc: PDFKit.PDFDocument, text: string): void {
  doc
    .moveDown(HEADING_LEAD_ABOVE)
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(HEADING_SIZE)
    .text(winAnsi(text))
    .moveDown(HEADING_LEAD_BELOW);
}

export function body(doc: PDFKit.PDFDocument, text: string, color = INK): void {
  doc
    .fillColor(color)
    .font("Helvetica")
    .fontSize(9.5)
    .text(winAnsi(text), { width: CONTENT_WIDTH });
}

/**
 * Small grey text, with NO leading relationship to whatever comes next — a closing sentence under a
 * rule, an eyebrow over a title, a trailing footnote. ⚠ For a line that INTRODUCES the block under
 * it, use `caption()` below; this one keeps its shape deliberately (AUD-8).
 */
export function muted(doc: PDFKit.PDFDocument, text: string): void {
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(MUTED_SIZE)
    .text(winAnsi(text), { width: CONTENT_WIDTH });
}

/** ⚠ Named because `partHeight()` MEASURES a muted line before it is drawn: one size, not two. */
const MUTED_SIZE = 8.5;

/**
 * The air under a caption, in multiples of its own line.
 *
 * ── ⚠ WHY A CAPTION OWNS ITS OWN TRAILING AIR AND `muted()` DOES NOT (AUD-8, 2026-09-20) ──────
 * `muted()` sets an ink and a size and says nothing about what follows it, so a metadata line drawn
 * with it landed against the next block at whatever leading that block happened to use. Measured on
 * the permissions PDF: the certificate's `Version v0-draft · method esign` sat **6.75pt** under its
 * heading and **1.96pt** above `Signed as` — three times nearer the rows than the heading — at the
 * label column's own left edge, in the labels' own grey. It read as a table row whose value had
 * gone missing. The same two numbers, to the point, on every instrument page's `Version v0-draft`.
 *
 * ⚠ **The binder had already solved it seven times by hand, which is the evidence for the number
 * rather than an argument for it.** `dqBinder/render.ts` writes `muted(); moveDown(…)` at every one
 * of its lede lines and has never had this defect — at 0.8, 0.8, 1.2, 1, 0.6, 0.6 and 0.4. Seven
 * call sites, six values, one relationship: exactly the copied constant this repo's rule says to
 * derive instead. 0.8 is that family's centre and puts ~7.9pt under an 8.5pt line, comfortably more
 * than the 6.96 above it — so the caption binds upward and the block below starts clear of it.
 *
 * ⚠ **`partHeight()` reads this.** A caption that grew taller without the section's keep-together
 * measurement growing with it would strand rows on the next sheet, which is AUD-4 reopened.
 */
const CAPTION_LEAD_BELOW = 0.8;

/**
 * A metadata line that introduces the block under it — a version, a citation, a document's lede.
 *
 * It is `muted()` plus the one thing `muted()` cannot know: that something follows, and that this
 * line belongs to the heading above rather than to the first row below.
 */
export function caption(doc: PDFKit.PDFDocument, text: string): void {
  muted(doc, text);
  doc.moveDown(CAPTION_LEAD_BELOW);
}

/** The vertical step one label/value row takes when its value is a single line. */
const FIELD_ROW = 14;

/**
 * A label/value pair on one line — the shape every cover block on these pages is made of.
 *
 * ── ⚠ THE PAGE BREAK, AND THE BLANK PAGE IT USED TO LEAVE ─────────────────────────────────────
 * Both halves are drawn at the SAME y, captured before either of them. Close enough to the foot of
 * the sheet, pdfkit turns the page under the label — and then `Math.max(doc.y, y + 14)` advanced the
 * NEW page's cursor to a coordinate belonging to the OLD one. Everything after it was pushed off the
 * bottom, pdfkit turned the page again for the next row, and what came out was a sheet carrying one
 * orphaned label and nothing else.
 *
 * Found on 2026-09-11 in a rendered application preview: page 2 of 8 read "DOT-regulated", alone,
 * with its value nowhere. Older than that preview and shared by every document this module draws.
 *
 * So: turn the page BEFORE the row when it will not fit, which keeps a label with its value; and if
 * the value wrapped across a break anyway, keep the cursor pdfkit actually left rather than a
 * position measured on the sheet before it.
 *
 * ── ⚠ AND THE OTHER HALF, WHICH ONLY A RENDERED PAGE SHOWED (B2, 2026-09-18) ──────────────────
 * The cursor was advanced past the VALUE and the label's own height was never asked for — so a label
 * too long for its 130pt column wrapped to two lines and the next row was drawn straight through it.
 * Every document here had short labels ("Employer", "Signed", "Date") until B2 printed
 * `AUTHORIZATION_PURPOSE_LABELS`, whose members run to four words and are the instruments' real
 * names. It presents as the summary block of a document overprinting itself, and **no assertion
 * about text can see it**: every word is on the page, at coordinates nothing checks. Found by
 * rasterising at 110 dpi and looking at it, which is why every step that changes printing does that.
 */
export function field(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  /** ⚠ DANGER only, and only where the WORD already says it — D-AVI22 forbids colour carrying alone. */
  valueColor = INK,
): void {
  if (doc.y + FIELD_ROW > PAGE_HEIGHT - doc.page.margins.bottom) doc.addPage();
  const startPage = doc.page;
  const y = doc.y;
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(9)
    .text(winAnsi(label), MARGIN, y, { width: 130 });
  // Where the LABEL ended, before the value moves the cursor — a row is as tall as its taller half.
  const labelBottom = doc.y;
  doc
    .fillColor(valueColor)
    .font("Helvetica-Bold")
    .fontSize(9.5)
    .text(winAnsi(value), MARGIN + 134, y, { width: CONTENT_WIDTH - 134 });
  doc.x = MARGIN;
  doc.y = doc.page === startPage ? Math.max(doc.y, labelBottom, y + FIELD_ROW) : doc.y;
}

/**
 * One piece of a section: a note under its heading, or a label/value row.
 *
 * ⚠ A union rather than two arrays, because the ORDER matters — the certificate's citation line sits
 * between the heading and the first row, and a shape that could not express that would push the
 * caller back to calling `caption` and `field` by hand, which is the thing `section` exists to stop.
 */
export type SectionPart = { note: string } | { label: string; value: string };

/**
 * How tall this part will be when drawn, without drawing it.
 *
 * ⚠ **It mirrors `field()`'s and `caption()`'s own layout, and it is allowed to be conservative in one
 * direction only.** Over-estimating costs a little white space at the foot of a page;
 * under-estimating strands rows on the next one with nothing naming them, which is the defect this
 * whole mechanism exists to remove (AUD-4). `heightOfString` reads the CURRENT font, so each branch
 * sets the same font and size the drawing call will.
 */
function partHeight(doc: PDFKit.PDFDocument, part: SectionPart): number {
  if ("note" in part) {
    doc.font("Helvetica").fontSize(MUTED_SIZE);
    // ⚠ The trailing air too, not just the glyphs: `section()` draws its notes through `caption()`,
    // which advances the cursor past the line it wrote. A measurement that stopped at the text
    // would under-report every section carrying a note by ~8pt — and under-reporting is the one
    // direction this function is not allowed to be wrong in (AUD-4, and see the note above).
    return doc.heightOfString(winAnsi(part.note), { width: CONTENT_WIDTH })
      + doc.currentLineHeight(true) * CAPTION_LEAD_BELOW;
  }
  doc.font("Helvetica").fontSize(9);
  const label = doc.heightOfString(winAnsi(part.label), { width: 130 });
  doc.font("Helvetica-Bold").fontSize(9.5);
  const value = doc.heightOfString(winAnsi(part.value), { width: CONTENT_WIDTH - 134 });
  // The same three-way max `field()` applies — a row is as tall as its taller half, never shorter
  // than one step.
  return Math.max(label, value, FIELD_ROW);
}

/**
 * A heading and the rows under it, drawn on a page that can hold the whole of it (AUD-4).
 *
 * ── ⚠ WHAT WAS WRONG, AND WHY `field()`'S KEEP-TOGETHER WAS NOT ENOUGH ────────────────────────
 * Measured 2026-09-19 on the permissions PDF p8→p9 and the §391.21 summary p9→p10, at 100 dpi:
 * section 6's heading, its citation line and two of its four rows sat on one page, and
 * `From address` and `Browser` opened the next one with **nothing saying what act they belonged
 * to** — under a heading numbered 7, which is a different instrument. The stranded pair reads as
 * part of the section that follows it.
 *
 * ⚠ **Do not read the old behaviour as "there was no keep-together".** `field()` has had one since
 * 2026-09-11, pinned by *"keeps them together, and leaves no page carrying only the label"*; it
 * holds a LABEL to its VALUE, and it did that correctly here. What had none was the SECTION — the
 * heading and the rows under it — which is the unit a reader needs. The fix is one level up from
 * where the last one went.
 *
 * ── ⚠ AND IT REFUSES TO BREAK FOR A SECTION NO PAGE COULD HOLD ───────────────────────────────
 * A section taller than the text block of an empty page is drawn where it stands. Turning the page
 * for it would buy nothing — it would break across the next boundary anyway — and would leave a
 * blank sheet in a filed §391.51 document to prove it. `field()`'s own keep-together still protects
 * each row inside it. There is no such section today; the branch exists because a browser string is
 * caller-supplied and a filed document must render whatever was stored.
 */
export function section(
  doc: PDFKit.PDFDocument,
  title: string,
  parts: readonly SectionPart[],
): void {
  doc.font("Helvetica-Bold").fontSize(HEADING_SIZE);
  const line = doc.currentLineHeight(true);
  const needed =
    line * (HEADING_LEAD_ABOVE + HEADING_LEAD_BELOW)
    + doc.heightOfString(winAnsi(title), { width: CONTENT_WIDTH })
    + parts.reduce((total, part) => total + partHeight(doc, part), 0);

  const floor = PAGE_HEIGHT - doc.page.margins.bottom;
  const wholePage = floor - doc.page.margins.top;
  if (doc.y + needed > floor && needed <= wholePage) doc.addPage();

  heading(doc, title);
  for (const part of parts) {
    if ("note" in part) caption(doc, part.note);
    else field(doc, part.label, part.value);
  }
}

/** ⚠ The colour is a parameter because a DANGER pair bounds the revocation notice (AUD-9); every
 *  other caller wants the house rule and gets it by saying nothing. */
export function rule(doc: PDFKit.PDFDocument, color = RULE): void {
  doc.moveDown(0.4);
  doc
    .strokeColor(color)
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
