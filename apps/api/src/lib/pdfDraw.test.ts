import { inflateSync } from "node:zlib";
import { describe, it, expect } from "vitest";
import { PAGE_HEIGHT, body, field, newDrawing, winAnsi } from "./pdfDraw.js";

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

/**
 * ⚠ A label and its value are drawn at the SAME y, captured before either. Close enough to the foot
 * of the sheet, pdfkit turned the page under the label and the row's own bookkeeping then advanced
 * the NEW page's cursor to a coordinate on the OLD one — which pushed the next row off the sheet
 * again. What came out was a page carrying one orphaned label and nothing else. Found 2026-09-11 in
 * a rendered application preview ("DOT-regulated", alone, on page 2 of 8); older than that document
 * and shared by every one this module draws.
 */
describe("a label and its value, at the foot of a sheet", () => {
  /** Each content stream, decoded to the text a reader would see on that page. */
  function pageTexts(pdf: Buffer): string[] {
    const raw = pdf.toString("latin1");
    const out: string[] = [];
    const re = /stream\r?\n/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(raw)) !== null) {
      const start = match.index + match[0].length;
      const end = raw.indexOf("endstream", start);
      if (end < 0) continue;
      let decoded: string;
      try {
        decoded = inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1");
      } catch {
        continue; // a font subset or the xref, not a page
      }
      const text = (decoded.match(/<[0-9a-fA-F\s]+>|\((?:\\.|[^\\)])*\)/g) ?? [])
        .map((token) =>
          token.startsWith("<")
            ? Buffer.from(token.slice(1, -1).replace(/\s+/g, ""), "hex").toString("latin1")
            : token.slice(1, -1).replace(/\\([()\\])/g, "$1"),
        )
        .join("");
      if (text.length > 0) out.push(text);
    }
    return out;
  }

  it("keeps them together, and leaves no page carrying only the label", async () => {
    const { doc, done } = newDrawing("page break");
    // Fill the sheet to within one row of the bottom, then draw the pair that used to be split.
    while (doc.y < PAGE_HEIGHT - doc.page.margins.bottom - 16) body(doc, "filler");
    field(doc, "DOT-regulated", "Yes");
    doc.end();

    const pages = pageTexts(await done);
    const withLabel = pages.find((t) => t.includes("DOT-regulated"));
    expect(withLabel).toBeDefined();
    expect(withLabel).toContain("Yes");
  });
});
