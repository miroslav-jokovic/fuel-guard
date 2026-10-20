import sharp from "sharp";
import { cv, ImageProcessor } from "ppu-ocv";
import { invertMatrix, multiplyMatrix, type Matrix3 } from "../evidence/pageGeometry.js";

/**
 * The OCR witness's view of a photographed page (READER-CORRECTNESS-PLAN, 2026-10-20 rectify spike;
 * DOCUMENT-READER-PLAN D-DR15 P3): the paper found, its perspective flattened, its printed lines levelled —
 * geometry only, in ONE resample from the upright original (R4). Never whitened, binarised, sharpened or
 * enlarged (R8, R11): a witness that invents a stroke is worse than none.
 *
 * Why. Measured on the two production photos with stored reads: the engine read 8 of 17 checked values on
 * Mayo Products BOL 14182 as photographed and 15 once the paper was flattened; on Sonny's corrosives page,
 * whose table is printed ~2° off its own paper, it read 1 of 13 and, levelled, 13 of 13 — UN3264 among them,
 * the digit the two readers split on. The engine finds text lines as horizontal bands; a tilted line is cut
 * across bands and read as fragments. Its pixels were enough.
 *
 * This view is the WITNESS's only. The model readers still read the original, and the witness only ever
 * backs a value a reader read (shippingEvidence.ts), so a better witness clears stops; it cannot put a value
 * on the paper that no reader saw (P1). Its boxes map back onto the upright page through `toPage`.
 *
 * Fail closed to "as today": no confident paper outline → no flattening (Anthropic: never crop out context);
 * no consistent line angle → no levelling; neither → null, and the engine reads the upright original.
 */

export interface OcrView {
  png: Buffer;
  width: number;
  height: number;
  /** View pixel → upright page pixel. */
  toPage: number[];
}

/** The detection copy's long edge: the paper outline is a large shape, and 640 px finds it in milliseconds. */
const OUTLINE_EDGE = 640;
/** A paper outline under this share of the frame is a label, a box on the form or a shadow, not the page. */
const MIN_PAPER = 0.2;
/** Over this share the photo IS the page (a scan, a rendered PDF): there is nothing to flatten. */
const MAX_PAPER = 0.97;
/** The line-angle copy's long edge, and how long a ruled line or text baseline must be to count. */
const LINES_EDGE = 1200;
const MIN_LINE = 0.12;
/** Levelling starts at this angle (below it a turn only costs a resample), and stops trusting itself here. */
const MIN_TILT = 0.4;
const MAX_TILT = 10;
/**
 * The page has one line angle when at least AGREE of its lines lie within NEAR degrees of their median; else
 * it is curled, folded, or two sheets (the view is not trusted). A share, not a quartile spread: on 15 lines
 * the spread jumped from 0 to 2.7° when one line appeared under a different grey conversion of the same view.
 */
const NEAR = 0.75;
const AGREE = 0.6;
const MIN_LINES = 8;

let runtime: Promise<void> | null = null;
const ready = () => (runtime ??= ImageProcessor.initRuntime());

type Mat = cv.Mat;
const free = (...m: (Mat | { delete(): void } | null | undefined)[]) => m.forEach((x) => x?.delete());

/**
 * The paper's four corners in the image's pixels (top-left, top-right, bottom-right, bottom-left), or null
 * when no single bright four-cornered region covers between MIN_PAPER and MAX_PAPER of the frame.
 */
export function findPaper(gray: Mat): [number, number][] | null {
  const k = OUTLINE_EDGE / Math.max(gray.cols, gray.rows);
  const small = new cv.Mat();
  const bw = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.resize(gray, small, new cv.Size(Math.round(gray.cols * k), Math.round(gray.rows * k)), 0, 0, cv.INTER_AREA);
    cv.GaussianBlur(small, small, new cv.Size(5, 5), 0);
    cv.threshold(small, bw, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.morphologyEx(bw, bw, cv.MORPH_CLOSE, kernel);
    cv.findContours(bw, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const frame = small.rows * small.cols;
    let best: { area: number; pts: [number, number][] } | null = null;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const hull = new cv.Mat();
      const approx = new cv.Mat();
      cv.convexHull(c, hull);
      cv.approxPolyDP(hull, approx, 0.02 * cv.arcLength(hull, true), true);
      const area = cv.contourArea(approx);
      if (approx.rows === 4 && area >= MIN_PAPER * frame && area <= MAX_PAPER * frame && (!best || area > best.area)) {
        best = { area, pts: Array.from({ length: 4 }, (_, j) => [approx.data32S[j * 2]! / k, approx.data32S[j * 2 + 1]! / k] as [number, number]) };
      }
      free(c, hull, approx);
    }
    return best ? ordered(best.pts) : null;
  } finally {
    free(small, bw, kernel, contours, hierarchy);
  }
}

function ordered(pts: [number, number][]): [number, number][] {
  const sum = pts.map(([x, y]) => x + y);
  const diff = pts.map(([x, y]) => x - y);
  return [
    pts[sum.indexOf(Math.min(...sum))]!,
    pts[diff.indexOf(Math.max(...diff))]!,
    pts[sum.indexOf(Math.max(...sum))]!,
    pts[diff.indexOf(Math.min(...diff))]!,
  ];
}

/**
 * The page's printed-line angle in degrees (positive: lines run down to the right), from its long straight
 * lines — a BOL's ruled table and its text baselines — or 0 when there are too few, or they disagree.
 * Measured from LINES, not from ink: the spike's ink-based measure read a flattened Mayo page at 0.71°,
 * pulled by the signature, and levelling it cost 3 of 15 values; long straight lines are what handwriting
 * does not make.
 */
export function measureTilt(gray: Mat): number {
  return tiltOf(lineSegments(gray));
}

/** Whether a view's printed lines are level and agree: the check every prepared view must pass. */
export function isLevel(gray: Mat): boolean {
  const { lines, agree, median } = lineStats(gray);
  return lines >= MIN_LINES && agree >= AGREE && Math.abs(median) < MIN_TILT;
}

/** A view's long straight lines: how many, the share that agree with their median angle, and that angle. */
export function lineStats(gray: Mat): { lines: number; agree: number; median: number } {
  const s = lineSegments(gray);
  return { lines: s.length, agree: agreeingShare(s), median: weightedAt(s, 0.5) };
}

function lineSegments(gray: Mat): { a: number; len: number }[] {
  const k = Math.min(1, LINES_EDGE / Math.max(gray.cols, gray.rows));
  const small = new cv.Mat();
  const edges = new cv.Mat();
  const lines = new cv.Mat();
  try {
    cv.resize(gray, small, new cv.Size(Math.round(gray.cols * k), Math.round(gray.rows * k)), 0, 0, cv.INTER_AREA);
    cv.Canny(small, edges, 50, 150);
    cv.HoughLinesP(edges, lines, 1, Math.PI / 1800, 60, small.cols * MIN_LINE, 12);
    // This opencv.js build lays the segments out along `cols`, not `rows`: count them from the data.
    const found: { a: number; len: number }[] = [];
    for (let i = 0; i < lines.data32S.length / 4; i++) {
      const [x1, y1, x2, y2] = [0, 1, 2, 3].map((j) => lines.data32S[i * 4 + j]!) as [number, number, number, number];
      const a = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      if (Math.abs(a) <= MAX_TILT) found.push({ a, len: Math.hypot(x2 - x1, y2 - y1) });
    }
    return found;
  } finally {
    free(small, edges, lines);
  }
}

/** The median of the segments' angles, or 0 when they are too few or too spread. Pure. */
export function tiltOf(segments: readonly { a: number; len: number }[]): number {
  if (segments.length < MIN_LINES || agreeingShare(segments) < AGREE) return 0;
  const median = weightedAt(segments, 0.5);
  return Math.abs(median) < MIN_TILT ? 0 : median;
}

/**
 * The angle at `share` of the segments, each counted once. Not weighted by length: the longest straight lines
 * in a photo are the edges of the paper and of whatever lies beside it, and on a synthetic page lying against
 * a second sheet, one such edge swung the spread from 0 to 2.76° and the verdict with it. A printed page's
 * lines are many and short; they should outvote a few long edges, not be outvoted.
 */
function weightedAt(segments: readonly { a: number; len: number }[], share: number): number {
  const s = segments.map((x) => x.a).sort((p, q) => p - q);
  return s.length ? s[Math.min(s.length - 1, Math.floor(share * s.length))]! : 0;
}

/** The share of segments within NEAR degrees of their median angle. */
function agreeingShare(segments: readonly { a: number; len: number }[]): number {
  if (segments.length === 0) return 0;
  const m = weightedAt(segments, 0.5);
  return segments.filter((x) => Math.abs(x.a - m) <= NEAR).length / segments.length;
}

/**
 * The upright page's OCR view, or null when the page needs neither flattening nor levelling — or when no
 * view it can make passes its own check. Every view must come out with its printed lines level and in
 * agreement (`isLevel`); one that does not is a wrong outline or a wrong angle, and is thrown away. Tried in
 * order: flattened and levelled; levelled only; the page as it is.
 */
export async function prepareOcrView(uprightPng: Buffer): Promise<OcrView | null> {
  await ready();
  const { data, info } = await sharp(uprightPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const src = cv.matFromImageData({ data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height } as never);
  const gray = new cv.Mat();
  const out = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const quad = findPaper(gray);
    for (const outline of quad ? [quad, null] : [null]) {
      const plan = planView(gray, outline);
      if (!plan) continue;
      // The one resample, from the original's pixels (R4): flatten and level composed into one warp.
      warp(src, out, plan.toView, plan.w, plan.h, cv.INTER_CUBIC, cv.BORDER_CONSTANT);
      const check = new cv.Mat();
      cv.cvtColor(out, check, cv.COLOR_RGBA2GRAY);
      const level = isLevel(check);
      check.delete();
      if (!level) continue;
      const png = await sharp(Buffer.from(out.data), { raw: { width: plan.w, height: plan.h, channels: 4 } }).removeAlpha().png().toBuffer();
      return { png, width: plan.w, height: plan.h, toPage: invertMatrix(plan.toView) };
    }
    return null;
  } finally {
    free(src, gray, out);
  }
}

/**
 * Page pixel → view pixel for one candidate: the outline flattened onto a rectangle of the paper's own edge
 * lengths (never enlarged), then turned level by the angle measured on the flattened paper, where the printed
 * lines are parallel again. Null when it would change nothing.
 */
function planView(gray: Mat, quad: [number, number][] | null): { toView: number[]; w: number; h: number } | null {
  let toView: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let [w, h] = [gray.cols, gray.rows];
  const flat = new cv.Mat();
  try {
    if (quad) {
      const [tl, tr, br, bl] = quad;
      const d = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
      [w, h] = [Math.round(Math.max(d(tl!, tr!), d(bl!, br!))), Math.round(Math.max(d(tl!, bl!), d(tr!, br!)))];
      toView = homography(quad, [[0, 0], [w, 0], [w, h], [0, h]]);
      warp(gray, flat, toView, w, h, cv.INTER_AREA, cv.BORDER_REPLICATE);
    }
    const tilt = measureTilt(quad ? flat : gray);
    if (!quad && tilt === 0) return null;
    if (tilt !== 0) {
      const rad = (tilt * Math.PI) / 180;
      const [cos, sin] = [Math.abs(Math.cos(rad)), Math.abs(Math.sin(rad))];
      const [nw, nh] = [Math.round(w * cos + h * sin), Math.round(w * sin + h * cos)];
      // Turn by −tilt about the centre, onto a canvas large enough to keep the corners.
      const c = Math.cos(-rad), s = Math.sin(-rad);
      const turn = [c, -s, nw / 2 - c * (w / 2) + s * (h / 2), s, c, nh / 2 - s * (w / 2) - c * (h / 2), 0, 0, 1];
      toView = multiplyMatrix(turn, toView);
      [w, h] = [nw, nh];
    }
    return { toView, w, h };
  } finally {
    flat.delete();
  }
}

function homography(from: [number, number][], to: [number, number][]): number[] {
  const a = cv.matFromArray(4, 1, cv.CV_32FC2, from.flat());
  const b = cv.matFromArray(4, 1, cv.CV_32FC2, to.flat());
  const m = cv.getPerspectiveTransform(a, b);
  try {
    return Array.from(m.data64F);
  } finally {
    free(a, b, m);
  }
}

function warp(from: Mat, to: Mat, m: Matrix3, w: number, h: number, interpolation: number, border: number): void {
  const t = cv.matFromArray(3, 3, cv.CV_64F, [...m]);
  try {
    cv.warpPerspective(from, to, t, new cv.Size(w, h), interpolation, border, new cv.Scalar(255, 255, 255, 255));
  } finally {
    t.delete();
  }
}
