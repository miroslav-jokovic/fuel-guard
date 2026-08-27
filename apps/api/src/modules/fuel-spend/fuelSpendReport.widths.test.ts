import { describe, it, expect } from "vitest";
import { CONTENT_W } from "./fuelSpendReportTheme.js";
import { seriesColumnWidths } from "./fuelSpendReportSections.js";
import { exceptionColumnWidths, overchargeColumnWidths } from "./fuelSpendReportPolicy.js";

/**
 * `figureTable` draws each column at the width it is given and does not wrap or shrink. Columns summing
 * past the content width are drawn past the right margin, so the last one is simply cut in half — which
 * is how "Idle cost" shipped as "IDLE COST" with its dollars hanging off the page.
 *
 * ── WHY THIS TEST NOW IMPORTS THE WIDTHS INSTEAD OF RESTATING THEM ──────────────────────────────
 * It used to hold its own copy of every array — `[92, 40, 56, 68, 52, 58, 36, 52, 50]` written out
 * again here — so it proved that a list of numbers in a test file summed to 504 and said nothing at all
 * about the document. The widths are exported from the modules that draw with them, so a column widened
 * in the section fails here rather than in a rendered PDF nobody re-reads.
 */
describe("every figure table fits the page", () => {
  const sum = (w: readonly number[]) => w.reduce((a, b) => a + b, 0);

  it("keeps the period table inside the content width", () => {
    expect(sum(seriesColumnWidths)).toBeLessThanOrEqual(CONTENT_W);
  });

  it("and the policy-exception summary", () => {
    expect(sum(exceptionColumnWidths)).toBeLessThanOrEqual(CONTENT_W);
  });

  it("and the largest-overcharges table", () => {
    expect(sum(overchargeColumnWidths)).toBeLessThanOrEqual(CONTENT_W);
  });
});
