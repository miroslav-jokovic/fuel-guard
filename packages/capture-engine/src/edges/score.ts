import { applyHomography, solveHomography, type Point, type Quad } from "../enhance/homography";

/**
 * How well a detector found a document's edges (LIVE-EDGE-DETECTION-PLAN.md §4.4, step L1).
 *
 * Every candidate detector — Apple's two, our `findDocument`, a corner network — is scored here, on the
 * same photographs, by the same arithmetic. That is the whole point of L1: §4.5 picks the detector by a
 * number, and a number is only comparable if one definition computes it.
 *
 * ── THE TWO MEASURES ──────────────────────────────────────────────────────────────────────────
 * 1. **The SmartDoc 2015 Jaccard index** (ICDAR 2015, challenge 1), so our numbers sit beside the published
 *    ones (best 2015 entry ~0.97; DocAligner lcnet100 0.989; docap 0.990). Both outlines are carried by
 *    the homography that straightens the TRUE outline into a rectangle, and the score is their
 *    intersection over union there. Straightening first is what makes a near corner's error and a far
 *    corner's error count alike — in the photo, a page's far edge is foreshortened, and a plain IoU
 *    would forgive the error exactly where it is easiest to make.
 *
 *    The challenge straightens to the document's real size (A4 in 0.1 mm). **This module straightens to a
 *    unit square, and the score is the same**: two target rectangles differ by a scaling, a scaling is
 *    affine, and an affine map multiplies every area by one constant — so a ratio of areas does not move.
 *    That is why our own photographs, whose paper sizes nobody measured, can be scored by the same
 *    measure. The test "does not depend on the paper size it straightens to" pins it.
 *
 * 2. **The worst corner's error in pixels at a 1,568 px long edge** — the size the engine keeps and
 *    uploads (`enhanceLongEdgePx`), so "2 px" means two pixels of the image the office reads. The
 *    Jaccard index summarises the whole outline; the worst corner is what a driver sees as a sliver of
 *    table or a clipped signature.
 *
 * ── CORNER ORDER ──────────────────────────────────────────────────────────────────────────────
 * Corners are compared under the best of the four ROTATIONS of the found outline (never a reflection).
 * A detector that calls the bottom-right corner "top-left" has found the same edges and put the page's
 * top in the wrong place: an orientation error, measured by the auto-rotate step, not an edge error. A
 * reflection is refused because no camera produces one — a mirrored order means the outline crosses
 * itself or winds backwards, and that IS an edge error.
 */

/** The long edge corner errors are expressed at: `enhanceLongEdgePx`, the image the office reads. */
export const SCORE_LONG_EDGE = 1568;

const UNIT: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** The SmartDoc 2015 Jaccard index of `found` against `truth`; 0 when nothing was found (the challenge's rule). */
export function smartDocJaccard(truth: Quad, found: Quad | null, target: Quad = UNIT): number {
  if (!found) return 0;
  const h = solveHomography(truth, target);
  if (!h) throw new Error("smartDocJaccard: the true outline is degenerate");
  // A found corner on the far side of the horizon (w ≤ 0) maps to the wrong side of infinity: the outline
  // has no finite image, and anything computed from it would be meaningless rather than merely poor.
  for (const p of found) if (h[6]! * p.x + h[7]! * p.y + h[8]! <= 0) return 0;
  const mapped = found.map((p) => applyHomography(h, p));
  if (selfIntersects(mapped)) return 0; // the challenge scores a crossed outline 0
  const inter = polygonArea(clipConvex(mapped, target));
  const union = polygonArea(mapped) + polygonArea(target) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * The largest of the four corner errors, in pixels at `SCORE_LONG_EDGE`, under the best rotation of the
 * found corners. `imageLongEdge` is the long edge of the image both outlines are expressed in.
 */
export function worstCornerError(truth: Quad, found: Quad, imageLongEdge: number): number {
  if (!(imageLongEdge > 0)) throw new Error("worstCornerError: imageLongEdge must be positive");
  const scale = SCORE_LONG_EDGE / imageLongEdge;
  let best = Infinity;
  for (let r = 0; r < 4; r++) {
    let worst = 0;
    for (let i = 0; i < 4; i++) {
      const a = truth[i]!;
      const b = found[(i + r) % 4]!;
      worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y) * scale);
    }
    best = Math.min(best, worst);
  }
  return best;
}

// ── geometry ─────────────────────────────────────────────────────────────────────────────────

export function polygonArea(p: readonly Point[]): number {
  let twice = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

function signedArea(p: readonly Point[]): number {
  let twice = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

/** Sutherland–Hodgman: any simple polygon clipped by a CONVEX one (here, always the straightened target). */
export function clipConvex(subject: readonly Point[], clipper: readonly Point[]): Point[] {
  const c = signedArea(clipper) >= 0 ? [...clipper] : [...clipper].reverse();
  let out: Point[] = [...subject];
  for (let i = 0; i < c.length && out.length > 0; i++) {
    const a = c[i]!;
    const b = c[(i + 1) % c.length]!;
    const side = (p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j]!;
      const q = input[(j + 1) % input.length]!;
      const sp = side(p);
      const sq = side(q);
      if (sq >= 0) {
        if (sp < 0) out.push(cut(p, q, sp, sq));
        out.push(q);
      } else if (sp >= 0) {
        out.push(cut(p, q, sp, sq));
      }
    }
  }
  return out;
}

function cut(p: Point, q: Point, sp: number, sq: number): Point {
  const t = sp / (sp - sq);
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

/** True when two non-adjacent sides of the quadrilateral cross (a bow-tie). */
export function selfIntersects(q: readonly Point[]): boolean {
  return segmentsCross(q[0]!, q[1]!, q[2]!, q[3]!) || segmentsCross(q[1]!, q[2]!, q[3]!, q[0]!);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
