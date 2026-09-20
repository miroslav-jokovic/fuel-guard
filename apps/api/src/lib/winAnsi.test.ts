import { describe, it, expect } from "vitest";
import { winAnsi } from "./winAnsi.js";

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
    // Latin Extended-A, one letter past what the encoding holds, and the reason the fold exists.
    expect(winAnsi("Wałęsa")).toBe("Walesa");
    expect(winAnsi("Đorđević")).toBe("Dordevic");
  });

  /**
   * ⚠ **This assertion used to say the opposite, and it was wrong** (AUD-3, 2026-09-19). It read
   * `expect(winAnsi("José Muñoz")).toBe("Jose Munoz")` and it passed, under a `describe` that called
   * an accented surname one of "the two foldings that were wrong" — so the defect was pinned as the
   * fix. `é` is 0xE9 and `ñ` is 0xF1: both are WinAnsi, and there was never anything to fold.
   *
   * What proved it was not a reading of the encoding table but a disagreement between two documents
   * in one qualification file. `packetOverlay.ts` does not call `winAnsi` at all, and on the same
   * render it drew this exact name onto the carrier's page 3 correctly while the summary drew
   * `Jose Munoz-Pena`. The test above still pins the case the fold is FOR; this one pins the case it
   * was reaching too far into.
   */
  it("leaves a name alone when every letter in it is one WinAnsi can hold", () => {
    expect(winAnsi("José Muñoz-Peña")).toBe("José Muñoz-Peña");
    expect(winAnsi("Ángel Gutiérrez")).toBe("Ángel Gutiérrez");
    expect(winAnsi("Françoise Lefèvre")).toBe("Françoise Lefèvre");
    // Mixed: the Spanish letters stay and the Slavic one still folds, in one string.
    expect(winAnsi("Peña Nikolić")).toBe("Peña Nikolic");
  });

  it("still marks something genuinely unrepresentable, rather than dropping it silently", () => {
    expect(winAnsi("中")).toBe("?");
  });

  /**
   * The one control character that must survive (AUD-21, 2026-09-20).
   *
   * ⚠ **`\n` is outside WinAnsi's printable range, so the '?' catch-all ate it**, and pdfkit never
   * saw the break it would have honoured. The 15 U.S.C. 7001(c) consent is composed with sixteen of
   * them and printed sixteen question marks on a document that gets FILED — reading *"You can have
   * these on paper instead?You do not have to do any of this electronically."* The source carries
   * no '?' of its own, so every one a reader saw was corruption.
   */
  it("keeps the line break the consent is composed with", () => {
    expect(winAnsi("You can have these on paper instead\nYou do not have to."))
      .toBe("You can have these on paper instead\nYou do not have to.");
    // The blank line between clauses too — two breaks in a row, which is what separates them.
    expect(winAnsi("one\n\ntwo")).toBe("one\n\ntwo");
  });

  /**
   * ⚠ A carriage return is folded INTO the break rather than onto it. `carrierWording.ts` stores
   * carrier-authored clause text and an HTML textarea submits CRLF by specification, so a `\r` that
   * reached the catch-all would print the '?' this whole fix is about — one per line, next to a
   * break that now works.
   */
  it("folds a carriage return into the break rather than printing it", () => {
    expect(winAnsi("one\r\ntwo")).toBe("one\ntwo");
    expect(winAnsi("one\rtwo")).toBe("one\ntwo");
    expect(winAnsi("one\ttwo")).toBe("one two");
  });

  /**
   * ⚠ **The guard on the widening, and it is the assertion that matters most here.** The fix works
   * by letting one character through a class that exists to keep everything else out; a class
   * widened by one character too many would print a control code into a filed document rather than
   * marking it. Every other control character must still be marked.
   */
  it("marks every OTHER control character, so the break is the only one let through", () => {
    for (const ch of ["\u0000", "\u0007", "\u000b", "\u000c", "\u001b", "\u007f", "\u0085"]) {
      expect(winAnsi(`a${ch}b`), JSON.stringify(ch)).toBe("a?b");
    }
  });
});

/**
 * ⚠ A label and its value are drawn at the SAME y, captured before either. Close enough to the foot
 * of the sheet, pdfkit turned the page under the label and the row's own bookkeeping then advanced
 * the NEW page's cursor to a coordinate on the OLD one — which pushed the next row off the sheet
 * again. What came out was a page carrying one orphaned label and nothing else. Found 2026-09-11 in
 * a rendered application preview ("DOT-regulated", alone, on page 2 of 8); older than that document
 * and shared by every one this module draws.
 */
