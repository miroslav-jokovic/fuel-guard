"""Real DocAligner heatmaps for the decode-parity fixture (`make-decode-fixture.ts`).

Runs the ONNX model of record on a few SmartDoc 2015 frames and writes each [4, 128, 128] heatmap as
float16, channel-major, to one .bin plus a .json index. The frames are only a source of REALISTIC
heatmaps — several blobs, soft shoulders, a weak corner — for the decode step; how they were prepared
does not matter to what the fixture tests.

    python -I heatmaps_for_fixture.py <model.onnx> <out-dir> [--smartdoc DIR]
"""
import argparse
import glob
import json
import os

import numpy as np
import onnxruntime as ort
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("onnx")
ap.add_argument("out")
ap.add_argument("--smartdoc", default=os.path.expanduser("~/.cache/silvicom-datasets/smartdoc15/frames"))
args = ap.parse_args()

# One frame from each of the five SmartDoc backgrounds, background05 (cluttered) included.
picks = [
    "background01/datasheet001/frame_0001.jpeg",
    "background02/letter002/frame_0060.jpeg",
    "background03/magazine003/frame_0120.jpeg",
    "background04/paper003/frame_0017.jpeg",
    "background05/tax003/frame_0036.jpeg",
]
session = ort.InferenceSession(args.onnx)
os.makedirs(args.out, exist_ok=True)
index, blobs = [], []
for rel in picks:
    path = os.path.join(args.smartdoc, rel)
    if not os.path.exists(path):
        continue
    bgr = np.asarray(Image.open(path).convert("RGB").resize((256, 256), Image.BILINEAR), dtype=np.float32)[:, :, ::-1] / 255.0
    heat = session.run(None, {"img": np.ascontiguousarray(bgr.transpose(2, 0, 1))[None]})[0][0]
    assert heat.shape == (4, 128, 128), heat.shape
    index.append({"name": rel, "offset": sum(len(b) for b in blobs)})
    blobs.append(heat.astype(np.float16).tobytes())
with open(os.path.join(args.out, "heatmaps.bin"), "wb") as f:
    f.write(b"".join(blobs))
with open(os.path.join(args.out, "heatmaps.json"), "w") as f:
    json.dump(index, f)
print(f"{len(index)} heatmaps written")
