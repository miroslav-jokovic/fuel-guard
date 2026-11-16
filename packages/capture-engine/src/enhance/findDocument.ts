import type { Point, Quad } from "./homography";
import { assertRgb, downscaleRgb, type RgbImage } from "./raster";

/**
 * Where the document is in a photograph (APPLICATION-PHOTO-CLEANUP-PLAN.md, D-PCL3, D-PCL5).
 *
 * ── THE METHOD ────────────────────────────────────────────────────────────────────────────────
 * The photographs this reads are framed: the in-page scanner crops to the outline the driver aimed at plus
 * a margin, and a driver choosing a photo from the gallery took it of a document. So the frame's BORDER is
 * the surface the document lies on, and the document is the large region that is not that colour:
 *   1. at a 512 px analysis scale, the border ring's median colour is the background;
 *   2. every pixel's distance from it, split in two by Otsu's threshold — chosen by the histogram, not typed —
 *      capped at twice the table's own variation, so a sheet half in shade is not half table;
 *   3. a small opening and closing to drop specks and bridge a crease;
 *   4. the largest connected region, measured by row spans, so text and a licence's own photograph (which
 *      can be as dark as the table) are holes the region still covers;
 *   5. its convex hull, and the largest-area quadrilateral on that hull — which a rounded card corner or a
 *      thumb over one edge pulls in only slightly, where "the four extreme points" would follow the thumb;
 *   6. at FULL resolution, what is inside that quadrilateral must mostly NOT be the table's colour
 *      (`MAX_BACKGROUND_INSIDE`). A sheet on a table differs from the table nearly everywhere; a block of
 *      text on a page as white as the table differs only where the ink is — and at the search's 512 px,
 *      dense lines of text blur into one solid grey block that steps 1–5 accept (measured on the corpus
 *      page: 87% solid). Stirling-PDF's scanner before #8719 cropped exactly such pages "to their text
 *      block", which cuts off whatever stands apart from it — a letterhead, a signature.
 *
 * This is the colour half of the candidate generators the research found (doc-scanner's bright/low-saturation
 * regions under Otsu; Stirling-PDF's scorer), generalised from "white paper" to "not the table", because a
 * licence is not white. The edge half is not built: the plan's §4a records what would justify it.
 *
 * ── WHEN IT SAYS NOTHING (D-PCL5) ─────────────────────────────────────────────────────────────
 * It returns null rather than a guess when: the region is small, or touches the frame (the document was
 * cropped tight, or runs off the edge — there is no fourth side to find); the quadrilateral does not fill
 * the region it stands for, or has a corner that is not roughly square; or what it encloses is mostly the
 * table's colour (step 6). A missed straightening leaves the photo as it was framed; a wrong one cuts off a name.
 */

/** The long edge the search runs at. Corners found here are good to a few pixels at 1,568. */
export const FIND_LONG_EDGE = 512;

/** The document must cover at least this share of the frame (row-span area over frame area). */
const MIN_AREA = 0.12;
/**
 * At most this share of what is inside the quadrilateral may be the table's colour (step 6). A judgement: a
 * page of dense text is ~60% paper between its lines, and a licence on a dark table can match the table in
 * its photograph and its print (~30% of the card in the test card) — the line is between the two.
 */
const MAX_BACKGROUND_INSIDE = 0.45;
/** The quadrilateral must be this full: region area over quad area, and quad area over hull area. */
const MIN_FILL = 0.9;
/** Each corner within this many degrees of square. Perspective a phone can produce stays inside it. */
const MAX_CORNER_SKEW = 40;
/** A region within this share of the short side from the frame edge is touching it. */
const EDGE_MARGIN = 0.012;
/** How many hull points the quadrilateral search considers. C(64,4) is 635,376 — milliseconds. */
const HULL_POINTS = 64;

export interface FoundDocument {
  /** In the INPUT image's pixel coordinates, top-left / top-right / bottom-right / bottom-left. */
  quad: Quad;
  /** Otsu's separation, recorded so a later version can be compared with this one on the same photos. */
  separation: number;
}

export function findDocument(img: RgbImage): FoundDocument | null {
  assertRgb(img, "findDocument");
  const small = downscaleRgb(img, FIND_LONG_EDGE);
  const { width: w, height: h } = small;
  const split = splitFromBackground(small);
  // ⚠ No floor on `separation`. One was written, and no case could be built where it refused what the
  // checks below did not: a smooth shadow with no document in it splits as cleanly as a page on a table
  // (Otsu over a uniform spread scores ~0.75), so the figure says nothing about whether a document is
  // there. It is RECORDED, for comparing versions on the same photos, and gates nothing.
  if (!split) return null;

  const mask = close(open(split.mask, w, h, 1), w, h, 2);
  const region = largestRegion(mask, w, h);
  if (!region || region.area < MIN_AREA * w * h) return null;
  const margin = Math.max(1, Math.round(EDGE_MARGIN * Math.min(w, h)));
  if (region.minX < margin || region.minY < margin || region.maxX >= w - margin || region.maxY >= h - margin) return null;

  const hull = convexHull(region.points);
  const quad = largestQuad(simplify(hull, HULL_POINTS));
  if (!quad) return null;
  const quadArea = polygonArea(quad);
  if (region.area / quadArea < MIN_FILL || quadArea / polygonArea(hull) < MIN_FILL) return null;
  const ordered = readingOrder(quad);
  if (!ordered.every((_, i) => Math.abs(cornerAngle(ordered, i) - 90) <= MAX_CORNER_SKEW)) return null;

  const sx = img.width / w;
  const sy = img.height / h;
  const toInput = (p: Point): Point => ({ x: (p.x + 0.5) * sx - 0.5, y: (p.y + 0.5) * sy - 0.5 });
  const quadInInput: Quad = [toInput(ordered[0]), toInput(ordered[1]), toInput(ordered[2]), toInput(ordered[3])];
  if (backgroundShareInside(img, quadInInput, split.background, split.threshold) > MAX_BACKGROUND_INSIDE) return null;
  return { quad: quadInInput, separation: split.separation };
}

/**
 * The share of pixels inside a convex quad (in reading order) within `threshold` of the background colour,
 * on a grid of about 400 × 400 samples — enough to measure a share, far cheaper than every pixel.
 */
function backgroundShareInside(img: RgbImage, quad: Quad, background: readonly number[], threshold: number): number {
  const stride = Math.max(1, Math.round(Math.max(img.width, img.height) / 400));
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  let inside = 0;
  let like = 0;
  for (let y = Math.max(0, Math.ceil(Math.min(...ys))); y <= Math.min(img.height - 1, Math.max(...ys)); y += stride) {
    for (let x = Math.max(0, Math.ceil(Math.min(...xs))); x <= Math.min(img.width - 1, Math.max(...xs)); x += stride) {
      const pt = { x, y };
      if (!quad.every((a, i) => cross(a, quad[(i + 1) % 4]!, pt) >= 0)) continue;
      inside++;
      const p = (y * img.width + x) * 3;
      const d = Math.abs(img.data[p]! - background[0]!) + Math.abs(img.data[p + 1]! - background[1]!) + Math.abs(img.data[p + 2]! - background[2]!);
      if (d <= threshold) like++;
    }
  }
  return inside === 0 ? 1 : like / inside;
}

/** Distance from the border ring's median colour, split by Otsu. */
function splitFromBackground(
  img: RgbImage,
): { mask: Uint8Array; separation: number; background: number[]; threshold: number } | null {
  const { width: w, height: h, data } = img;
  const ring = Math.max(2, Math.round(0.03 * Math.min(w, h)));
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let ringCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y >= ring && y < h - ring && x >= ring && x < w - ring) continue;
      const p = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) hist[c]![data[p + c]!]!++;
      ringCount++;
    }
  }
  const median = hist.map((hc) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) if ((seen += hc[v]!) * 2 >= ringCount) return v;
    return 255;
  });

  const distance = new Uint16Array(w * h);
  const dh = new Float64Array(766);
  for (let i = 0, p = 0; i < distance.length; i++, p += 3) {
    const d = Math.abs(data[p]! - median[0]!) + Math.abs(data[p + 1]! - median[1]!) + Math.abs(data[p + 2]! - median[2]!);
    distance[i] = d;
    dh[d]!++;
  }
  const otsu = otsuThreshold(dh, distance.length);
  if (!otsu) return null;
  // ⚠ Otsu splits the histogram where the two classes separate best — and when a sheet is half in shade,
  // the best split falls between the sheet's dark half and its bright half, not between the table and the
  // sheet. The dark half is then "table", and the corner in it is lost (measured: 77 px off on a page
  // darkened toward one corner). So the threshold is also capped by how much the TABLE itself varies: its
  // ring's 95th-percentile distance from its own median, doubled — what is twice as unlike the table as
  // the table is unlike itself is not table.
  const ringDistances = new Uint32Array(766);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y >= ring && y < h - ring && x >= ring && x < w - ring) continue;
      ringDistances[distance[y * w + x]!]!++;
    }
  }
  let seen = 0;
  let tableSpread = 765;
  for (let d = 0; d < 766; d++) {
    if ((seen += ringDistances[d]!) >= 0.95 * ringCount) {
      tableSpread = d;
      break;
    }
  }
  const threshold = Math.min(otsu.threshold, tableSpread * 2);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = distance[i]! > threshold ? 1 : 0;
  return { mask, separation: otsu.separation, background: median, threshold };
}

/** Otsu's threshold over a histogram, with its separation (between-class / total variance). */
export function otsuThreshold(hist: ArrayLike<number>, total: number): { threshold: number; separation: number } | null {
  let sum = 0;
  let sumSq = 0;
  for (let v = 0; v < hist.length; v++) {
    sum += v * hist[v]!;
    sumSq += v * v * hist[v]!;
  }
  const mean = sum / total;
  const totalVariance = sumSq / total - mean * mean;
  if (totalVariance <= 0) return null;
  let best = -1;
  let threshold = 0;
  let weightB = 0;
  let sumB = 0;
  for (let t = 0; t < hist.length - 1; t++) {
    weightB += hist[t]!;
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += t * hist[t]!;
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const between = (weightB / total) * (weightF / total) * (meanB - meanF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return { threshold, separation: best / totalVariance };
}

/** Binary erosion (`erode`) or dilation by a square of radius r, as two separable passes. */
function morph(mask: Uint8Array, w: number, h: number, r: number, erode: boolean): Uint8Array {
  const pass = (src: Uint8Array, horizontal: boolean): Uint8Array => {
    const out = new Uint8Array(src.length);
    const [n, m] = horizontal ? [h, w] : [w, h];
    for (let line = 0; line < n; line++) {
      const at = (i: number): number => (horizontal ? line * w + i : i * w + line);
      for (let i = 0; i < m; i++) {
        let hit = erode ? 1 : 0;
        for (let k = Math.max(0, i - r); k <= Math.min(m - 1, i + r); k++) {
          if (erode ? src[at(k)] === 0 : src[at(k)] === 1) {
            hit = erode ? 0 : 1;
            break;
          }
        }
        out[at(i)] = hit;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}
const open = (m: Uint8Array, w: number, h: number, r: number): Uint8Array => morph(morph(m, w, h, r, true), w, h, r, false);
const close = (m: Uint8Array, w: number, h: number, r: number): Uint8Array => morph(morph(m, w, h, r, false), w, h, r, true);

interface Region {
  /** Row-span area: every pixel between a row's leftmost and rightmost, holes included. */
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Each row's leftmost and rightmost pixel — all a convex hull needs. */
  points: Point[];
}

/** The largest 4-connected region, its area measured by row spans so interior holes count as covered. */
function largestRegion(mask: Uint8Array, w: number, h: number): Region | null {
  const label = new Int32Array(w * h);
  let best: { id: number; size: number } | null = null;
  let next = 1;
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    const id = next++;
    let size = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const neighbours = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of neighbours) {
        if (j < 0 || j >= mask.length || !mask[j] || label[j]) continue;
        label[j] = id;
        stack.push(j);
      }
    }
    if (!best || size > best.size) best = { id, size };
  }
  if (!best) return null;

  const points: Point[] = [];
  let area = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < w; x++) {
      if (label[y * w + x] !== best.id) continue;
      if (left < 0) left = x;
      right = x;
    }
    if (left < 0) continue;
    area += right - left + 1;
    points.push({ x: left, y }, { x: right, y });
    minX = Math.min(minX, left);
    maxX = Math.max(maxX, right);
    minY = Math.min(minY, y);
    maxY = y;
  }
  return { area, minX, minY, maxX, maxY, points };
}

const cross = (o: Point, a: Point, b: Point): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Andrew's monotone chain. Counter-clockwise in a y-down frame's terms is irrelevant here: only order matters. */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function polygonArea(poly: readonly Point[]): number {
  let twice = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/**
 * At most n hull points, keeping the ones that matter: the point whose triangle with its two neighbours is
 * smallest is the one whose removal changes the outline least (Visvalingam–Whyatt), so it goes first, and a
 * corner — the largest such triangle there is — goes last.
 *
 * Chosen over taking every k-th point by index, which can step over a corner whenever the hull has more
 * than n points. ⚠ No fixture yet makes a hull that large: put index sampling back and the suite stays
 * green, so this is a choice argued, not a defect measured.
 */
function simplify(hull: Point[], n: number): Point[] {
  const pts = [...hull];
  const weight = (i: number): number => {
    const a = pts[(i - 1 + pts.length) % pts.length]!;
    const b = pts[i]!;
    const c = pts[(i + 1) % pts.length]!;
    return Math.abs(cross(a, b, c));
  };
  while (pts.length > n) {
    let least = 0;
    let leastWeight = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const wt = weight(i);
      if (wt < leastWeight) {
        leastWeight = wt;
        least = i;
      }
    }
    pts.splice(least, 1);
  }
  return pts;
}

/** The largest-area quadrilateral whose corners are hull points, taken in hull order (so it is convex). */
function largestQuad(hull: Point[]): Quad | null {
  const n = hull.length;
  if (n < 4) return null;
  let best = 0;
  let quad: Quad | null = null;
  for (let i = 0; i < n - 3; i++) {
    for (let j = i + 1; j < n - 2; j++) {
      for (let k = j + 1; k < n - 1; k++) {
        for (let l = k + 1; l < n; l++) {
          const q: Quad = [hull[i]!, hull[j]!, hull[k]!, hull[l]!];
          const area = polygonArea(q);
          if (area > best) {
            best = area;
            quad = q;
          }
        }
      }
    }
  }
  return quad;
}

/** Top-left first, then clockwise on screen (y grows downward). */
export function readingOrder(quad: Quad): Quad {
  const cx = quad.reduce((s, p) => s + p.x, 0) / 4;
  const cy = quad.reduce((s, p) => s + p.y, 0) / 4;
  const clockwise = [...quad].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let first = 0;
  for (let i = 1; i < 4; i++) if (clockwise[i]!.x + clockwise[i]!.y < clockwise[first]!.x + clockwise[first]!.y) first = i;
  const r = (i: number): Point => clockwise[(first + i) % 4]!;
  return [r(0), r(1), r(2), r(3)];
}

function cornerAngle(quad: Quad, i: number): number {
  const p = quad[i]!;
  const a = quad[(i + 3) % 4]!;
  const b = quad[(i + 1) % 4]!;
  const v1 = { x: a.x - p.x, y: a.y - p.y };
  const v2 = { x: b.x - p.x, y: b.y - p.y };
  const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}
