/**
 * Page flow: how this document decides where a page ends.
 *
 * ── THE BUG THIS MODULE EXISTS TO MAKE IMPOSSIBLE ───────────────────────────────────────────────
 * pdfkit answers a write past the bottom margin by silently STARTING A NEW PAGE and putting that
 * write on it. That is the right behaviour for flowing prose, where `doc.text` is called in sequence
 * and each call continues from the last. It is catastrophic for a drawing helper that positions text
 * at coordinates it computed itself, because the helper keeps incrementing its own `y` — so every
 * subsequent string lands past the margin too, and each one gets a page of its own.
 *
 * Measured on a seven-day report: `rankedBars` walked its list past the foot of page 2 and emitted
 * page 3 containing the single string "Unit 111", page 4 containing "$52", and page 5 containing
 * "1 fill, 107 gal". Three pages, one fragment each, in a document with two pages of content. The
 * `stampFooters` note in `fuelSpendReportDraw` describes the same mechanism biting the footer pass —
 * it was always going to bite anything drawing at absolute coordinates.
 *
 * ── THE TWO HALVES OF THE FIX ───────────────────────────────────────────────────────────────────
 * `withoutAutoBreak` takes pdfkit's implicit pagination away for the duration of a block, so a helper
 * that miscalculates overflows visibly rather than shattering the document. `ensure` is the other
 * half: it turns the break into a DECISION made before the block starts, from the block's measured
 * height rather than from a guessed constant. A block must never rely on the first without the second
 * — together they mean every page break in this document was chosen by a caller that knew what it was
 * about to draw.
 */
import { GEOM } from "./fuelSpendReportTheme.js";

/**
 * How much of its nominal size each INTER-BLOCK gap is drawn at, per document.
 *
 * ── WHY A SECOND PASS EXISTS AT ALL ─────────────────────────────────────────────────────────────
 * A report whose content comes to 2.2 pages prints as three, the last of which is 80% white with two
 * short rankings stranded on it. Nothing is wrong with any single break — every one of them was the
 * right decision given the space left — but the document as a whole reads as padded, and a reader who
 * scrolls to the end of a forwarded PDF and finds a near-empty page concludes it is broken.
 *
 * So the document is composed, measured, and if the last page is a stub, composed AGAIN with every gap
 * BETWEEN blocks reduced. The second attempt is kept only if it actually saves a page; a tighter
 * document that still runs to three is strictly worse than a roomy one, so it is discarded. See
 * `renderFuelSpendReport`.
 *
 * ── WHAT IS AND IS NOT ALLOWED TO SHRINK ────────────────────────────────────────────────────────
 * Only the space BETWEEN blocks. Type sizes, bar heights, table row heights, card geometry and the
 * page margins are untouched, because those are legibility rather than air — a report that squeezed
 * its 9pt figures to fit would be a worse document than one with an odd last page.
 *
 * ── WHY A WEAKMAP AND NOT A MODULE-LEVEL FLAG ───────────────────────────────────────────────────
 * This runs inside Express, where two carriers can be rendering at once. A module-level "tighten"
 * boolean would be read by whichever render happened to be mid-draw, and the bug — one org's report
 * silently composed at another's density — would be invisible in every test that renders one document
 * at a time. Keyed on the document, the setting cannot leak between renders.
 */
const DENSITY = new WeakMap<PDFKit.PDFDocument, number>();

/** 1 is the roomy default. `renderFuelSpendReport` sets the tighter value for the second pass. */
export function setDensity(doc: PDFKit.PDFDocument, factor: number): void {
  DENSITY.set(doc, factor);
}

/**
 * The smallest gap the tight pass may squeeze to.
 *
 * Without a floor, a low enough density closes the space between a paragraph and the heading under it
 * to nothing and the two read as one block. Two points is still visibly a gap at print size, and it
 * bounds how much the second pass can ever win — which is the point: a document that only fits because
 * its blocks are touching has not been fixed.
 */
const MIN_GAP = 2;

/** A gap between blocks, at this document's density. Never used for anything inside a block. */
export function gap(doc: PDFKit.PDFDocument, points: number): number {
  if (points <= 0) return 0;
  return Math.max(MIN_GAP, points * (DENSITY.get(doc) ?? 1));
}

/** Points of drawable space left on the current page, above the footer rule. */
export function spaceLeft(doc: PDFKit.PDFDocument): number {
  return GEOM.contentBottom - doc.y;
}

/**
 * Start a new page unless `height` points remain.
 *
 * Callers pass a MEASURED height — `rankedBarsHeight(rows)`, not 130. The old `keepTogether(doc, 130)`
 * guessed, and a guess is wrong in both directions: too small and the block still overflows, too large
 * and a section jumps to a fresh page with two thirds of the previous one left blank. Both were
 * happening.
 */
export function ensure(doc: PDFKit.PDFDocument, height: number): void {
  if (doc.y + height > GEOM.contentBottom) doc.addPage();
}

/**
 * Run `fn` with pdfkit's implicit pagination disabled.
 *
 * Wrap any block that positions text at coordinates it worked out itself. Inside, a write past the
 * bottom margin draws where it was told instead of conjuring a page; paired with `ensure` above, that
 * case does not arise, and if it ever does it is visible on the page rather than hidden across three
 * of them.
 *
 * The margin is restored in a `finally` so a throw mid-block cannot leave the document in a state
 * where nothing paginates at all.
 */
export function withoutAutoBreak<T>(doc: PDFKit.PDFDocument, fn: () => T): T {
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  try {
    return fn();
  } finally {
    doc.page.margins.bottom = bottom;
  }
}
