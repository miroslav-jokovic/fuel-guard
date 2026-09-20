import { describe, it, expect } from "vitest";
import { pdfDrawnLines, pdfPageTexts } from "../testing/pdfText.js";
import {
  PAGE_HEIGHT, body, caption, field, heading, muted, newDrawing, section,
} from "./pdfDraw.js";

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

  /**
   * ── THE CLOSING NOTE TRAVELS WITH THE SECTION THAT CARRIES IT (AUD-20, 2026-09-20) ──────────
   *
   * ⚠ **What this replaces was two calls in the flow, bound to nothing.** The certificate ended with
   * `rule(); muted(sentence)` after its last section, so where that sentence landed was whatever the
   * cursor happened to be. Measured on the permissions PDF at three instruments and a real
   * 130-character user agent: **page 7 of 7 carried the three words `to its source.` and nothing
   * else** — not the note on its own sheet, which is how the finding was first written down, but the
   * WRAP of the note, split mid-clause across the boundary.
   *
   * ⚠ **It SEARCHES for the hardest cursor position instead of guessing one.** A single `fillTo` is
   * a fixture tuned to today's constants; a coarse sweep is barely better, and a measured mutant
   * proved it — **the rule's air measured at 8.5pt instead of the 9.5 bold `field()` leaves behind
   * shortens the reservation by about 0.92pt and a 4pt sweep steps clean over the window**, so that
   * mutant survived. Worse, `fillTo` advances in whole `body()` lines of ~10.9pt, so a sweep of the
   * REQUESTED room only ever lands the cursor on about seventeen distinct heights.
   *
   * So the cursor is set directly and the boundary is bisected: the largest y at which the section
   * still draws on the sheet in progress is the position where a reservation that is short strands
   * the note's last line. Fourteen renders find it to a twentieth of a point, from the geometry
   * rather than from a number written down here — the difference between a test that holds and a
   * test that held once.
   *
   * ⚠ **What it is sensitive to, stated rather than assumed.** At the boundary the content ends at
   * y717.92 against a floor of 720, so the reservation over-shoots the true drawn height by
   * **2.08pt** — and that is the test's threshold. A mutant that shortens the reservation by 0.92pt
   * (measuring the rule's air at 8.5 rather than the 9.5 bold `field()` leaves) moves the boundary
   * 4.1pt and IS caught; mutants of −1pt and −0.1pt are not, and **they are not defects**: the room
   * kept is still enough for what is drawn. Over-shooting is what `partHeight()`'s header asks for.
   * A test that failed on those would be pinning the estimate's arithmetic instead of the promise.
   *
   * ⚠ The assertion is on the note's FIRST and LAST fragments, not on the whole sentence: a
   * paragraph that wraps is several runs, and `pdfPageTexts` concatenates them. The tail is what the
   * defect strands, so the tail is what has to be found on the heading's own sheet.
   */
  it("never parts a closing note from its section, at any height on the sheet", async () => {
    const OPENING = "Each act above is stored with the exact text";
    const TAIL = "to its source.";
    const COLOPHON =
      `${OPENING} that was shown at the time, not a reference to wording that may since have `
      + "changed. The identifier in the footer of every page is the digest of the certified answers "
      + `this document was drawn from, so a page can be matched ${TAIL}`;

    /** Draw the section with its note, starting the cursor at `y`, and read back the sheets. */
    const at = async (y: number): Promise<string[]> => {
      const { doc, done } = newDrawing(`colophon from y${y}`);
      doc.y = y;
      section(doc, "6. Certified the application", ROWS, { colophon: COLOPHON });
      doc.end();
      return pdfPageTexts(await done);
    };
    const heldItsSheet = (pages: string[]): boolean =>
      pages[0]!.includes("6. Certified the application");

    const check = (pages: string[], where: string): void => {
      const sheet = pages.findIndex((t) => t.includes("6. Certified the application"));
      expect(sheet, `${where}: the section is on the document`).toBeGreaterThanOrEqual(0);
      expect(pages[sheet], `${where}: the note opens on its section's sheet`).toContain(OPENING);
      expect(pages[sheet], `${where}: and ENDS on it`).toContain(TAIL);
      // ⚠ And no other sheet carries any of it — the split leaves a fragment behind, and a test that
      // only looked at the section's own page would call that page correct and miss the stray.
      const strays = pages
        .map((text, i) => ({ text, i }))
        .filter(({ text, i }) => i !== sheet && (text.includes(TAIL) || text.includes(OPENING)));
      expect(strays.map((s) => s.i), `${where}: no sheet carries a fragment of the note`).toEqual([]);
    };

    // The easy heights first — high on the sheet, and low enough that the page must turn.
    for (const y of [54, 200, 400, 600, 700]) check(await at(y), `y${y}`);

    // ⚠ Then the boundary itself. `lo` holds the section on the sheet in progress, `hi` does not;
    // the assertions run at the last y that still does, which is where a short reservation shows.
    let lo = 54;
    let hi = 720;
    expect(heldItsSheet(await at(lo)), "the search starts from a height that holds").toBe(true);
    expect(heldItsSheet(await at(hi)), "...and ends at one that cannot").toBe(false);
    while (hi - lo > 0.05) {
      const mid = (lo + hi) / 2;
      if (heldItsSheet(await at(mid))) lo = mid;
      else hi = mid;
    }
    check(await at(lo), `the last height that holds (y${lo.toFixed(2)})`);
  });
});

/**
 * A metadata line and the block it introduces (AUD-8, 2026-09-20).
 *
 * ── ⚠ WHY NOT ONE OF THESE ASSERTS A STRING ───────────────────────────────────────────────────
 * The defect was `Version v0-draft · method esign` printing in the certificate's LABEL column,
 * 6.96pt under its heading and 1.96pt above `Signed as` — so it read as a table row whose value had
 * gone missing, which is the one thing on that page a reader must not conclude. Every character of
 * it is in the content stream at either spacing, so `pdfPageTexts` is green on the defect and on
 * the fix alike. Five findings in a row have had exactly this shape. What discriminates is where
 * the renderer put the baseline, which is what `pdfDrawnLines` reads back out of the drawn page.
 */
describe("a caption and the block it introduces", () => {
  const ROWS = [
    { note: "Version v1 · method esign" },
    { label: "Signed as", value: "Susan Godfrey" },
    { label: "Signed", value: "2026-08-21 17:54:00 UTC" },
    { label: "From address", value: "203.0.113.9" },
  ];

  /**
   * ⚠ The two relationships, and neither survives alone. "Nearer the heading" without the second
   * is satisfied by a caption sitting one hair closer, which still reads as a row; "clear of the
   * rows" without the first is satisfied by one floating in the middle of the page, attached to
   * nothing. Both are read off the same render.
   */
  it("sits nearer the heading it qualifies than the rows it introduces", async () => {
    const { doc, done } = newDrawing("a captioned section");
    section(doc, "2. Consumer report disclosure and authorization", ROWS);
    doc.end();

    const lines = await pdfDrawnLines(await done);
    // ⚠ Exact text, never `includes`: `Signed as` and `Signed` are both labels on this section and
    // a substring match hands back the first, which made the row pitch measure zero.
    const at = (text: string): number => {
      const line = lines.find((l) => l.text === text);
      expect(line, text).toBeDefined();
      return line!.y;
    };
    const headingToCaption = at("Version v1 \u00b7 method esign") - at("2. Consumer report disclosure and authorization");
    const captionToFirstRow = at("Signed as") - at("Version v1 \u00b7 method esign");
    // The whole finding, in one comparison: it used to be 15.34 down from the heading and 10.18
    // above the rows, and a caption that is nearer the thing under it is a label for that thing.
    expect(captionToFirstRow).toBeGreaterThan(headingToCaption);

    // ⚠ And it may not merely be a slightly roomier ROW. The rows step 14pt; a caption that stepped
    // 14pt too would clear the comparison above and still read as one of them.
    const rowPitch = at("From address") - at("Signed");
    expect(rowPitch).toBeGreaterThan(0);
    expect(captionToFirstRow).toBeGreaterThan(rowPitch);
  });

  /**
   * ⚠ **The trailing air has to be MEASURED as well as drawn, and this is the term that proves it.**
   * `partHeight` predicts a section's height to decide the page break (AUD-4). The note branch used
   * to return the glyphs alone, which is right for `muted()` and ~8pt short for `caption()` — so a
   * section measured as fitting would draw its last row over the boundary and strand it, which is
   * AUD-4 reopened by arithmetic. The room left below is between the two answers on purpose: this
   * section fits under the honest measurement and does not under the short one.
   */
  it("counts a caption's trailing air toward the section's height", async () => {
    const { doc, done } = newDrawing("a caption at the foot of a sheet");
    // Five captioned notes, so the ~8pt each one adds compounds past any single row's slack.
    const withNotes = [
      { note: "Version v1 · method esign" },
      { label: "Signed as", value: "Susan Godfrey" },
      { note: "Countersigned under 49 CFR §391.23(a)(2)" },
      { label: "Signed", value: "2026-08-21 17:54:00 UTC" },
      { note: "Received at the carrier's own server, not the signer's device" },
      { label: "From address", value: "203.0.113.9" },
      { note: "49 CFR §391.21(b)(12)" },
      { label: "Method", value: "esign" },
    ];
    while (doc.y < PAGE_HEIGHT - doc.page.margins.bottom - 148) body(doc, "filler");
    section(doc, "7. An act explained line by line", withNotes);
    doc.end();

    const pages = await pdfPageTexts(await done);
    const withHeading = pages.filter((t) => t.includes("7. An act explained line by line"));
    expect(withHeading).toHaveLength(1);
    for (const part of withNotes) {
      if ("note" in part) expect(withHeading[0], part.note).toContain(part.note);
      else expect(withHeading[0], part.label).toContain(part.value);
    }
    const strays = pages.filter((t) => !t.includes("7. An act") && /From address|Method/.test(t));
    expect(strays).toEqual([]);
  });

  /**
   * ⚠ `muted()` keeps its own shape, and that is the deliberate half of this change. The DQ binder
   * draws fourteen muted lines that are closing sentences, eyebrows and footnotes — things with
   * nothing under them — and folding the caption's air into the shared primitive would have moved
   * all of them on no evidence. So the two differ by exactly one relationship, and this says so.
   */
  it("leaves a caption clear of what follows where a muted line does not", async () => {
    /**
     * ⚠ **A WRAPPED line is the ruler, and the first version of this test had none — it compared
     * the two helpers to each other and a mutant that gave `muted()` the caption's air survived,
     * because `caption()` then had twice as much and was still the greater of the two.** Two
     * helpers compared only to one another cannot say what either of them should be. A muted line
     * long enough to wrap carries pdfkit's own 8.5pt leading BETWEEN its own lines, which no
     * `moveDown` touches — so the step from its last line to whatever follows is measurable against
     * a step that came from the renderer rather than from this file.
     */
    const WRAPS = `${"padding ".repeat(60)}MUTED-RULER-END`;
    const { doc, done } = newDrawing("muted beside caption");
    heading(doc, "A heading");
    muted(doc, WRAPS);
    // ⚠ Both steps measured below land on a line of the SAME size as the one above it, because
    // pdfkit seats a new baseline off the incoming font's ascender — a `body()` follower sits 0.72pt
    // lower for that reason alone, which has nothing to do with leading and would be read as some.
    muted(doc, "PLAIN-FOLLOWER");
    heading(doc, "Another heading");
    caption(doc, "CAPTIONED-METADATA-LINE");
    muted(doc, "CAPTION-FOLLOWER");
    doc.end();

    const lines = await pdfDrawnLines(await done);
    const at = (text: string): number => {
      const line = lines.find((l) => l.text.includes(text));
      expect(line, text).toBeDefined();
      return line!.y;
    };
    // ⚠ The last two lines of that block, by index — a wrapped run is several runs, and asking for
    // the distance between its FIRST and LAST gives however many lines it happened to take.
    const last = lines.findIndex((l) => l.text.includes("MUTED-RULER-END"));
    expect(last).toBeGreaterThan(0);
    const ownLeading = lines[last]!.y - lines[last - 1]!.y;
    expect(ownLeading).toBeGreaterThan(0);

    // `muted()` stops where its text stopped. The DQ binder's fourteen call sites are closing
    // sentences, eyebrows and footnotes that add their own spacing by hand, and they must keep the
    // spacing they have — which is what makes this change safe to make without touching them.
    expect(at("PLAIN-FOLLOWER") - at("MUTED-RULER-END")).toBeCloseTo(ownLeading, 3);

    // A caption does not: it owns the gap between itself and the block it introduces.
    expect(at("CAPTION-FOLLOWER") - at("CAPTIONED-METADATA-LINE")).toBeGreaterThan(ownLeading);
  });
});
