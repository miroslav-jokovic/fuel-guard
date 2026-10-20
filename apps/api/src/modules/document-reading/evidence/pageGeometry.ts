import type { OcrBox, OcrPage } from "./rowWitness.js";

/**
 * The OCR witness reads a PREPARED view of a page (ocr/prepareOcrView.ts: the paper found, flattened and its
 * text lines levelled), so its boxes are in that view's pixels. The witnesses judge them there — rows are
 * rows only once the lines are level — and every box they REPORT goes through `pageBox`, back onto the
 * upright page the reviewer's screen shows. A page with no `toPage` was read as it is (a stored read from
 * before the prepared view, a text layer, a page the preparation left alone) and its boxes are the page's.
 */

/** A 3×3 projective transform, row-major. */
export type Matrix3 = readonly number[];

export function applyMatrix(m: Matrix3, x: number, y: number): [number, number] {
  const w = m[6]! * x + m[7]! * y + m[8]!;
  return [(m[0]! * x + m[1]! * y + m[2]!) / w, (m[3]! * x + m[4]! * y + m[5]!) / w];
}

export function multiplyMatrix(a: Matrix3, b: Matrix3): number[] {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!);
  return out;
}

export function invertMatrix(m: Matrix3): number[] {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error("invertMatrix: singular");
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}

/** A box of the OCR's view as a fraction of the upright page: the bound of its four corners, mapped. */
export function pageBox(p: OcrPage, box: OcrBox): { x: number; y: number; w: number; h: number } {
  const corners: [number, number][] = [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]];
  const t = p.toPage;
  const pts = t ? corners.map(([x, y]) => applyMatrix(t.matrix, x, y)) : corners;
  const [W, H] = t ? [t.width, t.height] : [p.width, p.height];
  const x0 = Math.max(0, Math.min(...pts.map((q) => q[0])) / W);
  const y0 = Math.max(0, Math.min(...pts.map((q) => q[1])) / H);
  const x1 = Math.min(1, Math.max(...pts.map((q) => q[0])) / W);
  const y1 = Math.min(1, Math.max(...pts.map((q) => q[1])) / H);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}
