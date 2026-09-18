import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { packetPlacementById } from "@silvicom/shared";
import { MARK_BASELINE_LIFT, PACKET_MARK_LINES, markLineFor } from "./packetMarkGeometry.js";
import { FIELD_BASELINE_LIFT, fieldTableFor } from "./packetFieldGeometry.js";
import type { PacketFieldOverflow, PlacedFieldValue } from "./packetGrid.js";
import { appendContinuationSheet, continuationNoticeFor } from "./packetContinuation.js";
import { PACKET_TEMPLATE_PATH } from "./packetTemplate.js";

/**
 * The driver's marks, drawn onto the carrier's own packet (P5, D-PKT1).
 *
 * ── ⚠ THE CARRIER'S PDF IS THE TEMPLATE; ITS PAGES ARE NEVER REDRAWN ──────────────────────────
 * The approach this replaces reproduced all 31 pages in PDFKit, and it is why the owner was handed a
 * document that "looks nothing like our application". Here the file is LOADED and marks are drawn on
 * top: the letterhead, the tables, the ruled lines, `reisdency`, `signatrure` and every other thing
 * the carrier's lawyers put on the page are theirs, byte for byte, because nothing rewrites them.
 *
 * ── WHERE THE MARKS GO ────────────────────────────────────────────────────────────────────────
 * `packetMarkGeometry.ts`, which is a hand-verified table and says so — each line was chosen by
 * drawing every candidate onto the page and looking at the result, because the packet uses four
 * different layouts for the same act and two of them are indistinguishable by geometry.
 *
 * ── WHAT A MARK IS ────────────────────────────────────────────────────────────────────────────
 * The typed name in an italic face, or the driver's drawn PNG when they gave one (D-PKT13 lets them
 * choose; D-APP8 keeps the typed name as the signature of RECORD either way).
 *
 * ⚠ **`StandardFonts.HelveticaOblique`, not a script webfont.** A standard-14 face costs no embedded
 * bytes, cannot fail to load, and renders identically wherever the PDF is opened — and this document
 * is filed evidence that has to reproduce in ten years. A signature's job on this page is to be
 * legibly the signer's name in the place the form asks for it, which oblique does.
 *
 * ── ⚠ THIS IS THE FILING PATH ─────────────────────────────────────────────────────────────────
 * ⚠ **Wired in, and the note that used to sit here saying it was not is gone because it was false.**
 * `file.ts`'s `renderFiledDocument` calls `renderPacketDocument`, which calls this — so an
 * application with marks files what this function draws. The two things that block had outstanding
 * are both done: the field values are drawn (`fields`, from `packetFieldValues.ts`) and the
 * continuation sheet is appended.
 *
 * ⚠ **What follows from that is a deadline, not a nicety.** `ensureApplicationPdf` renders ONCE,
 * hashes, and returns the stored bytes for ever; evidence tables are append-only. So a change to how
 * this function prints reaches only packets filed after it merges, and every packet filed before it
 * keeps the old appearance permanently. Settle a printing question before the first packet is filed
 * or do not settle it at all — measured 2026-09-18, production held 20 marks from one unfinished
 * walk and no filed packet, which is the only reason A3 was able to fix the drawn mark below.
 *
 * ⚠ **And so is the DATE beside each signature.** Thirteen of the twenty-two stops carry a `Date`
 * line and page 22 carries `Driver name Print`; this file draws the mark and stops, so a packet
 * rendered today comes out signed twenty-two times and dated none. `PACKET_MARK_SIDE_LINES` holds
 * those fourteen coordinates. Each one takes its OWN stop's `signed_at`, never one stamp for all of
 * them — the walk is twenty-two acts and a driver who loses signal finishes tomorrow.
 *
 * ⚠ **The initials defect had TWO halves and only one of them closed in 2026-09-14** (Q-PKT8, then
 * A3). `p05`, `p06` and `p09` are `mark: "initials"`, D-PKT6 calls those a second adopted mark, and
 * until that day the ceremony adopted one and `record_packet_mark` pinned one `signed_name` per link
 * — so a client sending initials was refused at its third stop. Migration 0340 pins per kind and the
 * walk collects both, which fixed the TYPED path: this file draws `signed_name`, which for those
 * three is now the initials.
 *
 * ⚠ **The DRAWN path kept the defect for another four days**, because the branch that stamps the PNG
 * never read the placement's kind — it ran for all twenty-two. That is A3, and the fix is in the mark
 * loop: the drawing goes on signature lines only. The lesson is the one worth keeping — *"nothing
 * here changed"* was true of the typed path and false of the path beside it, and one sentence covered
 * both.
 *
 * ⚠ **Every mark is scaled to fit its line and never overruns it.** The lines are between 90 and 413
 * points wide and a long name at a fixed size would run into the printed text beside it — on page 4
 * that text is the word `Date`, and on page 20 it is the date line itself.
 */

export interface PacketMark {
  /** The placement id from `packetPlacements.ts` — `p03`, `p11a`, `p19b`. */
  placementId: string;
  /** What the driver adopted. The signature of record (D-APP8). */
  signedName: string;
}

export interface PacketOverlayInput {
  marks: readonly PacketMark[];
  /**
   * The applicant's answers, already matched to measured positions by `packetFieldValues.ts`.
   *
   * ⚠ Optional, and empty is a legitimate call: a caller that wants only the marks — the office
   * previewing what the driver has signed so far — asks for only the marks. What is NOT legitimate is
   * FILING one without them, and `renderPacketDocument` is the reason it cannot happen: the filing
   * path goes through it and it always fills them.
   */
  fields?: readonly PlacedFieldValue[];
  /**
   * Answers the carrier's grids had no room for (Q-PKT10).
   *
   * ⚠ Passing them appends a continuation sheet AND draws a notice under each grid that continues.
   * Passing an empty array is "there was no overflow"; NOT passing them at all is "this caller is
   * not filing" — the office previewing the marks. ⚠ `file.ts` must always pass them: §391.21(b)(7)
   * and (b)(8) ask for every accident and conviction in the period, and a filed form missing the
   * fourth is materially false.
   */
  overflow?: readonly PacketFieldOverflow[];
  /** The applicant, so a continuation sheet separated from the packet can be put back with it. */
  applicantName?: string;
  /**
   * The driver's drawn signature, when they chose to draw one (D-PKT13).
   *
   * ⚠ PNG bytes, and optional forever. A8b's rule holds here too: a mark that will not render must
   * not stand between a driver and a filed application, so a failure to embed falls back to the typed
   * name rather than throwing.
   */
  drawnMark?: Buffer | null;
  /**
   * The words stamped across every sheet, or absent for the FILED document (A2).
   *
   * ⚠ **The filing path never passes this, and that is what keeps A2 off the freeze clock.**
   * `ensureApplicationPdf` renders once and returns those bytes for ever, so a change to how this
   * function prints a FILED packet can only be made before the first one is filed. Adding an option
   * that `renderPacketDocument`'s filing caller does not set changes nothing about what it draws —
   * pinned by "draws no band when the filing path does not ask for one" in `packetOverlay.test.ts`.
   *
   * ⚠ Words rather than a colour, and it is `stamp.ts`'s reasoning carried over to the carrier's
   * paper: D-AVI22 recorded an office reading a red-inked preview as *"the product prints in red"*.
   * A preview whose ink differs from the filing is not previewing the filing, so the answers are
   * drawn in exactly the ink they will be filed in and the sheet says what it is in a sentence.
   */
  band?: string | null;
}

/** How tall a drawn mark is allowed to be, so it sits on the line rather than over the page. */
const DRAWN_MARK_MAX_HEIGHT = 18;
/** The size a typed name starts at, before it is shrunk to fit its line. */
const TYPED_MARK_SIZE = 11;
/** Below this the name is unreadable, so the line's width stops being the binding constraint. */
const TYPED_MARK_MIN_SIZE = 6;
/** Ink, matching the carrier's own black rather than a theme colour. */
const INK = rgb(0.1, 0.1, 0.1);
/** How far below a grid's last rule its continuation notice sits, and how small it is. */
const CONTINUATION_NOTICE_DROP = 9;
const CONTINUATION_NOTICE_SIZE = 6.5;

/**
 * The draft band, across the diagonal of one sheet (A2).
 *
 * ⚠ **pdf-lib, not `stamp.ts`.** The band next door does the same job on the §391.21 summary and
 * cannot be reused: that document is BUILT in pdfkit, where the y axis points down and the rotation
 * is applied to the page transform; this one is the carrier's own file LOADED and drawn on, where y
 * points up and pdf-lib rotates each text run about its own origin. So the angle's sign is opposite
 * and the origin has to be computed rather than centred. Two implementations of one idea is the
 * thing this repo normally refuses — the shared part here is the WORDS and the opacity, and those
 * come from the one caller rather than from a second copy of the rule.
 *
 * ⚠ `opacity` rather than a pale grey, for `stamp.ts`'s measured reason: the band is drawn LAST, over
 * the answers, so it has to be legible as a mark and transparent as ink. 0.12 is where a photocopy
 * still carries it and the smallest field label underneath is still readable.
 */
const BAND_ANGLE = 30;
const BAND_OPACITY = 0.12;
const BAND_MAX_SIZE = 30;
const BAND_MIN_SIZE = 10;
/** `pdfDraw.ts`'s `MUTED` (#666666), as pdf-lib wants it. The band is grey on both documents. */
const BAND_INK = rgb(0.4, 0.4, 0.4);

function drawBand(page: PDFPage, font: PDFFont, band: string): void {
  const { width, height } = page.getSize();
  // Shrink to fit rather than trusting a constant: the band is a sentence, and a longer one at a
  // fixed size runs off the DIAGONAL it is drawn along — silently cropped, because nothing wraps.
  const room = Math.hypot(width, height) - 80;
  let size = BAND_MAX_SIZE;
  while (size > BAND_MIN_SIZE && font.widthOfTextAtSize(band, size) > room) size -= 1;

  const radians = (BAND_ANGLE * Math.PI) / 180;
  const run = font.widthOfTextAtSize(band, size);
  page.drawText(band, {
    // pdf-lib rotates about the text's own origin, so the start is walked back half the run along
    // the angle to put the MIDDLE of the sentence in the middle of the sheet.
    x: width / 2 - (run / 2) * Math.cos(radians),
    y: height / 2 - (run / 2) * Math.sin(radians) - size * 0.35,
    size,
    font,
    color: BAND_INK,
    opacity: BAND_OPACITY,
    rotate: degrees(BAND_ANGLE),
  });
}

/** The largest size at or below `TYPED_MARK_SIZE` whose text fits the line, floored so it stays readable. */
function fittedSize(font: PDFFont, text: string, width: number): number {
  for (let size = TYPED_MARK_SIZE; size > TYPED_MARK_MIN_SIZE; size -= 0.5) {
    if (font.widthOfTextAtSize(text, size) <= width) return size;
  }
  return TYPED_MARK_MIN_SIZE;
}

/**
 * Draw the marks onto the carrier's packet and return the whole 31-page document.
 *
 * ⚠ **Unknown placement ids are skipped, not thrown on.** `application_packet_marks` is append-only
 * and holds rows filed under whatever the inventory said at the time — p24 was in it until
 * 2026-08-23 — so a historical row naming a place the table no longer carries must still produce a
 * document. §390.32(d) asks that a filed record stay reproducible; a renderer that throws on an old
 * row is a qualification file that cannot be produced.
 */
export async function renderPacketOverlay(input: PacketOverlayInput): Promise<Buffer> {
  const doc = await PDFDocument.load(await readFile(PACKET_TEMPLATE_PATH), { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaOblique);
  /**
   * ⚠ **Upright, not the signature's oblique.** A mark is a person's hand and reads as one; an
   * ANSWER is a fact somebody typed into a form. Drawing a date of birth in italic would make every
   * filled field look like a signature, on a document whose whole point is that the signatures are
   * distinguishable from everything else on it.
   */
  const fieldFont = await doc.embedFont(StandardFonts.Helvetica);

  let drawn: PDFImage | null = null;
  if (input.drawnMark) {
    try {
      drawn = await doc.embedPng(input.drawnMark);
    } catch {
      // Decoration that failed to decode. The typed name below is the signature of record (D-APP8).
      drawn = null;
    }
  }

  /**
   * ⚠ Values first, marks second, so that if a coordinate is ever wrong enough for the two to
   * collide the SIGNATURE is the one on top. A date drawn over a signature is a document whose
   * signature is obscured; a signature drawn over a date is a legible signature and a smudged date.
   */
  for (const field of input.fields ?? []) {
    const text = field.text.trim();
    if (!text) continue;
    const page = doc.getPage(field.line.page - 1);
    const width = field.line.x2 - field.line.x1;
    page.drawText(text, {
      x: field.line.x1 + 2,
      y: field.line.y + FIELD_BASELINE_LIFT,
      size: fittedSize(fieldFont, text, width - 4),
      font: fieldFont,
      color: INK,
    });
  }

  for (const mark of input.marks) {
    const line = markLineFor(mark.placementId);
    if (!line) continue;
    const page = doc.getPage(line.page - 1);
    const width = line.x2 - line.x1;
    const baseline = line.y + MARK_BASELINE_LIFT;

    /**
     * ⚠ **A drawing is a SIGNATURE, and `p05`, `p06` and `p09` do not ask for one** (A3, D-PKT6).
     *
     * Until this line existed the `if (drawn)` branch below ran for every placement, so a driver who
     * chose to draw got their signature stamped on the three initials lines as well — 141pt of
     * somebody's full autograph in a box the carrier captioned `Initials`, on a document the driver
     * had been told would carry their typed initials there. D-PKT6 is explicit that initials are *"a
     * SECOND adopted mark and not an abbreviation of the first"*; the ceremony collects them
     * separately and types them for exactly that reason, and this renderer was throwing that away at
     * the last step. Q-PKT8 closed the same defect on the typed path in 2026-09-14 and this drawn one
     * survived it, because nothing on the drawn branch ever read the placement's kind.
     *
     * ⚠ **The kind comes from `PACKET_PLACEMENTS`, never from the id's spelling or the page number.**
     * It is the inventory of somebody else's paper — the same table the ceremony reads to decide
     * which mark to collect — so the paper, the screen and the print agree by construction rather
     * than by three people remembering the same three page numbers. `packetMarkGeometry.ts` carries
     * no kind at all and must not gain one.
     *
     * ⚠ **An id the inventory does not carry falls back to the TYPED name**, which is the safe
     * direction: a typed signature is still the signature of record (D-APP8), whereas a drawing on an
     * initials line is this defect. Today the case is unreachable — every geometry id has a
     * placement, pinned by "carries exactly the driver's twenty-two places, and nothing else"
     * — but a filed packet is frozen for ever, so the branch that runs when the two tables disagree
     * has to be the one that cannot produce a wrong mark.
     */
    const takesDrawing = packetPlacementById(mark.placementId)?.mark === "signature";

    if (drawn && takesDrawing) {
      const scale = Math.min(
        DRAWN_MARK_MAX_HEIGHT / drawn.height,
        // ⚠ 0.9 of the line, so a drawn mark has the same air around it the typed one gets.
        (width * 0.9) / drawn.width,
      );
      page.drawImage(drawn, {
        x: line.x1 + 2,
        y: baseline,
        width: drawn.width * scale,
        height: drawn.height * scale,
      });
      continue;
    }

    const name = mark.signedName.trim();
    if (!name) continue;
    page.drawText(name, {
      x: line.x1 + 2,
      y: baseline,
      size: fittedSize(font, name, width - 4),
      font,
      color: INK,
    });
  }

  /**
   * ⚠ **The notice goes on the carrier's page, under the grid it belongs to.** A conviction grid
   * showing three rows with a fourth on an unreferenced sheet at the back is a page that misleads
   * anybody who stops reading there — the attachment becomes a place the answer was hidden rather
   * than a place it was continued.
   */
  for (const over of input.overflow ?? []) {
    const table = fieldTableFor(over.tableId);
    if (!table) continue;
    const lastRow = table.rows[table.rows.length - 1];
    if (lastRow === undefined) continue;
    const page = doc.getPage(table.page - 1);
    page.drawText(continuationNoticeFor(over), {
      x: table.columns[0]! + 2,
      // ⚠ BELOW the grid's last rule, not in its last row — that row may hold an answer.
      y: lastRow - CONTINUATION_NOTICE_DROP,
      size: CONTINUATION_NOTICE_SIZE,
      font: fieldFont,
      color: INK,
    });
  }

  if ((input.overflow ?? []).length > 0) {
    await appendContinuationSheet(doc, {
      overflow: input.overflow ?? [],
      applicantName: input.applicantName ?? "",
    });
  }

  /**
   * ⚠ **Last, and over EVERY sheet including the continuation one.** Last because a band drawn
   * before the answers would sit under them and read as part of the carrier's form rather than as a
   * stamp on it. Every sheet because `stamp.ts` already paid for the alternative: a preview gets
   * printed, photocopied and posted, and the sheet that ends up in somebody's hands has to carry its
   * own status. A 31-page draft banded only on page 1 is thirty unmarked pages.
   */
  if (input.band) {
    const bandFont = await doc.embedFont(StandardFonts.HelveticaBold);
    for (const page of doc.getPages()) drawBand(page, bandFont, input.band);
  }

  return Buffer.from(await doc.save());
}

/** Every place this renderer knows how to draw — the table's ids, for a caller that wants to check. */
export const overlayKnowsPlacements = (): string[] => PACKET_MARK_LINES.map((l) => l.id);
