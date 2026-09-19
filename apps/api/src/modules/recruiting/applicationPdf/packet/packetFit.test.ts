import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fitText } from "./packetFit.js";

/**
 * AUD-1: a value that will not fit its column is CUT, never drawn across the one beside it.
 *
 * ── ⚠ WHY THIS IS THE FILE'S FIRST GEOMETRIC ASSERTION, AND WHY IT HAD TO BE ──────────────────
 * Until 2026-09-19 `fittedSize` walked 11pt down to a floor of 6 and returned the floor whether or
 * not the text fitted at it; `page.drawText` neither wraps nor clips, so the full string was drawn
 * anyway — through the rule, over the next column's value, and off the paper. The carrier's page 12
 * rendered company, address and position on top of each other, an unreadable row on the §391.23
 * verification log.
 *
 * **Every test in this file passed throughout.** Both runs are in the content stream either way, so
 * `pageText` finds every word of both and every assertion about text is true of a page no human can
 * read. That is the lesson worth more than the fix: a text reader cannot see a collision, and the
 * property that catches one is about WIDTH.
 */
describe("a value too long for its column", () => {
  const SPAN = 60;

  it("is never returned wider than the span it was given", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const cases = [
      "Rear-ended while stopped at a construction flagger on I-80 westbound near mile 118",
      // ⚠ One word, unbreakable by spaces, wider than the span at the floor size. The word-first
      // path cannot place it and has to fall through to a character cut; without that fallback this
      // returns the whole surname and the guarantee is false for exactly the applicants it matters
      // most for.
      "Featherstonehaugh-Villanuevallanuevallanuevallanuevallanueva",
      "IL",
      "",
    ];
    for (const text of cases) {
      const fit = fitText(font, text, SPAN, 11, 6);
      expect(font.widthOfTextAtSize(fit.text, fit.size)).toBeLessThanOrEqual(SPAN);
    }
  });

  it("says it was cut, and is left alone when it fits", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const long = fitText(font, "Rear-ended while stopped at a construction flagger", SPAN, 11, 6);
    expect(long.cut).toBe(true);
    expect(long.text.endsWith("…")).toBe(true);

    // ⚠ The discriminating half. A helper that cut everything would pass the width assertion above
    // and would put an ellipsis on `IL`, so the filed form would announce a truncation that never
    // happened on a two-letter answer.
    const short = fitText(font, "IL", SPAN, 11, 6);
    expect(short.cut).toBe(false);
    expect(short.text).toBe("IL");
    expect(short.size).toBe(11);
  });

  it("shrinks before it cuts, rather than cutting at full size", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // Fits at 7pt and not at 11pt: the answer is a smaller whole string, not a clipped large one.
    const width = font.widthOfTextAtSize("Straight-truck driver", 7) + 1;
    const fit = fitText(font, "Straight-truck driver", width, 11, 6);
    expect(fit.cut).toBe(false);
    expect(fit.size).toBeLessThan(11);
    expect(fit.text).toBe("Straight-truck driver");
  });
});
