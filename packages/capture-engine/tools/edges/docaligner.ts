import { otsuThreshold, readingOrder } from "../../src/enhance/findDocument";
import type { Point, Quad } from "../../src/enhance/homography";
import type { RgbImage } from "../../src/enhance/raster";

/**
 * Candidate (a) of LIVE-EDGE-DETECTION-PLAN.md §4.5: DocAligner's `lcnet100` heatmap corner model, run
 * on a Mac with onnxruntime for scoring (step L1). Not shipped, not imported by anything in `src/`.
 *
 * Model: `lcnet100_h_e_bifpn_256_fp32.onnx`, docaligner-1.1.1, SHA-256 f4117b78…594e, Apache-2.0 per
 * DocsaidLab's licensing page and its author's reply on DocAligner issue #13 (weights included). Its
 * TRAINING DATA is not licensed by the download and is partly of unknown origin — Q-LED2 records it.
 * Download it to `~/.cache/silvicom-datasets/models/` (the scorer looks there) — it is not committed.
 *
 * Pre- and post-processing follow the authors' own `heatmap_reg/infer.py` and the site's
 * `local-onnx.py`, because a model scored through a different pipeline is a different model:
 *   in   the image STRETCHED to 256×256 (no letterbox), bilinear, BGR, ÷255, NCHW, input "img";
 *   out  "heatmap", four channels, one per corner;
 *   per channel: resized to the image's size (bilinear), values under 0.3 zeroed, Otsu-binarised at
 *        8 bits, the LARGEST connected blob kept, its centroid is the corner. A channel with no blob means
 *        no document (the authors count a detection only when all four are found).
 * The authors do not document which channel is which corner; `readingOrder` sorts them, and the scorer
 * is indifferent to rotation anyway (`worstCornerError`).
 */

export const DOCALIGNER_MODEL = "lcnet100_h_e_bifpn_256_fp32.onnx";
const SIZE = 256;
const THRESHOLD = 0.3;

interface OrtModule {
  InferenceSession: { create(path: string): Promise<OrtSession> };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
}
interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>;
}

export async function loadDocAligner(modelPath: string): Promise<(img: RgbImage) => Promise<Quad | null>> {
  const ort = (await import("onnxruntime-node")) as unknown as OrtModule;
  const session = await ort.InferenceSession.create(modelPath);
  return async (img) => {
    const input = new ort.Tensor("float32", toInput(img), [1, 3, SIZE, SIZE]);
    const out = (await session.run({ img: input })).heatmap;
    if (!out) throw new Error("docaligner: the model has no 'heatmap' output");
    const [, channels, h, w] = out.dims as [number, number, number, number];
    const corners: Point[] = [];
    for (let c = 0; c < Math.min(4, channels); c++) {
      const p = cornerFrom(out.data.subarray(c * h * w, (c + 1) * h * w), w, h, img.width, img.height);
      if (!p) return null;
      corners.push(p);
    }
    return corners.length === 4 ? readingOrder(corners as unknown as Quad) : null;
  };
}

/** Stretch to 256×256 by bilinear sampling (pixel centres aligned, as OpenCV's INTER_LINEAR), BGR planes ÷255. */
function toInput(img: RgbImage): Float32Array {
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

function cornerFrom(plane: Float32Array, w: number, h: number, W: number, H: number): Point | null {
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
      const v =
        (plane[y0 * w + x0]! * (1 - dx) + plane[y0 * w + x1]! * dx) * (1 - dy) +
        (plane[y1 * w + x0]! * (1 - dx) + plane[y1 * w + x1]! * dx) * dy;
      const b = v < THRESHOLD ? 0 : Math.max(0, Math.min(255, Math.trunc(v * 255)));
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
