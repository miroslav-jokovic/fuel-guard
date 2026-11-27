"""Prove the shipped .tflite gives the original ONNX model's answers (LIVE-EDGE-DETECTION-PLAN.md L4).

Runs both on every Nth SmartDoc 2015 frame, prepared exactly as `../docaligner.ts` prepares a frame
(stretched to 256 x 256, bilinear, BGR, / 255), and fails unless:
  - the largest heatmap difference anywhere is under 1e-4, and
  - no corner's heatmap peak moves by even one heatmap pixel.

One heatmap pixel is 1/128 of the frame, about 12 px on a 1,568 px page, so "close on average" is not
the bar: the first conversion (2026-11-25) was close on average (0.001) and moved peaks by up to 62
heatmap pixels, because the TFLite converter mis-lowers the BiFPN's einsum (`rewrite_einsum.py`).

    python -I verify_tflite.py <original.onnx> <model.tflite> [--every 124] [--frames 200]
"""
import argparse
import glob
import os
import sys

import numpy as np
import onnxruntime as ort
from ai_edge_litert.interpreter import Interpreter
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("onnx")
ap.add_argument("tflite")
ap.add_argument("--every", type=int, default=124)
ap.add_argument("--frames", type=int, default=200)
ap.add_argument("--smartdoc", default=os.path.expanduser("~/.cache/silvicom-datasets/smartdoc15/frames"))
args = ap.parse_args()

frames = sorted(glob.glob(os.path.join(args.smartdoc, "**", "*.jpeg"), recursive=True))[:: args.every][: args.frames]
if not frames:
    sys.exit(f"no SmartDoc frames under {args.smartdoc} (see ../README.md, 'The public check')")

session = ort.InferenceSession(args.onnx)
interp = Interpreter(model_path=args.tflite)
interp.allocate_tensors()
inp, out = interp.get_input_details()[0], interp.get_output_details()[0]
assert list(inp["shape"]) == [1, 256, 256, 3], inp["shape"]
assert list(out["shape"]) == [1, 128, 128, 4], out["shape"]

worst, moved = 0.0, 0.0
for path in frames:
    bgr = np.asarray(Image.open(path).convert("RGB").resize((256, 256), Image.BILINEAR), dtype=np.float32)[:, :, ::-1] / 255.0
    reference = session.run(None, {"img": np.ascontiguousarray(bgr.transpose(2, 0, 1))[None]})[0][0]
    interp.set_tensor(inp["index"], np.ascontiguousarray(bgr)[None])
    interp.invoke()
    converted = interp.get_tensor(out["index"])[0].transpose(2, 0, 1)
    worst = max(worst, float(np.abs(reference - converted).max()))
    for c in range(4):
        a = np.unravel_index(reference[c].argmax(), reference[c].shape)
        b = np.unravel_index(converted[c].argmax(), converted[c].shape)
        moved = max(moved, float(np.hypot(a[0] - b[0], a[1] - b[1])))

print(f"{len(frames)} frames: largest heatmap difference {worst:.2e}, largest peak move {moved} heatmap px")
if worst >= 1e-4 or moved > 0:
    sys.exit("FAIL: the .tflite does not give the ONNX model's answers")
print("PASS")
