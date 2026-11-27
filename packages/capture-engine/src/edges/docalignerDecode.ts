import { otsuThreshold, readingOrder } from "../enhance/findDocument";
import type { Point, Quad } from "../enhance/homography";
import type { RgbImage } from "../enhance/raster";

/**
 * DocAligner's pre- and post-processing: the REFERENCE definition (LIVE-EDGE-DETECTION-PLAN.md §4.5,
 * candidate (a)). The scorer (`tools/edges/docaligner.ts`) runs it on a Mac with onnxruntime, and the
 * Android scanner's `DocAlignerDecode.kt` is held to it by
 * `apps/driver/modules/capture-native/android/src/test/java/expo/modules/capturenative/DocAlignerDecodeParityTest.kt`
 * over `fixtures/edges/docaligner-decode.json`. That fixture was written from THIS file, and
 * `packages/capture-engine/tests/docalignerDecode.test.ts` re-derives it so it cannot go stale.
 *
 * It follows the authors' own `heatmap_reg/infer.py` and their site's `local-onnx.py`:
 *   in: the image STRETCHED to 256 × 256 (no letterbox), bilinear, BGR, ÷ 255;
 *   out: "heatmap", four channels, one per corner;
 *   per channel: resized to the image's size (bilinear), values under 0.3 zeroed, Otsu-binarised at
 *   8 bits, the LARGEST connected blob kept, its centroid the corner. A channel with no blob means no
 *   document (the authors count a detection only if all four are found).
 * The authors do not document which channel is which corner; `readingOrder` sorts them.
 *
 * Moved here from `tools/edges/docaligner.ts` on 2026-11-25 without a change of behaviour, so a second
 * language could be held to it.
 */

export const DOCALIGNER_SIZE = 256;
export const DOCALIGNER_THRESHOLD = 0.3;

/** One heatmap channel, read at (x, y) of its w × h grid. Layout-agnostic: NCHW and NHWC both fit. */
export type HeatmapPlane = (x: number, y: number) => number;

/** Stretch to 256×256 by bilinear sampling (pixel centres aligned, as OpenCV's INTER_LINEAR), BGR planes ÷255, NCHW. */
export function docalignerInput(img: RgbImage): Float32Array {
  const SIZE = DOCALIGNER_SIZE;
  const out = new Float32Array(3 * SIZE * SIZE);
  const sx = img.width / SIZE;
  const sy = img.height / SIZE;
  for (let y = 0; y < SIZE; y++) {
    const fy = Math.min(img.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(img.height - 1, y0 + 1);
    const dy = fy - y0;
    for (let x = 0; x < SIZE; x++) {
      const fx = Math.min(img.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(img.width - 1, x0 + 1);
      const dx = fx - x0;
      for (let ch = 0; ch < 3; ch++) {
        const v = (xx: number, yy: number) => img.data[(yy * img.width + xx) * 3 + ch]!;
        const top = v(x0, y0) * (1 - dx) + v(x1, y0) * dx;
        const bottom = v(x0, y1) * (1 - dx) + v(x1, y1) * dx;
        // RGB in, BGR planes out: channel 0 of the tensor is blue.
        out[(2 - ch) * SIZE * SIZE + y * SIZE + x] = (top * (1 - dy) + bottom * dy) / 255;
      }
    }
  }
  return out;
}

/** One corner from one heatmap channel, in the W × H image's pixels, or null when the channel has none. */
export function docalignerCorner(plane: HeatmapPlane, w: number, h: number, W: number, H: number): Point | null {
  // Upsample to the image's size, zero what is under the threshold, quantise to 8 bits.
  const q = new Uint8Array(W * H);
  const hist = new Float64Array(256);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / H - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(h - 1, y0 + 1);
    const dy = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / W - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(w - 1, x0 + 1);
      const dx = fx - x0;
      const v = (plane(x0, y0) * (1 - dx) + plane(x1, y0) * dx) * (1 - dy) + (plane(x0, y1) * (1 - dx) + plane(x1, y1) * dx) * dy;
      const b = v < DOCALIGNER_THRESHOLD ? 0 : Math.max(0, Math.min(255, Math.trunc(v * 255)));
      q[y * W + x] = b;
      hist[b]!++;
    }
  }
  const split = otsuThreshold(hist, W * H);
  if (!split) return null;
  // Largest 8-connected blob above the split, and its centroid.
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  let best = { n: 0, sx: 0, sy: 0 };
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || q[i]! <= split.threshold) continue;
    let n = 0, sx = 0, sy = 0;
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % W, y = (j - x) / W;
      n++; sx += x; sy += y;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(H - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(W - 1, x + 1); nx++) {
          const k = ny * W + nx;
          if (!seen[k] && q[k]! > split.threshold) { seen[k] = 1; stack.push(k); }
        }
      }
    }
    if (n > best.n) best = { n, sx, sy };
  }
  return best.n ? { x: best.sx / best.n + 0.5, y: best.sy / best.n + 0.5 } : null;
}

/** All four corners in reading order (TL, TR, BR, BL), or null unless every channel has one. */
export function docalignerQuad(planes: readonly HeatmapPlane[], w: number, h: number, W: number, H: number): Quad | null {
  const corners: Point[] = [];
  for (const plane of planes.slice(0, 4)) {
    const p = docalignerCorner(plane, w, h, W, H);
    if (!p) return null;
    corners.push(p);
  }
  return corners.length === 4 ? readingOrder(corners as unknown as Quad) : null;
}
