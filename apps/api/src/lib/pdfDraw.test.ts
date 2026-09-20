import { describe, it, expect } from "vitest";
import { pdfPageTexts } from "../testing/pdfText.js";
import { PAGE_HEIGHT, body, field, newDrawing, section, winAnsi } from "./pdfDraw.js";

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
});

/**
 * ⚠ A label and its value are drawn at the SAME y, captured before either. Close enough to the foot
 * of the sheet, pdfkit turned the page under the label and the row's own bookkeeping then advanced
 * the NEW page's cursor to a coordinate on the OLD one — which pushed the next row off the sheet
 * again. What came out was a page carrying one orphaned label and nothing else. Found 2026-09-11 in
 * a rendered application preview ("DOT-regulated", alone, on page 2 of 8); older than that document
 * and shared by every one this module draws.
 */
describe("a label and its value, at the foot of a sheet", () => {
  it("keeps them together, and leaves no page carrying only the label", async () => {
    const { doc, done } = newDrawing("page break");
    // Fill the sheet to within one row of the bottom, then draw the pair that used to be split.
    while (doc.y < PAGE_HEIGHT - doc.page.margins.bottom - 16) body(doc, "filler");
    field(doc, "DOT-regulated", "Yes");
    doc.end();

    const pages = await pdfPageTexts(await done);
    const withLabel = pages.find((t) => t.includes("DOT-regulated"));
    expect(withLabel).toBeDefined();
    expect(withLabel).toContain("Yes");
  });
});

/**
 * A heading and the rows under it, at the foot of a sheet (AUD-4, 2026-09-19).
 *
 * ⚠ **`field()`'s keep-together above is a different guarantee and it was working.** It holds a
 * LABEL to its VALUE. What had none was the SECTION: measured on the permissions PDF p8→p9 and the
 * §391.21 summary p9→p10, an instrument's heading and two of its four rows sat on one sheet while
 * `From address` and `Browser` opened the next — directly beneath a heading numbered for a DIFFERENT
 * instrument, which is what a reader would file them under.
 */
describe("a section, at the foot of a sheet", () => {
  /** A real user agent: 130 characters, which wraps to two lines in the value's 370pt column. */
  const LONG_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
    + "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

  const ROWS = [
    { note: "Version v1 · method esign" },
    { label: "Signed as", value: "Susan Godfrey" },
    { label: "Signed", value: "2026-08-21 17:54:00 UTC" },
    { label: "From address", value: "203.0.113.9" },
    { label: "Browser", value: LONG_UA },
  ];

  /** Fill the current sheet until only `room` points are left below the cursor. */
  const fillTo = (doc: PDFKit.PDFDocument, room: number): void => {
    while (doc.y < PAGE_HEIGHT - doc.page.margins.bottom - room) body(doc, "filler");
  };

  it("carries the whole of it to the next sheet rather than stranding its last rows", async () => {
    const { doc, done } = newDrawing("section break");
    // Room for the heading and about two rows — the shape the defect was measured in.
    fillTo(doc, 60);
    section(doc, "6. Controlled substances and alcohol testing consent", ROWS);
    doc.end();

    const pages = await pdfPageTexts(await done);
    const withHeading = pages.filter((t) => t.includes("6. Controlled substances"));
    expect(withHeading).toHaveLength(1);
    // ⚠ Every row on the heading's own sheet, values included — a label that travelled without its
    // value would satisfy a weaker assertion and is the neighbouring defect.
    for (const part of ROWS) {
      if ("note" in part) expect(withHeading[0]).toContain(part.note);
      else expect(withHeading[0], part.label).toContain(part.value);
    }
    // ⚠ And nothing left behind: no OTHER sheet may carry one of its rows.
    const strays = pages.filter((t) => !t.includes("6. Controlled") && /From address|Browser/.test(t));
    expect(strays).toEqual([]);
  });

  /**
   * ⚠ **The wrap is what decides, and a mutant proved the weaker sum survives without this.** These
   * rows have short labels and values that run to two lines each, so a height taken from the LABEL
   * alone reports the section as four rows tall when it is eight. It then "fits", and the second
   * half is stranded — the AUD-4 defect arrived at by arithmetic instead of by a missing page turn.
   * The room left below is deliberately between the two answers.
   */
  it("counts a value that wraps, not just the row it starts on", async () => {
    const wrapping = [
      { label: "Browser", value: LONG_UA },
      { label: "Referrer", value: LONG_UA },
      { label: "Forwarded", value: LONG_UA },
      { label: "Agent", value: LONG_UA },
    ];
    const { doc, done } = newDrawing("wrapping rows");
    fillTo(doc, 92);
    section(doc, "4. An act whose rows all wrap", wrapping);
    doc.end();

    const pages = await pdfPageTexts(await done);
    const withHeading = pages.filter((t) => t.includes("4. An act whose rows all wrap"));
    expect(withHeading).toHaveLength(1);
    for (const row of wrapping) expect(withHeading[0], row.label).toContain(row.label);
    const strays = pages.filter((t) => !t.includes("4. An act") && /Forwarded|Agent/.test(t));
    expect(strays).toEqual([]);
  });

  /**
   * ⚠ **The note and the LABELS can wrap too, and two more mutants survived without this.** Both
   * terms are right today and unexercised by real content — the certificate's notes are one line
   * and its labels are two words — which is exactly the position `field()` was in before B2 printed
   * `AUTHORIZATION_PURPOSE_LABELS` in the label column and a four-word label wrapped into the row
   * below it. A term that only holds while the content stays short is a term nothing is holding.
   */
  it("counts a wrapping note and wrapping labels toward the section's height", async () => {
    const longLabels = [
      { note: `Version v1 · method esign · ${LONG_UA}` },
      { label: "Previous-employer safety performance release", value: "Yes" },
      { label: "Drug & Alcohol Clearinghouse query consent", value: "Yes" },
      { label: "Consumer report disclosure and authorization", value: "Yes" },
      { label: "Controlled substances and alcohol testing consent", value: "Yes" },
    ];
    const { doc, done } = newDrawing("wrapping note and labels");
    fillTo(doc, 115);
    section(doc, "5. An act with a long note", longLabels);
    doc.end();

    const pages = await pdfPageTexts(await done);
    const withHeading = pages.filter((t) => t.includes("5. An act with a long note"));
    expect(withHeading).toHaveLength(1);
    for (const part of longLabels) {
      if ("note" in part) continue;
      expect(withHeading[0], part.label).toContain(part.label);
    }
    const strays = pages.filter(
      (t) => !t.includes("5. An act") && /Controlled substances|Consumer report/.test(t),
    );
    expect(strays).toEqual([]);
  });

  /**
   * ⚠ **And the NOTE, on its own.** The case above leaves the note's four lines beside four
   * wrapping labels, where either term alone can carry the sum past the boundary — so it cannot
   * tell which one did. This one gives the section short rows and a note that runs to four lines,
   * which makes the note the only thing that decides.
   */
  it("counts a note that runs to several lines toward the section's height", async () => {
    const wordy = [
      { note: `${LONG_UA} ${LONG_UA} ${LONG_UA}` },
      { label: "Signed as", value: "Susan Godfrey" },
      { label: "Signed", value: "2026-08-21 17:54:00 UTC" },
      { label: "From address", value: "203.0.113.9" },
      { label: "Method", value: "esign" },
    ];
    const { doc, done } = newDrawing("a note of several lines");
    fillTo(doc, 100);
    section(doc, "3. An act explained at length", wordy);
    doc.end();

    const pages = await pdfPageTexts(await done);
    const withHeading = pages.filter((t) => t.includes("3. An act explained at length"));
    expect(withHeading).toHaveLength(1);
    for (const label of ["Signed as", "From address", "Method"]) {
      expect(withHeading[0], label).toContain(label);
    }
    const strays = pages.filter((t) => !t.includes("3. An act") && /From address|Method/.test(t));
    expect(strays).toEqual([]);
  });

  it("leaves a section that already fits exactly where it is", async () => {
    const { doc, done } = newDrawing("no gratuitous break");
    body(doc, "opening line");
    section(doc, "1. Agreed to sign electronically", ROWS);
    doc.end();

    const pages = await pdfPageTexts(await done);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("opening line");
  });

  /**
   * ⚠ **A section no sheet could hold is drawn where it stands.** Turning the page for it would buy
   * nothing — it breaks across the next boundary anyway — and would leave a blank sheet inside a
   * filed §391.51 document to prove it. There is no such section today; the branch exists because a
   * browser string is caller-supplied and a filed document must render whatever was stored.
   */
  it("does not turn the page for a section no page could hold", async () => {
    const tall = Array.from({ length: 60 }, (_, i) => ({ label: `Row ${i}`, value: `value ${i}` }));
    const { doc, done } = newDrawing("taller than a page");
    body(doc, "opening line");
    fillTo(doc, 200);
    section(doc, "9. A section with more rows than a sheet has lines", tall);
    doc.end();

    const pages = await pdfPageTexts(await done);
    // The heading stayed on the sheet that was already in progress rather than starting a blank one.
    expect(pages[0]).toContain("9. A section with more rows");
    expect(pages[0]).toContain("opening line");
    expect(pages.every((t) => t.trim().length > 0)).toBe(true);
  });
});
