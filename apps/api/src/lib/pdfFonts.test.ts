import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import PDFKit from "pdfkit";
import { UNICODE_DEFAULT_FONT, canDraw, embedPdfFace, pdfUnicodeText, pdfkitText, useUnicodeFonts } from "./pdfFonts.js";
import { newDrawing } from "./pdfDraw.js";
import { pdfDrawnLines, pdfText } from "../testing/pdfText.js";

/**
 * Q-AF2: the embedded face, and the rule for what it keeps.
 *
 * ⚠ The names are the ones MEASURED to break the filing on 2026-09-25 — Petrović, Jokić, Živković
 * (`ć`) and Szczepańska (`ń`) — plus `ł ș ő` from the plan's list, so a regression is named by the
 * person it would have failed.
 */
const NAMES = ["Marko Petrović", "Đorđe Jokić", "Miloš Živković", "Anna Szczepańska", "Łukasz Wałęsa", "Ștefan Győri"];

describe("what the face can draw", () => {
  it("keeps every letter of every name that used to break the filing", () => {
    for (const name of NAMES) expect(pdfUnicodeText(name)).toBe(name);
  });

  it("still folds what no face can draw, as winAnsi always has — never a hole in a name", () => {
    expect(canDraw("漢")).toBe(false);
    expect(pdfUnicodeText("Li 漢")).toBe("Li ?");
    // Latin Extended-B is mostly absent from Liberation (measured: 197 of 208), so `ǆ` degrades.
    expect(canDraw("ǆ")).toBe(false);
  });

  it("keeps winAnsi's whitespace rules, so changing the font changes no line break", () => {
    expect(pdfUnicodeText("a\r\nb\tc")).toBe("a\nb c");
  });
});

describe("the packet's renderer (pdf-lib)", () => {
  it("embeds a face that measures exactly as Helvetica did", async () => {
    const font = await embedPdfFace(await PDFDocument.create(), "regular");
    // Helvetica's AFM advance for `A` is 667/1000; metric compatibility is the whole reason for the
    // choice, because every fit the packet measured stays the same fit.
    expect(font.widthOfTextAtSize("A", 1000)).toBeCloseTo(667, 0);
    expect(font.widthOfTextAtSize("Petrović", 10)).toBeGreaterThan(0);
  });
});

describe("the pdfkit documents", () => {
  it("prints a name as typed in every document newDrawing makes", async () => {
    const { doc, done } = newDrawing("probe");
    doc.font("Helvetica").text(pdfkitText(doc, NAMES.join(" / ")));
    doc.font("Helvetica-Bold").text(pdfkitText(doc, "Jokić"));
    doc.font("Helvetica-Oblique").text(pdfkitText(doc, "Szczepańska"));
    doc.end();
    const text = await pdfText(await done);
    for (const name of NAMES) expect(text).toContain(name);
    expect(text).toContain("Jokić");
    expect(text).toContain("Szczepańska");
  });

  it("folds for a document that never had the face registered, rather than handing it a ć", async () => {
    const { default: PDFKit } = await import("pdfkit");
    const plain = new PDFKit();
    expect(pdfkitText(plain, "Petrović")).toBe("Petrovic");
    const unicode = new PDFKit({ font: (await import("./pdfFonts.js")).UNICODE_DEFAULT_FONT });
    useUnicodeFonts(unicode);
    expect(pdfkitText(unicode, "Petrović")).toBe("Petrović");
  });
});

/**
 * ⚠ **The layout guarantee.** Liberation's widths are Helvetica's, its ascender is not, and pdfkit
 * places a baseline one ascender below the line's top: measured before `HELVETICA_VERTICAL`, every
 * line sat 1.68pt lower and the leading was 0.06pt tighter. This renders one paragraph both ways and
 * requires the SAME baselines and the same end position, so no document this API draws moves a line
 * because its font changed — and a pdfkit upgrade that renames the private field fails here by name.
 */
describe("the page layout", () => {
  const render = async (unicode: boolean) => {
    const doc = unicode ? new PDFKit({ font: UNICODE_DEFAULT_FONT, margin: 50 }) : new PDFKit({ margin: 50 });
    if (unicode) useUnicodeFonts(doc);
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((r) => doc.on("end", () => r(Buffer.concat(chunks))));
    doc.font("Helvetica").fontSize(9).text(
      "A paragraph long enough to wrap across the column several times, so the leading is measured as well as the first baseline.",
      { width: 300 },
    );
    doc.font("Helvetica-Bold").fontSize(9.5).text("A bold line");
    doc.font("Helvetica-Oblique").fontSize(11).text("An oblique line");
    const end = doc.y;
    doc.end();
    return { baselines: (await pdfDrawnLines(await done)).map((l) => l.y), end };
  };

  it("places every line exactly where standard Helvetica did", async () => {
    const [std, uni] = [await render(false), await render(true)];
    expect(uni.baselines).toHaveLength(std.baselines.length);
    uni.baselines.forEach((y, i) => expect(y).toBeCloseTo(std.baselines[i]!, 2));
    expect(uni.end).toBeCloseTo(std.end, 2);
  });
});
