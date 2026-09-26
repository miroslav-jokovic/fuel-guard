import { rgb, type PDFDocument, type PDFEmbeddedPage } from "pdf-lib";

/**
 * The continuation sheet's paper and the carrier's furniture on it — page size, letterhead, footer,
 * and where our page number goes (AUD-6).
 *
 * ⚠ **Split out of `packetContinuation.ts` on 2026-09-26 (APPLICATION-FLOW-V2-PLAN §8.5, C1)**, at the
 * 450-line warning. Everything here is a measurement of the carrier's page 31 and of the paper it is
 * printed on, and none of it depends on what the sheet goes on to say; the constants and their
 * comments moved unchanged. `packetContinuation.ts` re-exports `FURNITURE_SOURCE_PAGE` and
 * `LETTERHEAD_BAND`, which its test reads from there.
 */

/** Letter, matching the carrier's own pages so the sheet prints on the same paper. */
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;

/**
 * The carrier's own letterhead and footer, LIFTED OFF THEIR PAGE rather than redrawn (AUD-6).
 *
 * —— ⚠ WHY THIS COPIES BYTES INSTEAD OF DRAWING TEXT ——————————————————————————
 * Drawing it was tried first and cannot be made faithful. The letterhead is not set in one of the
 * standard fourteen fonts, and the proof is arithmetic rather than an impression: if it were
 * centred Helvetica, `SILVICOM INC` at x270.1 would be 10.67pt, `1301 ARMITAGE AVE` at x256.6 would
 * be 9.94pt and `MELROSE PARK IL 60160` at x247.0 would be 9.71pt. Three sizes for three lines of
 * one letterhead means the metrics are somebody else's. Redrawing it would have put a different
 * typeface at a guessed size on the sheet whose entire job is to look like it belongs to the other
 * thirty-one pages.
 *
 * `embedPage` takes a REGION of a page already in this document and hands back something drawable.
 * The bytes are the carrier's, so the type, the size, the weight and the centring are theirs by
 * construction — there is no second source of truth to drift, and nothing here to re-measure if
 * they ever re-issue the template with a new address.
 *
 * ⚠ **Page 31, and the choice is measured.** The letterhead is identical on all thirty-one pages
 * (one distinct layout, asserted next door), so what picks the source is the CLEAR SPACE under it:
 * page 1 carries a second `FOR DEPARTMENT OF…` line at y680.3 and a band wide enough to hold the
 * letterhead clips through it — rendered, that prints a sliced half-line of somebody else's text
 * under the address. Pages 29, 30 and 31 have 45.1pt of nothing below the letterhead, the most in
 * the packet, and all three carry the footer at its commonest position (85.9 / 70.7, eleven pages).
 * Page 31 of those three, because it is the page these sheets are appended directly after.
 *
 * ⚠ **The footer band stops at x440 so the carrier's OWN page number does not come with it.** Their
 * number is not a separate run — it is padded onto the end of `THIS IS NOT AN EMPLOYMENT
 * APPLICATION` with spaces — so it cannot be dropped by choosing runs, only by clipping. Measured
 * at 300 dpi: `THIS IS NOT AN EMPLOYMENT APPLICATION` ends at x≈395 and the number begins at
 * x≈489.4.
 *
 * ⚠ **The clip is set by the LONGER line, and the first attempt was set by the shorter one and
 * printed `…VERIFICATION PURPOSE O` on the sheet.** The two footer lines are centred independently
 * and are not the same width: `FOR DEPARTMENT OF TRANSPORTATION VERIFICATION PURPOSE ONLY` runs on
 * to x≈461.4, sixty-six points past the line beneath it. Measured on page 31 at 600 dpi, `ONLY`
 * ends at 461.4 and `31` begins at 489.4 — so the gap to miss is 28pt wide and 475 is its middle,
 * not the 97pt one the second line alone suggests.
 */
export interface CarrierFurniture {
  letterhead: PDFEmbeddedPage;
  footer: PDFEmbeddedPage;
}

/** 1-based, as the carrier's own footer numbers it — see `LETTERHEAD_BAND` for why this page. */
export const FURNITURE_SOURCE_PAGE = 31;
export const LETTERHEAD_BAND = { left: 0, bottom: 688, right: PAGE_WIDTH, top: 745 };
export const FOOTER_BAND = { left: 0, bottom: 58, right: 475, top: 94 };

/**
 * Where OUR page number goes, matching the carrier's own.
 *
 * ⚠ The baseline is theirs — 70.7, the second footer line — so the number sits on the same line as
 * `THIS IS NOT AN EMPLOYMENT APPLICATION` exactly as it does on every page before it. `x` and the
 * size were read off a 300 dpi crop of page 12, whose `12` is two digits like every sheet this can
 * produce. ⚠ It is drawn in Helvetica-Bold and the carrier's is not: a numeral is a numeral, and
 * this is the one piece of furniture that CANNOT be copied, because the value has to change.
 */
export const PAGE_NUMBER_X = 489.4;
export const PAGE_NUMBER_BASELINE = 70.7;
export const PAGE_NUMBER_SIZE = 10;
/**
 * ⚠ **Pure black, and it is the only thing on this sheet that is not `INK`.**
 *
 * Everything else we draw here is our own type on our own sheet and takes the packet's near-black.
 * This numeral is different: it is drawn INSIDE the carrier's copied footer band, on the same line
 * as `THIS IS NOT AN EMPLOYMENT APPLICATION`, a few points to its right. Measured on the produced
 * page at 600 dpi, the copied footer's darkest pixel is 0 and `INK` renders at 25 — so at `INK` the
 * number reads as something added to the carrier's footer rather than part of it, which on this
 * sheet is precisely the wrong impression.
 */
export const PAGE_NUMBER_INK = rgb(0, 0, 0);

export const carrierFurniture = async (doc: PDFDocument): Promise<CarrierFurniture> => ({
  letterhead: await doc.embedPage(doc.getPage(FURNITURE_SOURCE_PAGE - 1), LETTERHEAD_BAND),
  footer: await doc.embedPage(doc.getPage(FURNITURE_SOURCE_PAGE - 1), FOOTER_BAND),
});
