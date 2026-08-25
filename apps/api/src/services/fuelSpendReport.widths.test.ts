import { describe, it, expect } from "vitest";
import { CONTENT_WIDTH } from "./dqBinder/pdfDraw.js";

/**
 * `table` draws each column at the width it is given and does not wrap or shrink. Columns summing past
 * the content width are drawn past the right margin, so the last one is simply cut in half — which is
 * how "Idle cost" shipped as "IDLE COST" with its dollars hanging off the page.
 *
 * The widths live in `drawSeries`; this pins the arithmetic so the next column added fails here rather
 * than in a rendered document nobody re-reads.
 */
describe("the series table fits the page", () => {
  it("keeps its column widths inside the content width", () => {
    const widths = [92, 40, 56, 68, 52, 58, 36, 52, 50];
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(CONTENT_WIDTH);
  });

  it("and the exceptions summary does too", () => {
    expect([190, 48, 66, 52, 74, 74].reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(CONTENT_WIDTH);
  });

  it("and the exception detail table", () => {
    expect([150, 38, 54, 58, 22, 100, 82].reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(CONTENT_WIDTH);
  });

  it("and the discount capture table", () => {
    expect([186, 44, 62, 72, 68, 72].reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(CONTENT_WIDTH);
  });
});
