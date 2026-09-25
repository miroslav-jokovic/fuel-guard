import { describe, it, expect } from "vitest";
import { pdfDrawnLines, pdfText } from "../../../testing/pdfText.js";
import { PERMISSION_SIGNATURE_BOX } from "@silvicom/shared";
import { MARGIN } from "../../../lib/pdfDraw.js";
import { permissionInstrumentPdf, type PermissionInstrumentInput } from "./permissionInstrument.js";

/**
 * One permission as its own PDF (AF6). The route test pins what the applicant is served; this pins
 * the two layout rules no string assertion can see.
 */

const INTENT = "INTENT-SENTENCE-THE-SIGNER-AFFIRMS";
const base = (over: Partial<PermissionInstrumentInput> = {}): PermissionInstrumentInput => ({
  purpose: "previous_employer",
  version: "packet-2026-08-21",
  title: "PAST EMPLOYMENT VERIFICATION",
  body: "Body.",
  intent: INTENT,
  carrier: { name: "Silvicom Inc", address: null },
  signer: { name: "Susan Godfrey", signedAt: "2026-09-24T15:00:00Z", mark: null },
  ...over,
});

describe("the signature block", () => {
  /**
   * ⚠ Found on the first B2 render: previous_employer's block alone on a sheet, under nothing but the
   * band, a page away from "By signing below, I certify…". A signature with nothing above it signs
   * nothing a reader can see.
   *
   * ⚠ **A sweep, not one fixture**, because the defect lives at one boundary: a body that ends just
   * where the intent fits and the block does not. One fixed length either never reaches that edge or
   * reaches it by luck and stops reaching it when a font size moves. Forty bodies from one paragraph
   * to two pages cross it several times.
   */
  it("never leaves the block on a different sheet from the sentence it signs", async () => {
    const para = "A paragraph of the instrument's own text, long enough to wrap across the full measure of the page. ".repeat(3);
    let crossedABreak = false;
    for (let n = 1; n <= 40; n += 1) {
      const lines = await pdfDrawnLines(await permissionInstrumentPdf(base({ body: Array(n).fill(para).join("\n\n") })));
      const intent = lines.find((l) => l.text.startsWith("INTENT-SENTENCE"));
      const caption = lines.find((l) => l.text === "Signature");
      expect(intent, `n=${n}`).toBeDefined();
      expect(caption!.page, `n=${n}: the block's page`).toBe(intent!.page);
      if (intent!.page > 0) crossedABreak = true;
    }
    // Guards the guard: a sweep that never produced a second sheet tested one page.
    expect(crossedABreak).toBe(true);
  });

  /** A long typed name is shrunk onto its rule, never wrapped under it into the caption. */
  it("keeps a long typed name on one line above its caption", async () => {
    const long = "Maximiliana-Alexandrina Konstantinova Vanderbilt-Oyelaran-Szczepanska";
    const lines = await pdfDrawnLines(await permissionInstrumentPdf(base({ signer: { name: long, signedAt: "2026-09-24T15:00:00Z", mark: null } })));
    const caption = lines.find((l) => l.text === "Signature")!;
    const marks = lines.filter((l) => l.page === caption.page && long.startsWith(l.text.trim()) && l.text.trim().length > 3);
    // Two runs of the name: the signature on its rule and the printed name on its own. Neither split.
    expect(marks.map((l) => l.text.trim())).toEqual([long, long]);
    const signature = marks.find((l) => l.y < caption.y)!;
    expect(signature.y).toBeLessThan(caption.y);
    // ⚠ And it ENDS inside the box. Unwrapped is not enough: an unshrunk name stays on one line and
    // runs off the rule into the Date column, which a count of runs cannot see. Measured with the
    // face it is drawn in, at the size the PDF says it was drawn at.
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const face = await (await PDFDocument.create()).embedFont(StandardFonts.HelveticaOblique);
    const right = signature.x + face.widthOfTextAtSize(long, signature.size);
    expect(right).toBeLessThanOrEqual(MARGIN + PERMISSION_SIGNATURE_BOX.width);
  });

  it("leaves the box, the date and the name empty on the copy nobody has signed", async () => {
    const text = await pdfText(await permissionInstrumentPdf(base({ signer: null })));
    expect(text).not.toContain("Susan Godfrey");
    expect(text).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(text).toContain("Signature");
  });

  /** A drawn mark that will not decode costs the picture, never the document: the name is drawn. */
  it("draws the typed name when the drawn mark is not an image", async () => {
    const text = await pdfText(await permissionInstrumentPdf(base({
      signer: { name: "Susan Godfrey", signedAt: "2026-09-24T15:00:00Z", mark: Buffer.from("not a png") },
    })));
    expect(text.split("Susan Godfrey").length - 1).toBe(2);
  });
});
