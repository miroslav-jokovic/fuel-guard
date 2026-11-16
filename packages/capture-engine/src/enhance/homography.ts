import { assertRgb, rgbImage, sampleBilinear, type RgbImage } from "./raster";

/**
 * Straightening a photographed document (APPLICATION-PHOTO-CLEANUP-PLAN.md, D-PCL3).
 *
 * ── THE METHOD, AND WHY IT IS THE ONE EVERYBODY CONVERGES ON ─────────────────────────────────
 * Four corners in the photo and four corners of an upright rectangle define a projective map (a
 * homography, eight unknowns, eight equations). The output is filled by INVERSE mapping: for each output
 * pixel, ask where it came from in the photo and sample there bilinearly. Forward mapping (push every
 * photo pixel to where it lands) leaves holes wherever the page was foreshortened, which is the far edge
 * of every page photographed at an angle. This is what OpenCV's `warpPerspective` does, and what the
 * dependency-free browser scanners researched for this plan do (Stirling-PDF #8719, doc-scanner).
 */

export interface Point {
  x: number;
  y: number;
}

/** Corners in reading order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [Point, Point, Point, Point];

/** A 3×3 projective matrix, row-major, with the last entry fixed at 1. */
export type Homography = readonly number[];

/**
 * The homography that carries `from[i]` to `to[i]` for all four corners, or null when the corners do not
 * define one (three on a line, two coincident).
 *
 * Gaussian elimination with partial pivoting on the 8×8 system. Pivoting is not decoration: corners in
 * pixel units make coefficients of 10³ beside coefficients of 10⁶, and without it a perfectly good quad
 * near the image origin loses most of its precision to a tiny pivot.
 */
export function solveHomography(from: Quad, to: Quad): Homography | null {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    if (Math.abs(a[pivot]![col]!) < 1e-10) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const p = a[col]!;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const r = a[row]!;
      const f = r[col]! / p[col]!;
      if (f === 0) continue;
      for (let k = col; k < 9; k++) r[k]! -= f * p[k]!;
    }
  }
  const h = a.map((row, i) => row[8]! / row[i]!);
  return [...h, 1];
}

export function applyHomography(h: Homography, p: Point): Point {
  const w = h[6]! * p.x + h[7]! * p.y + h[8]!;
  return { x: (h[0]! * p.x + h[1]! * p.y + h[2]!) / w, y: (h[3]! * p.x + h[4]! * p.y + h[5]!) / w };
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * ID-1, the card size of every licence, TWIC, SSN card and work permit (ISO/IEC 7810): 85.60 × 53.98 mm.
 * A standard, not a judgement — which is why it is the one shape the output is snapped to.
 */
export const ID1_ASPECT = 85.6 / 53.98;

/**
 * How far a measured card may be from ID-1 and still be snapped to it. A judgement, stated as one: the
 * longer side's estimate from four corners found at the analysis scale is good to a few percent, and a
 * card measured 12% away from ID-1 is not an ID-1 card photographed badly — it is something else, and is
 * left at the shape it was measured.
 */
const SNAP_TOLERANCE = 0.12;

/**
 * The upright size a quad straightens to, at most `maxLongEdge` on its long side.
 *
 * The longer of each pair of opposite edges: the near edge of a page photographed at an angle is the one
 * the camera saw at full size, so it is the honest estimate of the page's width; the far one is foreshortened.
 * A `card` is then snapped to ID-1 in whichever orientation it was measured (D-PCL4); a page is left as
 * measured, because a certificate may be letter, A4 or landscape and nothing says which.
 */
export function straightenedSize(quad: Quad, shape: "card" | "page", maxLongEdge: number): { width: number; height: number } {
  const [tl, tr, br, bl] = quad;
  let width = Math.max(distance(tl, tr), distance(bl, br));
  let height = Math.max(distance(tl, bl), distance(tr, br));
  if (shape === "card") {
    const landscape = width >= height;
    const measured = landscape ? width / height : height / width;
    if (Math.abs(measured - ID1_ASPECT) / ID1_ASPECT <= SNAP_TOLERANCE) {
      if (landscape) height = width / ID1_ASPECT;
      else width = height / ID1_ASPECT;
    }
  }
  const scale = Math.min(1, maxLongEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The part of `img` inside `quad`, straightened to `width × height`. Null when the quad defines no
 * homography (D-PCL5: no guess).
 */
export function warpQuad(img: RgbImage, quad: Quad, width: number, height: number): RgbImage | null {
  assertRgb(img, "warpQuad");
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ];
  const h = solveHomography(rect, quad);
  if (!h) return null;
  const out = rgbImage(width, height);
  for (let y = 0; y < height; y++) {
    // The row's projective coordinates step linearly in x; only the divide is per pixel.
    let nx = h[1]! * y + h[2]!;
    let ny = h[4]! * y + h[5]!;
    let nw = h[7]! * y + h[8]!;
    for (let x = 0, at = y * width * 3; x < width; x++, at += 3) {
      sampleBilinear(img, nx / nw, ny / nw, out.data, at);
      nx += h[0]!;
      ny += h[3]!;
      nw += h[6]!;
    }
  }
  return out;
}
