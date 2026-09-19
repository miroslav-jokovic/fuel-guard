import { describe, it, expect } from "vitest";
import { fitScale, inkBounds, knockOutPaper, padBounds } from "./markRaster";

/**
 * The pure half of turning a mark into the PNG the packet prints (C2, D-HUI14).
 *
 * ⚠ **This is the half a test can reach, and that is why the seam is where it is.** jsdom has no 2D
 * context, so a `renderStyledMark` or a `normaliseUploadedMark` asserted end to end would be asserting
 * that a mock returned what it was told to. What these functions decide — where the ink is, what
 * counts as paper, how much to shrink — is arithmetic over pixels and is checkable exactly.
 *
 * ⚠ **Every fixture here has a PARTIAL case**, deliberately. Six green mutations in this repo have all
 * had one cause: a fixture too uniform to discriminate
 * ([[a-green-mutation-means-the-test-is-at-fault]]). A buffer whose alpha is only ever 0 or 255 cannot
 * tell a threshold from a truthiness test, and a paper fixture that is pure white cannot tell a
 * luminance test from an equality-with-white test — which is the exact bug that would ship an upload
 * path that works on a screenshot and fails on every real photograph.
 */

/** An RGBA buffer, `fill` applied to every pixel, then `paint` given a chance to change some. */
function canvas(
  width: number,
  height: number,
  fill: [number, number, number, number],
  paint?: (set: (x: number, y: number, px: [number, number, number, number]) => void) => void,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  paint?.((x, y, px) => {
    const i = (y * width + x) * 4;
    data[i] = px[0];
    data[i + 1] = px[1];
    data[i + 2] = px[2];
    data[i + 3] = px[3];
  });
  return data;
}

const OPAQUE_INK: [number, number, number, number] = [26, 26, 26, 255];
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

describe("finding the ink on a canvas", () => {
  it("returns the tightest box around everything drawn", () => {
    const data = canvas(10, 10, CLEAR, (set) => {
      set(2, 3, OPAQUE_INK);
      set(7, 6, OPAQUE_INK);
    });
    expect(inkBounds(data, 10, 10)).toEqual({ left: 2, top: 3, right: 7, bottom: 6 });
  });

  /** A canvas with nothing on it is the driver who opened the pad and drew nothing, and the blank sheet
   *  photographed in the Upload tab. Both need an answer that is not a box of size zero at the origin. */
  it("answers null for a canvas with nothing on it", () => {
    expect(inkBounds(canvas(4, 4, CLEAR), 4, 4)).toBeNull();
  });

  /**
   * ⚠ **The partial case.** Antialiasing puts a rim of barely-there alpha around every stroke, and a
   * threshold of zero would call that rim ink — so the trim would keep a halo the width of the
   * antialiasing and every face would arrive on the line at a slightly different size.
   *
   * ⚠ This is also the assertion that makes the fixture discriminating: a mutation replacing the
   * `<= alphaThreshold` guard with `=== 0` still compiles and is caught only here.
   */
  it("ignores alpha too faint to be a stroke, and keeps alpha just above it", () => {
    const faint = canvas(6, 6, CLEAR, (set) => {
      set(1, 1, [26, 26, 26, 4]);
      set(4, 4, [26, 26, 26, 9]);
    });
    expect(inkBounds(faint, 6, 6, 8)).toEqual({ left: 4, top: 4, right: 4, bottom: 4 });
  });
});

describe("padding the box before it is cropped", () => {
  it("grows the box by the pad", () => {
    expect(padBounds({ left: 4, top: 4, right: 6, bottom: 6 }, 2, 20, 20)).toEqual({
      left: 2,
      top: 2,
      right: 8,
      bottom: 8,
    });
  });

  /** ⚠ A signature drawn into the corner of the pad is the normal case on a phone, not an edge one. */
  it("never leaves the canvas", () => {
    expect(padBounds({ left: 0, top: 0, right: 9, bottom: 9 }, 3, 10, 10)).toEqual({
      left: 0,
      top: 0,
      right: 9,
      bottom: 9,
    });
  });
});

describe("taking the paper out of an uploaded signature", () => {
  it("keeps dark ink at full opacity and removes bright paper entirely", () => {
    const data = canvas(2, 1, [250, 250, 248, 255], (set) => set(0, 0, [20, 20, 20, 255]));
    knockOutPaper(data, 2, 1);
    expect(data[3]).toBe(255);
    expect(data[7]).toBe(0);
  });

  /**
   * ⚠ **The partial case, and the one that decides whether this works on a real photograph.** Paper
   * photographed by a phone is a grey-beige gradient, never `#ffffff` — so a mutation replacing the
   * luminance test with an equality against white still compiles, still passes the assertion above
   * (which uses 250,250,248 and would then be KEPT rather than removed)… which is precisely why the
   * assertion above uses an off-white rather than white. This one covers the other side: a mid-grey
   * in the band between the two thresholds must come out PARTLY transparent, not all or nothing.
   */
  it("fades the grey between ink and paper rather than cutting at a threshold", () => {
    const data = canvas(1, 1, [160, 160, 160, 255]);
    knockOutPaper(data, 1, 1, 110, 205);
    expect(data[3]).toBeGreaterThan(0);
    expect(data[3]).toBeLessThan(255);
  });

  /**
   * ⚠ **Weighted luma, not an equal-weight average**, and the weights come from `capture-engine`'s
   * `toLuminance` rather than from a copy here — `lint:scanner-parity` refuses a second definition
   * (D-SCAN8), and it was right to: the copy this replaced said Rec. 601 while the one definition says
   * Rec. **709**. Blue reads far darker to the eye than its value suggests, so an average treats a
   * blue-ish shadow as ink and leaves a bruise around the signature. ⚠ These two colours have the SAME
   * arithmetic mean (140) and very different luma (199 against 132), which is what makes this assertion
   * able to fail — and it fails under either standard, so it pins the SHAPE of the rule rather than one
   * set of coefficients this file must not restate.
   */
  it("weighs the channels the way an eye does, not equally", () => {
    const greenish = canvas(1, 1, [150, 230, 40, 255]);
    const blueish = canvas(1, 1, [40, 150, 230, 255]);
    knockOutPaper(greenish, 1, 1);
    knockOutPaper(blueish, 1, 1);
    expect(greenish[3]!).toBeLessThan(blueish[3]!);
  });

  /** Transparency already in the file — a PNG signature with no background — must survive untouched. */
  it("leaves an already-transparent pixel transparent", () => {
    const data = canvas(1, 1, [20, 20, 20, 0]);
    knockOutPaper(data, 1, 1);
    expect(data[3]).toBe(0);
  });

  /**
   * ⚠ **This test exists because a mutation came back GREEN, and the test was at fault** — the seventh
   * time in this repo, and the cause was the usual one: a fixture too uniform to discriminate
   * ([[a-green-mutation-means-the-test-is-at-fault]]).
   *
   * `toLuminance` takes a `channels` argument, and `knockOutPaper` must pass **4** because a canvas
   * hands back RGBA. Passing 3 walks the buffer at the wrong stride — pixel *k* reads bytes `3k…3k+2`
   * instead of `4k…4k+2` — so from the second pixel on, every luminance is computed from one pixel's
   * alpha and the next one's red and green. Every other assertion in this block used a ONE or TWO
   * pixel fixture, and at that size the two strides cannot disagree: the first pixel is bytes 0–2
   * either way. So the mutation passed while reading the image diagonally.
   *
   * ⚠ Four pixels, and the values are chosen so misalignment cannot be mistaken for rounding: the
   * correct stride gives `[255, 255, 255, 0]` — three opaque strokes and one transparent paper pixel —
   * and a stride of 3 gives `[255, 255, 61, 255]`, which gets the paper *backwards*. On a real upload
   * that is a signature sheared diagonally across the page with the background left opaque.
   */
  it("reads the canvas at the RGBA stride, not the RGB one", () => {
    const data = canvas(4, 1, [0, 0, 0, 255], (set) => set(3, 0, [255, 255, 255, 255]));
    knockOutPaper(data, 4, 1);
    expect([data[3], data[7], data[11], data[15]]).toEqual([255, 255, 255, 0]);
  });
});

describe("fitting a mark into the space the packet gives it", () => {
  it("shrinks by the long edge", () => {
    expect(fitScale(2000, 500, 1000)).toBe(0.5);
    expect(fitScale(500, 2000, 1000)).toBe(0.5);
  });

  /** ⚠ Never enlarges — `webImageIo.encode` says the same, and here it would also inflate the PNG
   *  towards the 8 MB staging cap for a picture that was already the right size. */
  it("leaves a mark that already fits alone", () => {
    expect(fitScale(300, 120, 1000)).toBe(1);
  });
});
