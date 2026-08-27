import { CONTENT_WIDTH, INK, MARGIN, newDrawing, winAnsi } from "../../../lib/pdfDraw.js";
import { letterhead, packetFooter, sectionHeading, type PacketCarrier } from "./packetDraw.js";
import { STATIC_PAGES } from "./packetStatic.js";
import { correct } from "./packetText.js";

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
 * Pages the corrections register is applied to.
 *
 * ⚠ **29 and 30 are absent, and that is the point.** They are the Owner Operator & Leased Driver
 * Agreement — a contract the driver signs on page 31 — and its corruption is not spelling:
 * `shall not he appeasable`, `each party shall appoint one arbitration`, `select a natural
 * arbitrator`, and a severability clause whose middle is missing (`If any one or more of the
 * provisions contained in the Agreement but the Agreement will be enforceable`). Picking the intended
 * words there is drafting, not proofreading. The pages are reproduced exactly as the carrier wrote
 * them and the defects are counsel's to resolve (D-PKT4, plan §3.8).
 *
 * ⚠ **24 was here until 2026-08-23 and is not a page of this pack any more** (Q-PKT5) — it is a
 * post-hire training record with a driver signature on it, and R7 owns it. The set stays a set rather
 * than collapsing to "not the agreement", because the reason 29–30 are excluded is a statement about
 * those two pages and would be lost by an inverted test.
 */
const SPELL_CORRECTED_PAGES = new Set([7, 8]);

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
    const fix = SPELL_CORRECTED_PAGES.has(page.page) ? correct : (s: string): string => s;
    for (const bodyLine of page.body) paragraph(doc, fix(bodyLine));
    // The carrier's own page number, so this pack interleaves with their paper copy.
    packetFooter(doc, page.page);
  });

  doc.end();
  return done;
}

/** The packet pages this pack contains, in order — exported so a test can pin the set. */
export const STATIC_PACK_PAGES = STATIC_PAGES.map((p) => p.page);
