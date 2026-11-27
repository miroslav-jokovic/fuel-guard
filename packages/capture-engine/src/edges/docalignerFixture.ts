import { DOCALIGNER_SIZE, docalignerInput } from "./docalignerDecode";
import type { RgbImage } from "../enhance/raster";

/**
 * The inputs of the decode-parity fixture that are built from a formula rather than stored
 * (`fixtures/edges/docaligner-decode.json`, `tools/edges/tflite/make-decode-fixture.ts`).
 *
 * Every formula uses only + − × ÷ and one rounding to float32 at the end, so TypeScript and Kotlin compute
 * the same bits: `DocAlignerDecodeParityTest.kt` rebuilds them with the same arithmetic. No `exp`,
 * `sin` or `pow` — those may differ in the last place between engines.
 */

export interface SyntheticBlob {
  channel: number;
  cx: number;
  cy: number;
  r: number;
  peak: number;
}
export interface SyntheticCase {
  name: string;
  blobs: SyntheticBlob[];
}

const corners = (peak: number): SyntheticBlob[] => [
  { channel: 0, cx: 20, cy: 24, r: 6, peak },
  { channel: 1, cx: 108, cy: 20, r: 6, peak },
  { channel: 2, cx: 110, cy: 104, r: 6, peak },
  { channel: 3, cx: 18, cy: 108, r: 6, peak },
];

export const SYNTHETIC_CASES: SyntheticCase[] = [
  { name: "four clean corners", blobs: corners(0.95) },
  // Channel 3 never reaches the 0.3 threshold: no document, as the authors define one.
  { name: "one corner too weak", blobs: [...corners(0.95).slice(0, 3), { channel: 3, cx: 18, cy: 108, r: 6, peak: 0.2 }] },
  // A second, smaller blob in channel 0: the LARGEST blob is the corner, not the first one scanned.
  { name: "two blobs in one channel", blobs: [{ channel: 0, cx: 60, cy: 10, r: 3, peak: 0.9 }, ...corners(0.9)] },
];

/** max over the channel's blobs of peak × (1 − d²/r²), floored at 0, rounded to float32. */
export function syntheticHeatmap(c: SyntheticCase, channel: number, x: number, y: number): number {
  let v = 0;
  for (const b of c.blobs) {
    if (b.channel !== channel) continue;
    const dx = x - b.cx;
    const dy = y - b.cy;
    const k = b.peak * (1 - (dx * dx + dy * dy) / (b.r * b.r));
    if (k > v) v = k;
  }
  return Math.fround(v);
}

/** A 37 × 23 RGB image, odd sizes on purpose so no scale factor is a round number. */
export function decodeFixtureInput(): RgbImage {
  const width = 37;
  const height = 23;
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) data[(y * width + x) * 3 + c] = (x * 7 + y * 13 + c * 29 + x * y) % 256;
    }
  }
  return { width, height, data };
}

/**
 * The model input for `img`, summarised in the layout the phone feeds LiteRT (NHWC, B G R per pixel):
 * the double sum of every float32 in that order, and the first 24 values exactly.
 */
export function inputDigest(img: RgbImage): { sum: number; head: number[] } {
  const S = DOCALIGNER_SIZE;
  const nchw = docalignerInput(img);
  let sum = 0;
  const head: number[] = [];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      for (let c = 0; c < 3; c++) {
        const v = nchw[c * S * S + y * S + x]!;
        sum += v;
        if (head.length < 24) head.push(v);
      }
    }
  }
  return { sum, head };
}

/**
 * IEEE 754 binary16 values (little-endian bytes) → numbers, exactly — every half is a float32. Written out
 * rather than `new Float16Array(...)` because `Float16Array` exists only from Node 24 and the repo's floor
 * is Node 22 (CI runs 22: the fixture test failed there with "Float16Array is not defined", 2026-11-27).
 * The same arithmetic as `halfToFloat` in `DocAlignerDecodeParityTest.kt`.
 */
export function halfFloats(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const h = bytes[2 * i]! | (bytes[2 * i + 1]! << 8);
    const exp = (h >> 10) & 0x1f;
    const mant = h & 0x3ff;
    const magnitude =
      exp === 0 ? (mant / 1024) * 2 ** -14 : exp === 0x1f ? (mant === 0 ? Infinity : NaN) : (1 + mant / 1024) * 2 ** (exp - 15);
    out[i] = h & 0x8000 ? -magnitude : magnitude;
  }
  return out;
}
