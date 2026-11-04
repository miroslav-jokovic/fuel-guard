import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { appendCarrierQuestionsSheet } from "./packetCarrierQuestions.js";
import { PAGE_NUMBER_BASELINE, TEXT_BLOCK } from "./packetContinuationFurniture.js";

/**
 * The carrier's-questions sheet's own layout (§15.3): every line inside the carrier's text block, and a
 * question never parted from its answer. Measured from `drawText` itself — `pdfDrawnLines` reads pdfkit's
 * streams, and this sheet is drawn by pdf-lib.
 */
afterEach(() => vi.restoreAllMocks());

/** A stand-in packet: thirty-one blank Letter pages, so the furniture has its page 31 to lift. */
async function packet(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 31; i++) doc.addPage([612, 792]);
  return doc;
}

/**
 * Twenty questions of uneven length, shifted by `shift`. ⚠ Several shifts, never one: where an item ends
 * relative to the page is arithmetic on 11pt lines and 8pt gaps, and one fixture landed exactly clear of
 * the footer under a broken page break — twice — and passed it.
 */
const questions = (shift: number) => Array.from({ length: 20 }, (_, i) => ({
  id: `91000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
  wording: `Q${String(i).padStart(2, "0")} ${"Tell us about the routes and the freight you have hauled most often. ".repeat(4)}`
    .slice(0, 40 + ((i * 37 + shift * 53) % 250)),
  hint: null, kind: "text", choices: null, required: false,
}));

describe("the carrier's own questions sheet", () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7])("keeps every line inside the carrier's text block and every question with its answer (shift %i)", async (shift) => {
    const drawn: Array<{ text: string; y: number; page: PDFPage }> = [];
    const real = PDFPage.prototype.drawText;
    vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text, opts) {
      drawn.push({ text, y: opts?.y ?? 0, page: this });
      return real.call(this, text, opts);
    });
    const doc = await packet();
    const added = await appendCarrierQuestionsSheet(doc, { stamp: questions(shift), answers: {}, applicantName: "Susan Godfrey" });
    expect(added).toBeGreaterThan(1);
    expect(doc.getPageCount()).toBe(31 + added);

    // The page number is the only thing drawn in the footer band.
    const body = drawn.filter((d) => d.y !== PAGE_NUMBER_BASELINE);
    expect(Math.min(...body.map((d) => d.y))).toBeGreaterThanOrEqual(TEXT_BLOCK.bottom);
    for (const page of new Set(body.map((d) => d.page))) {
      const texts = body.filter((d) => d.page === page).map((d) => d.text);
      expect(texts.filter((t) => /^Q\d\d /.test(t)).length).toBe(texts.filter((t) => t === "Not answered.").length);
    }
  });

  it("appends nothing for no stamp or a malformed one", async () => {
    const doc = await packet();
    expect(await appendCarrierQuestionsSheet(doc, { stamp: null, answers: null, applicantName: "x" })).toBe(0);
    expect(await appendCarrierQuestionsSheet(doc, { stamp: [{ id: "broken" }], answers: null, applicantName: "x" })).toBe(0);
    expect(doc.getPageCount()).toBe(31);
  });
});
