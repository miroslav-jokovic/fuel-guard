#!/usr/bin/env bash
# DocAligner lcnet100 (ONNX) -> the .tflite the Android scanner ships (LIVE-EDGE-DETECTION-PLAN.md L4).
#
#   bash convert.sh            # writes ./out/docaligner_lcnet100_256_fp32.tflite and verifies it
#
# Needs: uv, the ONNX model in ~/.cache/silvicom-datasets/models/ (../README.md), and SmartDoc 2015
# frames for the verification (../README.md, "The public check"). Everything runs in a throwaway venv.
#
# ⚠ onnx2tf downloads a "calibration" .npy from GitHub when it finds none locally and loads it with
# numpy's pickle path, which can run code. This script writes that file itself, from SmartDoc frames
# and with allow_pickle=False, so nothing is downloaded and nothing is unpickled.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL="${DOCALIGNER_ONNX:-$HOME/.cache/silvicom-datasets/models/lcnet100_h_e_bifpn_256_fp32.onnx}"
FRAMES="${SMARTDOC_FRAMES:-$HOME/.cache/silvicom-datasets/smartdoc15/frames}"
WANT_SHA=f4117b786e3a18470f3865c93f3c2bd69d9b998edd60f385574a5c665e79594e

[ "$(shasum -a 256 "$MODEL" | cut -d' ' -f1)" = "$WANT_SHA" ] || { echo "✗ $MODEL is not the model of record ($WANT_SHA)" >&2; exit 2; }
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
uv venv -q -p 3.11 "$WORK/venv"
# shellcheck disable=SC1091
. "$WORK/venv/bin/activate"
uv pip install -q -r "$HERE/requirements.txt"

cd "$WORK"
python -I "$HERE/rewrite_einsum.py" "$MODEL" docaligner.onnx
python -I - "$FRAMES" <<'PY'
import glob, os, sys, numpy as np
from PIL import Image
frames = sorted(glob.glob(os.path.join(sys.argv[1], "**", "*.jpeg"), recursive=True))[::1000][:20]
x = np.stack([np.asarray(Image.open(p).convert("RGB").resize((128, 128), Image.BILINEAR), dtype=np.float32)[:, :, ::-1] / 255.0 for p in frames])
np.save("calibration_image_sample_data_20x128x128x3_float32.npy", x.astype(np.float32), allow_pickle=False)
PY
onnx2tf -i docaligner.onnx -o tf -ois img:1,3,256,256 -n >/dev/null
python -I "$HERE/verify_tflite.py" "$MODEL" tf/docaligner_float32.tflite --smartdoc "$FRAMES"
mkdir -p "$HERE/out"
cp tf/docaligner_float32.tflite "$HERE/out/docaligner_lcnet100_256_fp32.tflite"
shasum -a 256 "$HERE/out/docaligner_lcnet100_256_fp32.tflite"
