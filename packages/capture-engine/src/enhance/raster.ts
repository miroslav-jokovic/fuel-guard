/**
 * The image the clean-copy pipeline works on (APPLICATION-PHOTO-CLEANUP-PLAN.md, D-PCL3): interleaved 8-bit
 * RGB, row-major, no padding, no alpha.
 *
 * ── WHY NOT `LuminancePlane` ──────────────────────────────────────────────────────────────────
 * `metrics.ts` measures, and a measurement only needs light. The clean copy is SHOWN, and D-PCL4's first
 * promise is that colour survives — a red stamp, a blue signature, the photo on a licence — so everything
 * here carries three channels. Alpha is dropped by the caller (sharp's `.removeAlpha()`), because nothing a
 * phone photographs is transparent and a fourth channel would be a quarter more memory for nothing.
 */
export interface RgbImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export function rgbImage(width: number, height: number): RgbImage {
  return { data: new Uint8Array(width * height * 3), width, height };
}

export function assertRgb(img: RgbImage, who: string): void {
  if (img.width <= 0 || img.height <= 0 || img.data.length < img.width * img.height * 3) {
    throw new Error(`${who}: expected ${img.width}x${img.height} RGB, received ${img.data.length} bytes`);
  }
}

/**
 * Area-average downscale of an RGB image to a long edge. Never upscales.
 *
 * The same box kernel as `metrics.ts` `boxDownscale`, per channel, for the reason its header gives: a
 * non-negative kernel cannot ring, so a dark table next to a white page stays a step and does not grow a
 * halo the document finder would read as an edge.
 */
export function downscaleRgb(img: RgbImage, targetLongEdge: number): RgbImage {
  const longEdge = Math.max(img.width, img.height);
  if (longEdge <= targetLongEdge) return img;
  const ow = Math.max(1, Math.round((img.width * targetLongEdge) / longEdge));
  const oh = Math.max(1, Math.round((img.height * targetLongEdge) / longEdge));
  const out = rgbImage(ow, oh);
  for (let oy = 0; oy < oh; oy++) {
    const y0 = Math.floor((oy * img.height) / oh);
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * img.height) / oh));
    for (let ox = 0; ox < ow; ox++) {
      const x0 = Math.floor((ox * img.width) / ow);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * img.width) / ow));
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = y0; y < y1; y++) {
        let p = (y * img.width + x0) * 3;
        for (let x = x0; x < x1; x++, p += 3) {
          r += img.data[p]!;
          g += img.data[p + 1]!;
          b += img.data[p + 2]!;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const q = (oy * ow + ox) * 3;
      out.data[q] = Math.round(r / n);
      out.data[q + 1] = Math.round(g / n);
      out.data[q + 2] = Math.round(b / n);
    }
  }
  return out;
}

/** Bilinear sample of one channel at a fractional position, clamped to the image's edge. */
export function sampleBilinear(img: RgbImage, x: number, y: number, out: Uint8Array, at: number): void {
  const maxX = img.width - 1;
  const maxY = img.height - 1;
  const cx = x < 0 ? 0 : x > maxX ? maxX : x;
  const cy = y < 0 ? 0 : y > maxY ? maxY : y;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = x0 < maxX ? x0 + 1 : x0;
  const y1 = y0 < maxY ? y0 + 1 : y0;
  const fx = cx - x0;
  const fy = cy - y0;
  const d = img.data;
  const p00 = (y0 * img.width + x0) * 3;
  const p10 = (y0 * img.width + x1) * 3;
  const p01 = (y1 * img.width + x0) * 3;
  const p11 = (y1 * img.width + x1) * 3;
  for (let c = 0; c < 3; c++) {
    const top = d[p00 + c]! + (d[p10 + c]! - d[p00 + c]!) * fx;
    const bottom = d[p01 + c]! + (d[p11 + c]! - d[p01 + c]!) * fx;
    out[at + c] = Math.round(top + (bottom - top) * fy);
  }
}
