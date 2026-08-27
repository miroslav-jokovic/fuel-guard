import { describe, it, expect } from "vitest";
import { winAnsi } from "./pdfDraw.js";

/**
 * `winAnsi` is the last thing every drawn string passes through, so what it cannot represent shows up
 * on a legal document. These pin the two foldings that were wrong: generated copy full of typographic
 * punctuation, and a driver's accented surname.
 */
describe("winAnsi", () => {
  it("folds a minus sign rather than printing it as a question mark", () => {
    // Real: the spend report's own delta line, which read "?88.1% vs prior".
    expect(winAnsi("−88.1% vs prior")).toBe("-88.1% vs prior");
    expect(winAnsi("2026-08-17 — 2026-08-23")).toBe("2026-08-17 - 2026-08-23");
  });

  /**
   * The arrow is not decorative punctuation somebody typed — `operatingBridge` BUILDS its withheld
   * messages with it, so it reaches a forwarded PDF on the one line the reader most needs to trust.
   * With no rule for U+2192 it fell through to the catch-all and printed "2026-08-17 ? 2026-08-23".
   */
  it("folds the arrow that generated bridge copy puts between two dates", () => {
    expect(winAnsi("Fleet MPG of 12.7 for 2026-08-17 → 2026-08-23 is outside what a tractor can do"))
      .toBe("Fleet MPG of 12.7 for 2026-08-17 - 2026-08-23 is outside what a tractor can do");
    expect(winAnsi("← saved")).toBe("- saved");
  });

  it("folds curly quotes and ellipses", () => {
    expect(winAnsi("the carrier’s report…")).toBe("the carrier's report...");
    expect(winAnsi("“Off-network”")).toBe('"Off-network"');
  });

  it("drops a diacritic instead of leaving a stray question mark beside the letter", () => {
    expect(winAnsi("Nikolić")).toBe("Nikolic");
    expect(winAnsi("José Muñoz")).toBe("Jose Munoz");
  });

  it("still marks something genuinely unrepresentable, rather than dropping it silently", () => {
    expect(winAnsi("中")).toBe("?");
  });
});
