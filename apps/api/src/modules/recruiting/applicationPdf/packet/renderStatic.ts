import { CONTENT_WIDTH, INK, MARGIN, newDrawing, winAnsi } from "../../../../lib/pdfDraw.js";
import { letterhead, packetFooter, sectionHeading, type PacketCarrier } from "./packetDraw.js";
import { STATIC_PAGES } from "./packetStatic.js";

/**
 * The packet's policy and agreement pages, as one attachable document (P3, D-PKT3).
 *
 * ── WHY THIS IS RENDERED ONCE PER VERSION AND NOT ONCE PER APPLICANT ──────────────────────────
 * Pages 7–8 and 29–30 are identical for everybody. Drawing them into every submission would put
 * five unchanging pages inside every stored document, and — the reason that actually matters — it
 * would make a WORDING CHANGE invisible: two applicants who signed materially different versions of
 * the carrier's Rules and Regulations would have documents that look the same and are not.
 *
 * So the pack carries a `version` and is filed as its own artifact, the way `DISCLOSURES` are
 * versioned. What an applicant's file records is which version they were given.
 *
 * ⚠ **The version is a caller's input, not a hash of this file.** A hash would change when a comment
 * moved; the version must change when the CARRIER'S WORDS change, and only a person can say that.
 */

export interface StaticPackInput {
  carrier: PacketCarrier;
  /** The wording version this pack represents, stored on whatever references it. */
  version: string;
}

/**
 * ⚠ **Nothing is corrected on the way to the page any more (D-PKT11, owner, 2026-09-14).**
 *
 * There was a `SPELL_CORRECTED_PAGES` set here, holding 7 and 8, and a `correct()` applier that
 * repaired `IMPOREPER`, `OVERWIGHT`, `TEAR EXEPTED` and four more as the static pack was drawn.
 * Both are gone. The owner's ruling is that the packet's text is counsel's work product and prints
 * as written, so the pack now draws `page.body` exactly as `packetStatic.ts` parsed it out of the
 * workbook — which is what that file already stored, pristine, for the test to compare against.
 *
 * ⚠ The reason pages 29–30 were excluded from correction is worth keeping even though the exclusion
 * is now universal: the Owner Operator & Leased Driver Agreement's corruption was never spelling.
 * `shall not he appeasable`, `select a natural arbitrator`, and a severability clause whose middle
 * is missing are drafting defects, and they are counsel's to resolve (D-PKT4, plan §3.8). D-PKT11
 * makes every page behave the way those two already did; it does not make their defects any less
 * counsel's problem.
 */

/** A body line, wrapped to the content width. */
function paragraph(doc: PDFKit.PDFDocument, text: string): void {
  doc.fillColor(INK).font("Helvetica").fontSize(9);
  doc.text(winAnsi(text), MARGIN, doc.y, { width: CONTENT_WIDTH, align: "left" });
  doc.x = MARGIN;
  doc.moveDown(0.25);
}

export async function renderStaticPackPdf(input: StaticPackInput): Promise<Buffer> {
  const { doc, done } = newDrawing(`Driver application packet — policies (${input.version})`);

  STATIC_PAGES.forEach((page, i) => {
    if (i > 0) doc.addPage();
    letterhead(doc, input.carrier);
    sectionHeading(doc, page.heading);
    for (const bodyLine of page.body) paragraph(doc, bodyLine);
    // The carrier's own page number, so this pack interleaves with their paper copy.
    packetFooter(doc, page.page);
  });

  doc.end();
  return done;
}

/** The packet pages this pack contains, in order — exported so a test can pin the set. */
export const STATIC_PACK_PAGES = STATIC_PAGES.map((p) => p.page);
