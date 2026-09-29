import { describe, it, expect } from "vitest";
import { PERMISSION_SIGNATURE_BOX } from "@silvicom/shared";
import { placeBoxOnPage, signatureBoxOnPage } from "@/features/apply/signing/signatureBox";

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

describe("where a signing place's box is (D-HB12)", () => {
  it("turns a FitR rectangle into its place on the page, top-down, with its own width and height", () => {
    // p18's measured line: 154..412 at y140.9, box from 2pt under the rule to 21pt above it.
    const box = placeBoxOnPage([{ num: 9 }, { name: "FitR" }, 154, 138.9, 412, 161.9], LETTER)!;
    expect(box.left).toBeCloseTo((154 / 612) * 100, 6);
    expect(box.top).toBeCloseTo(((792 - 161.9) / 792) * 100, 6);
    expect(box.width).toBeCloseTo((258 / 612) * 100, 6);
    expect(box.height).toBeCloseTo((23 / 792) * 100, 6);
  });

  it("refuses anything that is not a whole, non-empty FitR", () => {
    expect(placeBoxOnPage([{ num: 9 }, { name: "XYZ" }, 1, 2, 3, 4], LETTER)).toBeNull();
    expect(placeBoxOnPage([{ num: 9 }, { name: "FitR" }, 1, 2, 3], LETTER)).toBeNull();
    expect(placeBoxOnPage([{ num: 9 }, { name: "FitR" }, 10, 20, 5, 30], LETTER)).toBeNull();
    expect(placeBoxOnPage([{ num: 9 }, { name: "FitR" }, 1, null, 3, 4], LETTER)).toBeNull();
    expect(placeBoxOnPage(null, LETTER)).toBeNull();
  });
});
