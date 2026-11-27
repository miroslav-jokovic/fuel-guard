import { DOCALIGNER_SIZE as SIZE, docalignerInput as toInput, docalignerQuad } from "../../src/edges/docalignerDecode";
import type { Quad } from "../../src/enhance/homography";
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
    const planes = Array.from({ length: Math.min(4, channels) }, (_, c) => (x: number, y: number) => out.data[c * h * w + y * w + x]!);
    return docalignerQuad(planes, w, h, img.width, img.height);
  };
}
