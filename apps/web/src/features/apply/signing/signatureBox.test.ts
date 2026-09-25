import { describe, it, expect } from "vitest";
import { PERMISSION_SIGNATURE_BOX } from "@silvicom/shared";
import { signatureBoxOnPage } from "@/features/apply/signing/signatureBox";

const LETTER = [0, 0, 612, 792];

describe("where the Sign here tag goes", () => {
  /**
   * PDF space is bottom-up and the screen is top-down. A box whose top-left is 400pt up a 792pt page
   * is 392pt down it, which is the whole of what this converts, and the flip it got wrong once on the
   * server side (pdfkit flips for you, AF6a) is the flip it must get right here.
   */
  it("turns a PDF-space point into the box's place on the page, top-down", () => {
    const box = signatureBoxOnPage([{ num: 3 }, { name: "XYZ" }, 54, 400, null], LETTER)!;
    expect(box.left).toBeCloseTo((54 / 612) * 100, 6);
    expect(box.top).toBeCloseTo((392 / 792) * 100, 6);
    expect(box.width).toBeCloseTo((PERMISSION_SIGNATURE_BOX.width / 612) * 100, 6);
    expect(box.height).toBeCloseTo((PERMISSION_SIGNATURE_BOX.height / 792) * 100, 6);
  });

  it("measures against the page's own box, not an assumed Letter sheet", () => {
    const box = signatureBoxOnPage([{}, { name: "XYZ" }, 100, 500, null], [50, 100, 550, 700])!;
    expect(box.left).toBeCloseTo(10, 6);
    expect(box.top).toBeCloseTo((200 / 600) * 100, 6);
  });

  it("puts no tag anywhere when there is no usable point", () => {
    expect(signatureBoxOnPage(null, LETTER)).toBeNull();
    expect(signatureBoxOnPage([{}, { name: "Fit" }], LETTER)).toBeNull();
    // A full-length destination of another kind carries numbers too, and they mean something else.
    expect(signatureBoxOnPage([{}, { name: "FitH" }, 54, 400, null], LETTER)).toBeNull();
    expect(signatureBoxOnPage([{}, { name: "XYZ" }, null, 400, null], LETTER)).toBeNull();
    expect(signatureBoxOnPage([{}, { name: "XYZ" }, 54, 400, null], [0, 0, 0, 0])).toBeNull();
  });
});
