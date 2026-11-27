# Models shipped by the scanner

## `docaligner_lcnet100_256_fp32.tflite`

The live edge detector (LIVE-EDGE-DETECTION-PLAN.md §4.5, candidate (a); step L4 on Android).

| | |
|---|---|
| SHA-256 | `875fcfbc54859b610608313f51afd737ce02cf992fc9798f1427212508850832` |
| Built from | DocAligner `lcnet100_h_e_bifpn_256_fp32.onnx` (docaligner 1.1.1), SHA-256 `f4117b786e3a18470f3865c93f3c2bd69d9b998edd60f385574a5c665e79594e` |
| Built by | `packages/capture-engine/tools/edges/tflite/convert.sh`, versions pinned in `requirements.txt`. Two independent runs gave the same bytes. |
| Verified by | `verify_tflite.py`: 200 SmartDoc 2015 frames, largest heatmap difference from the ONNX model 1.33e-6, no corner peak moved. |
| Input | `[1, 256, 256, 3]` float32: the frame stretched to 256 × 256 (bilinear, pixel centres), **BGR**, ÷ 255 |
| Output | `[1, 128, 128, 4]` float32: one heatmap per corner, channel order undocumented by the authors (`readingOrder` sorts the corners) |

The conversion rewrites the model's 20 BiFPN weighted sums (`einsum("i,i...->...")`) as reshape, multiply
and sum before converting. That is the same arithmetic, and the rewritten ONNX model matches the original
to 3.9e-7. The TFLite converter mis-lowers that einsum: a straight conversion moved corner peaks by up to
62 heatmap pixels.

fp32 and not fp16: the fp16 conversion moves a peak by one heatmap pixel on some frames, about 12 px on a
1,568 px page.

## Licence

DocAligner, by DocsaidLab, is under the **Apache License 2.0**, and that includes the weights. Sources: the
licensing page and the author's reply on DocAligner issue #13 (2026-10-08): "I do not impose any
additional restrictions on the model weights". Converting the model and redistributing it inside the app
are both permitted. Apache-2.0 §4 asks that a copy of the licence and this attribution travel with the
app. The driver app has no open-source notices screen yet, and one is owed before a store release
(LIVE-EDGE-DETECTION-PLAN.md §7).

The training data is the open question, and it is recorded as Q-LED2, not settled here.

Upstream: https://github.com/DocsaidLab/DocAligner
