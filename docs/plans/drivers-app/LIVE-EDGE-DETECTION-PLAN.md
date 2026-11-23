# Live document edge detection — analysis and plan · 2026-11-20

**Ask (owner, 2026-11-20):** make the driver app's scanner find a document's edges with top-of-the-line
precision, and draw an animated outline on those edges before the photo is taken, the way Genius Scan does.

**Status:** analysis; owner chose to BUILD (Q-LED1, 2026-11-20); nothing built yet. This is Phase 7 of `SCANNER-UPGRADE-PLAN.md` (the "v2
RawCapture" scanner). D-SCAN12 deliberately left that phase unscheduled until a measured number opened it.
**This document records the owner's ask as the trigger that opens it (D-LED1)** and lays out how to build it.
Open questions are in §7. Three of them need an answer before anything gets built.

---

## 1. What the driver sees today — read this first

The repository settles the first thing to know, and it is easy to get wrong:

- **iOS already draws a live, animated outline.** `CaptureNativeModule.swift` presents
  `VNDocumentCameraViewController`. Since iOS 15 that is Apple's own scanner, and on any phone with a Neural
  Engine it runs `VNDetectDocumentSegmentationRequest` on every preview frame. It shades the detected sheet
  in blue, follows it as the phone moves, and takes the picture by itself (WWDC21 "Extract document data using
  Vision"). That detector is the same ML model we would use ourselves.
- **Android already draws one too.** `GmsDocumentScanner` in `SCANNER_MODE_FULL` is Google's scanner UI,
  with live detection and an outline of its own.

So the gap is **not** "no live outline". These are the real gaps:

| Gap | Why it matters | Can the OS scanners close it? |
|---|---|---|
| **G1 Look and feel** | The outline, its colours, the hints and the shutter are Apple's and Google's. They match neither each other nor Silvicom's design system, and drivers get two different experiences. | No, neither UI can be styled |
| **G2 Raw frame + corners** | Both return only a finished, cropped, enhanced JPEG: no original frame, no corner points (DCE §1, Q2 CLOSED). Our quality gate measures something the OS has already altered. | No |
| **G3 Auto-capture we control** | The OS decides when to fire. It cannot wait for *our* checks (sharp enough, no glare, the whole page inside) before taking the shot. | No |
| **G4 Precision we can measure** | We cannot measure how accurate the OS crop is, because we never see its corners. | No |
| **G5 Phones without Google Play services** | `GmsDocumentScanner` does not exist on de-Googled or enterprise-locked Android (§6 Q4 of the upgrade plan). | No |

**Every one of these needs our own camera screen.** Restyling the OS scanner is impossible, so a
Genius-Scan look requires building the screen ourselves (§3).

**Production has never recorded a capture** (`hazmat_documents.capture_metrics` holds zero rows; device
session D-SCAN13 not yet run). There is no field data to say the OS crop is *bad*. The case for building
rests on G1–G5, not on a measured failure. Write that down rather than imply otherwise.

## 2. What Genius Scan actually does (public sources)

From the SDK docs, changelog and their June 2026 engineering post:

- Everything runs on the phone, offline. Live detection produces one four-sided outline (a "quadrangle") per
  preview frame. On Android it lives in a `DocumentDetection` component, kept separate from `ScanProcessing`,
  the per-photo crop and filter step.
- Outlines are analysed **as a stream over time** (`QuadStreamAnalyzer`, whose status includes `TRIGGER`), not
  one frame at a time. That is how the outline stays steady and how auto-capture decides when to fire.
- The live screen shows the outline plus a progress animation for auto-capture. **The animation does not take
  the picture.** The app takes it when the analyser reports `TRIGGER`. Detection is switched off while a capture
  is in progress.
- Changelog: 3.0 "animation when document is detected"; 4.0 "smoother real-time display of the detected
  document"; 6.0 (May 2026) animated move from capture to review, and edge dragging in the recrop screen.
- Recrop screen: corner handles **plus side handles** to drag a whole edge, and a magnifier (~166 dp) under
  the finger while dragging a corner.
- The failure cases they list: low light, glossy, curved or folded paper, a document the same colour as the
  table, old and low-end Android phones, overlays that drift from the photo, the preview freezing when the
  flash is toggled.
- They **do not publish** whether detection is ML or classical CV, their frame rate, their smoothing method or
  their trigger thresholds. Everything below that goes beyond the list above is our own design, not a copy.

**Buying it is a real option** (§7 Q-LED1): the Genius Scan SDK is licensed per app, price by quote.
It covers G1 (partly: it is styleable but still their UI kit), G3, G4 and G5, but it is a second capture
engine beside `capture-engine`, it is closed source, and every frame and threshold becomes theirs.

## 2a. How the industry solves it — research, 2026-11-20

Sources read: the Genius Scan detection post (2024), Readdle Scanner Pro's border-detection post (2024),
Dropbox's document detection post (2016), KingSoft WPS on the TensorFlow blog (2019), the Dynamsoft and
Scanbot developer posts, and the source code of four open-source scanners: WeScan (iOS, MIT, archived
01/2026), ScanFromCam (Android, Apache-2.0), DocAligner (Apache-2.0) and docap (MIT). Every number below
comes from those pages or that code.

### What each built, and why they moved on

| Who | Live detector | Precision step | Steady outline / auto-capture | Their number |
|---|---|---|---|---|
| **Genius Scan** v1 (2010) | Canny → Hough → "four most coherent lines" | — | — | ~50 % needed a manual fix |
| Genius Scan v2 (2021) | MobileNetV2, **96×96 input**, predicts the 4 corners, 1 M+ training images | **a classical algorithm after the network**, because the net "rarely made major mistakes" but "often lacked precision" | not published | correct 51 % → **75 %** |
| Genius Scan v3 (2024) | same + synthetic hard cases ("paper piles") | a **second network** refines | not published | 75 % → **85 %**, −40 % manual fixes; ≥ 25 fps on old phones |
| **Scanner Pro** v1 | own edge detector → Hough → score every quad on edge probability; Neon/Accelerate | — | — | 20–25 fps; failed on white-on-white, low light |
| Scanner Pro v2 | small segmentation net on the **Neural Engine**, mask → Hough-like quad (Metal) | — | — | 5 fps on iPhone X at first, then 10–15 fps — "choppy" |
| Scanner Pro v3 (experimental) | MobileNet **corner keypoints**, > 30 fps on every device | the heavier **segmentation net re-run on the still** | **Kalman filter fused with gyro/accelerometer**; detector runs only on real movement | "significantly outperformed" classical |
| **Dropbox** (2016) | learned edge detector (random forest), Hough, every quad scored by edge probability summed along its perimeter | none | none | 8–10 fps; **60 % fewer manual corrections than Apple's detector** in an A/B test |
| **KingSoft WPS** | 7-layer SqueezeNet-style CNN, TFLite, every frame | — | "a filter outside the neural network" against jitter | 30 fps high-end, a few fps low-end |
| **WeScan** | Apple `VNDetectRectanglesRequest` (conf ≥ 0.8) | none: the preview outline is scaled up to the photo | **consensus over the last 8 detections** (corners within 40 px); auto-shot after **36** frames within 6 px | — |
| **ScanFromCam** | OpenCV, **two candidate generators** (edge contours + bright page blob) at 640 px, scored area × rectangularity × edge support × brightness × contrast | **per side, 23 points snapped to the strongest gradient, line re-fitted**, *rejected if a corner moved > 5 %* | per-corner dead zone + smoothing; IoU ≥ 0.9 for 4 frames; **accelerometer** still-gate; sharpness check; hold 0–3 s | — |
| **docap** (on DocAligner) | **4 corner heatmaps** (256 px in, 128 px out), 4.8 MB, 17 ms/frame on one CPU core | full-res re-detect + edge re-fit; **sub-pixel snapping OFF — it measured −0.2 px inward bias** | **One Euro filter** (minCutoff 1.5, beta 4) for display; stability gate on RAW corners vs an **anchor**: drift ≤ 1.5 % of diagonal for **650 ms**, gaps < 180 ms forgiven | SmartDoc 2015: **IoU 0.990**; in-the-wild set: **0.702** |
| **Dynamsoft** | SDK (closed) | — | IoU ≥ 0.85 and area change ≤ 15 % for 3 frames, cross-frame verification, **1.5 s cooldown**, manual shutter falls back to a plain photo after 500 ms | — |

### The seven practices they converge on

1. **A neural net finds the page; it does not place the corners.** Every team that started classical
   (Genius, Scanner Pro, Scanbot, the receipt paper's 85 % vs 37 %) moved to a small on-device net. The
   reason was clutter, low contrast and white-on-white. Genius says it outright: the net is robust but
   imprecise.
2. **Precision is a separate, second stage on the full-resolution photo.** Genius runs a classical refiner
   and later a second net, Scanner Pro re-runs a heavier net on the still, docap re-fits edges at about
   2,200 px, and ScanFromCam re-fits every side. **Nobody ships the preview outline as the final crop except
   WeScan**, and WeScan is the weakest design here.
3. **Corners as heatmaps, not raw coordinates.** DocAligner abandoned direct regression because upscaling
   it moved corners "by about 5 to 10 pixels". Heatmaps also give a per-corner confidence.
4. **A refinement must be allowed to say no.** ScanFromCam rejects a refinement that moves a corner more
   than 5 % or changes the area by more than ±18 %. docap measured that sub-pixel snapping *hurt* on real
   photos and turned it off. **The refinement ships only if the labelled set proves it helps.** This is
   the same rule as findDocument.ts and its "snapped to the text block" lesson.
5. **Smoothing for the eye and a stillness test are two different things.** The outline you see is
   smoothed (One Euro, Kalman, EMA). The decision to shoot reads the **raw** corners against an **anchor**
   frame, not the previous frame. Comparing frame-to-frame lets a slow drift pass, which is the flaw
   in Dynamsoft's version. Short gaps in detection (≤ 180 ms) are forgiven.
6. **The phone's own motion sensors help.** Scanner Pro fuses the gyroscope into its tracker, and
   ScanFromCam will not shoot unless the accelerometer says the phone is still. A blurry frame from a
   moving hand is refused before any image check runs.
7. **Their real measure is how often a user has to fix the crop.** Genius tracks manual adjustments, and
   Dropbox A/B-tested correction rates against Apple. Public benchmarks flatter: docap scores 0.990 on
   SmartDoc 2015 and 0.702 on photos from the wild. **Our measure has to be our own photos** (BOLs on a
   dashboard, receipts on a truck seat) **plus a recorded recrop rate in the field.**

### What this changes in the plan below
- §4.2: snapping is a *candidate* that must beat "no snapping" on the labelled set, and it has guards.
  The "~1 px" figure is a target, not a promise.
- §3.2: the stillness test uses an anchor and raw corners, plus a motion-sensor gate. Starting values come
  from docap and ScanFromCam instead of invented ones.
- §4.5 becomes "§4.5 the detector": choose by measurement among Apple's segmentation, a heatmap corner model
  on **both** platforms, and a two-generator OpenCV baseline. One model on both phones is what Scanner Pro
  rebuilt for: the same behaviour everywhere.
- §4.4 adds the recrop rate as a field metric and SmartDoc 2015 as a public check.

## 3. Recommended architecture

**D-LED2: our own camera as a native view inside `capture-native`.** That means AVFoundation on iOS and
CameraX on Android, exposed as an Expo Modules `View`, with the **outline drawn natively on top of the
preview** (a `CAShapeLayer` on iOS, a Compose `Canvas` on Android). Detection, smoothing and the outline all
stay on the native side, and JS receives only events (`stateChanged`, `captured`). Why not
`react-native-vision-camera` + frame processors + Reanimated/Skia:

- Phase 7 itself names the cost: "the OS scanner means zero JS-thread load, zero bridge traffic". A native
  overlay keeps both. Sending an outline across to JS 15–30 times a second, then animating it there, adds
  a frame or two of lag, and the outline visibly trails the paper. That lag is the difference between
  "top of the line" and "fine".
- vision-camera v5 is a Nitro rewrite with no Expo config plugin (DCE §4). On Expo 57 / RN 0.86 that is a
  dependency risk for the one screen drivers use most. We already own a native module with parity tests.
- `CAShapeLayer.strokeEnd` is exactly the draw-on stroke effect Genius Scan shows, and it costs nothing.

The OS scanners **stay as fallback** (D-LED3): unsupported hardware, a camera failure, or a driver who picks
"Use system scanner". The `provider.ts` seam already allows a second provider; this becomes
`RawCaptureProvider`, as DCE §2 drew it.

### 3.1 The pipeline, per preview frame (~15 fps for detection, 30–60 fps for display)

```
 camera frame (YUV, 30 fps)
   └─ every 2nd frame, downscaled to ~512 px long edge, on a background queue
        1. DETECT   the detector chosen in §4.5 (heatmap corner model on both platforms is
                    the front-runner; Apple segmentation on iOS as a second opinion)
                    → rough corner points + a confidence per corner
        2. FIT      mask outline → four straight edges → corners (§4.1)
        3. VALIDATE reject if: area < 12 % of frame, a corner angle off square by more than 40°,
                    not convex, aspect impossible for paper or a card
                    (the same rules findDocument.ts already uses — share them, D-LED5)
        4. TRACK    match to the previous outline; smooth each corner (§4.3)
   └─ display, every screen refresh: animate the drawn outline toward the smoothed one
```

### 3.2 The capture state machine (pure TypeScript in `capture-engine`, unit-tested, no RN import)

`SEARCHING → DETECTED → HOLD_STILL → READY → CAPTURING → REVIEW`, as Phase 7 named it, with these rules:

- `DETECTED` after 3 consecutive valid frames (WeScan and Dynamsoft both use 3). **Hysteresis:** go back to
  `SEARCHING` only after a gap longer than 180 ms (docap), so one missed frame does not flicker the outline away.
- `HOLD_STILL → READY` uses the **raw** corners (not the smoothed ones) **against an anchor**, meaning the
  corners as they stood when the hold began. Any corner moving more than 1.5 % of the diagonal resets the
  anchor and the timer (docap; frame-to-frame comparison lets a slow creep pass). The hold is 650 ms (docap).
  All of these must also hold:
  - the **accelerometer/gyro** says the phone is still (ScanFromCam: calm < 0.18 m/s² for 250 ms, moving
    > 0.28 m/s², hysteresis between);
  - sharpness, from the existing `metrics.ts` definition on the frame, is at least 0.7 × the best seen
    during this hold (docap's relative test, which works on any paper);
  - no glare blob inside the outline, and the whole page is inside the frame.

  **Our quality gate decides when the photo is taken (G3).** Genius Scan's trigger cannot do that.
- After a shot, **re-arm** only when the page has left the frame for 500 ms or a *different* page has been
  seen for 3 frames (docap). Without that, the same page is shot twice.
- The **manual shutter always works.** With no outline within 500 ms of a press, it takes a plain photo
  (Dynamsoft) and opens the recrop screen.
- `CAPTURING` takes a **full-resolution photo** (not a preview frame), then refines the corners again on that
  photo (§4.2). The preview outline is only a starting guess for the final crop.
- Every threshold is a named constant in `config.ts`, recorded with the capture's `capture_metrics`, and
  re-derived from the field data in Step 5.2. They are starting values, not measured ones. Say so in the code.

The machine is pure so it can be tested from recorded outline sequences (a JSON list of corner points per
frame), and it runs the same on both platforms because the native side only feeds it.
⚠ **Open design point:** running the machine in JS means one small event per detection frame (~15/s). That
is light, but it is bridge traffic. The alternative is to port it to Swift and Kotlin and hold them to one
test file, the way `CaptureMetrics` is. Decide at the spike, with a number (Q-LED4).

## 4. Making the edges precise

The ML mask finds *where* the document is, reliably even on cluttered tables. It is not precise: Apple's
mask is low-resolution and its corners can be several pixels off at full size. Precision comes from three
more steps, and those steps are what separate a good scanner from a great one.

### 4.1 Mask → straight edges (live, every detection frame)
Do not take the mask's extreme points: a thumb or a rounded card corner pulls them in. Instead trace the
mask's outline, split it into four sides, and **fit a straight line to each side with a robust fit**
(RANSAC, or least squares that down-weights outliers). Each corner is where two fitted lines cross.
A thumb over one edge then moves the line slightly instead of dragging a corner. `findDocument.ts` already
does the hull-to-quadrilateral half of this.

### 4.2 Sub-pixel refinement on the full-resolution photo (once, at capture)
For each of the four edges, take a narrow strip (±1.5 % of the short side) around the rough line in the
**full-resolution** photo. Find the point of strongest brightness change across the strip at ~40 points
along the edge, to sub-pixel accuracy (a parabola fitted through the peak). Fit the line again through those
points, and use the crossing points as the final corners. This is the classic edge-snapping step (ScanFromCam's `refineQuad`
does it with 23 points per side). The **target** is a ~4–8 px corner error at preview scale brought down to
~1–2 px at full size. It is a target, not a promise: docap measured that snapping *biased corners 0.2 px
inward* on real photos and turned it off (§2a practice 4). **It ships only if it beats "no snapping" on the
L1 photo set, and the test that proves it compares the two.** Guards:
- A refinement that moves any corner more than 5 % of the short side, or changes the area by more than
  ±18 %, is thrown away and the rough corners stand (ScanFromCam's limits). Fewer than 10 usable edge points
  on a side means that side keeps its rough line.
- A strip with no clear edge (white paper on a white table) **keeps the rough line** instead of jumping to the
  strongest line of text. This repeats the lesson `findDocument.ts` already paid for: the Stirling-PDF crop
  that snapped to the text block.
- Allow a curved edge (an edge that is not straight along its length) only as a later step. Curl correction
  for book-like pages is a Genius Scan feature but out of scope for v1 (§6).

### 4.3 Steady outline over time
- **One Euro filter per corner coordinate** (position plus speed), for **display only**. It smooths heavily
  while the phone is still, which kills jitter, and lightly while it moves, so the outline does not trail.
  Start from docap's minCutoff 1.5 Hz and beta 4 in units of the frame diagonal. Tune with the authors'
  procedure: lower minCutoff until a still phone's outline stops shivering, then raise beta until a fast
  swing stops lagging.
- Later, if L0 shows lag on fast moves: feed the gyroscope's rotation into the tracker between detections,
  as Scanner Pro does with a Kalman filter.
- **Keep corner order fixed** (top-left first, going clockwise, the same order `homography.ts` uses) so a
  rotated phone does not make the outline spin.
- **A sudden jump** (outline overlap against the previous one below 0.5) resets the filter instead of
  smoothing across two different sheets.

### 4.4 How "precise" gets proven, not claimed
- **A labelled photo set.** ~300 photos with hand-marked corners: BOLs, PODs, fuel receipts, CDL cards, on
  wood, a dashboard, a white desk and a truck seat, in sun and at night, crumpled and folded. Most can come
  from the device session (D-SCAN13), and the PII rule from the calibration targets applies.
- **Measured per photo:** worst-corner error in px at a 1,568 px long edge, outline overlap (IoU), and a "no
  outline found" rate. **Proposed bar (Q-LED3):** median ≤ 2 px, p95 ≤ 6 px, no outline on ≤ 2 % of photos
  that contain a document, and a **false outline on 0 photos with no document** (a missing crop leaves the
  photo as taken; a wrong crop cuts off a name, the D-PCL5 rule).
- **Public check:** SmartDoc 2015 challenge 1, scored by its own measure (overlap after removing the
  perspective). The best 2015 entry scored ~0.97 and docap scores 0.990. Doing well there is necessary
  but not enough: docap falls to 0.702 on photos from the wild.
- **Field metric, recorded in `capture_metrics` from day one:** did the driver open the recrop screen, and by
  how much did the corners move? This is the measure Genius and Dropbox report, and it is how Step 5.2 later
  learns whether the bar holds on real trucks.
- A test in `capture-engine` runs the refinement (§4.2), the validator (§3.1.3) and the state machine on
  that set. Swift and Kotlin hold to the same expected outputs, the way `CaptureMetrics` already does
  (`fixtures/expected.json`). **The same photos are run through Apple's own scanner once**, as the bar to
  beat. If our crop is not better than VisionKit's, G4 says so in a number, and that answers whether the
  build was worth it.

### 4.5 The detector — chosen by measurement, the same on both phones if possible
The industry answer (§2a practice 1) is a small corner network. Three candidates go into L0/L1, each scored
on the same labelled photos and measured for speed on a real phone:

| Candidate | For | Against |
|---|---|---|
| **(a) Heatmap corner model** (DocAligner-class: 256 px in, 4 corner heatmaps, ~5 MB, Core ML on iOS / TFLite on Android) | **One detector on both platforms**, so the same behaviour everywhere, which Scanner Pro rebuilt for. Per-corner confidence. 17 ms on one CPU core before any GPU/ANE help. Code is Apache-2.0. | Weights are downloaded from the authors' Google Drive, and **the weights' licence and training data must be checked** (Q-LED2). Off-the-shelf it scores 0.702 on photos from the wild, so expect to **fine-tune on our own photos**, which is how Genius went from 51 % to 85 %. |
| **(b) Apple `VNDetectDocumentSegmentationRequest`** (iOS only) | Free, on the Neural Engine, already what VisionKit uses; stable when run through a sequence handler. | iOS only. A coarse mask, so it needs §4.1 line fitting. One production write-up says it misses on cluttered tables. Our crop would at best equal VisionKit's. |
| **(c) Two-generator OpenCV** (ScanFromCam: edge contours + bright page blob, scored) | No model, no licence question, transparent. Our `findDocument.ts` is already the blob half. | Every team that started here left, because of white-on-white, low light and clutter. |

**Recommendation:** (a) as the main detector on both platforms, with (b) as a second opinion on iPhone (a
detection both agree on starts with higher confidence) and (c) as the baseline every candidate must beat on
L1. If (a)'s licence fails, train the same architecture on L1's photos plus synthetic hard cases (Genius's
"paper piles") and SmartDoc. That is the step that adds weeks.

## 5. The animation (what the driver sees)

All native, all on the display refresh, colours passed in from the design system's tokens:

1. **SEARCHING:** a faint guide shape for the expected document (a page, or a card for the CDL), plus one hint
   line: "Fit the page in the frame".
2. **First detection, the Genius moment:** the outline **draws itself in**. The stroke runs around the four
   edges from the top-left corner in ~280 ms (`strokeEnd` 0 → 1, ease-out), and a light fill
   (~12 % opacity) fades in behind it. One light haptic.
3. **Tracking:** the drawn corners **spring** toward the smoothed corners (critically damped, ~120 ms), so the
   outline glides with the paper instead of stepping between frames.
4. **HOLD_STILL:** the stroke thickens slightly and a progress sweep runs around the outline (the same path,
   a second stroke from 0 → 1 over the hold time), with the hint "Hold still". Moving the phone rewinds the
   sweep. It does not jump back to zero.
5. **READY → CAPTURING:** the stroke turns to the success colour, a quick shutter dim, a medium haptic,
   then the cropped page **flies from the outline into the page tray**. The morph from the four corners to
   the thumbnail is what makes the crop feel right.
6. **Lost:** the outline fades over ~150 ms after hysteresis expires (§3.2). It never snaps out of sight.
7. **Reduce Motion on:** no draw-in, sweep or fly. The outline appears and the state changes by colour and
   text only. VoiceOver and TalkBack announce states, not every frame, as Genius Scan 6 learned.

**Recrop screen** (after capture, also when a capture's confidence is low, which Genius Scan only plans to
ship): corner handles plus side handles, a magnifier under the finger, and **snapping** to the §4.2
edges, so a dragged corner lands on the real paper edge.

## 6. Steps

| Step | What | Done when |
|---|---|---|
| **L0 Spike** (iOS first) | Native camera view + detector (b) first, then (a) through Core ML + One Euro + the draw-in outline. No gate, no capture. | On a real iPhone: fps, outline lag measured in ms, owner sees it next to VisionKit |
| **L1 Labelled set** | 300 of our photos + corners, plus SmartDoc 2015; scoring harness in `capture-engine`; candidates (a)/(b)/(c) and Apple's own scanner scored | Baseline numbers written into §8 |
| **L2 Precision** | §4.1 fit + §4.2 refinement in TS (the reference), then Swift + Kotlin held to the same expected outputs | Meets the Q-LED3 bar on L1's set |
| **L3 State machine** | §3.2, pure TS, tested on recorded outline sequences; thresholds in `config.ts` | Tests prove each transition fails when it is broken (mutation-checked) |
| **L4 Android** | CameraX view + the §4.5 detector + the same overlay | Same bar on the same set |
| **L5 Product** | `RawCaptureProvider` behind the seam, OS scanner as fallback, recrop screen, raw original kept as the original of record (Phase 4's `{id}.original.jpg`) | Device session on both platforms; `capture_metrics` rows land |

Each native step bumps `apps/driver/runtime-version.json` and runs the §3.4 manual iOS checklist (there is
no iOS CI job). **Size estimate:** L0 3–4 days; L1–L3 ~2 weeks; L4 2–3 weeks, more if a model has to be
trained; L5 ~1 week. That is **about 6–8 weeks in total**, against a licence for Q-LED1 (b).

**Out of scope for v1:** curved-page flattening, multiple documents in one frame, book mode, and handwriting.

## 7. Open questions

- **Q-LED1 Build or buy? — ANSWERED 2026-11-20 by the owner: build (a).** The Genius Scan SDK is not
  licensed; it remains the reference whose behaviour §2/§2a describe.
- **Q-LED2 Model weights — HALF ANSWERED 2026-11-20.** *The weights:* Apache-2.0, commercial closed-source
  use, quantisation, fine-tuning and redistribution all permitted. Sources: DocsaidLab's licensing page and
  its author's written reply on DocAligner issue #13 (2026-10-08), "I do not impose any additional
  restrictions on the model weights". *The training data is the open half:* the authors decline to rule on it
  ("Follow each original dataset's license and terms"). Its sets are SmartDoc 2015 (CC BY 4.0), CORD
  (CC BY 4.0), MIDV-2020 (CC BY-SA 2.5), MIDV-500/2019 (licence not found), and synthetic pages built
  from "documents and certificates found online" over an indoor-scenes background set (provenance not
  stated). None of the licences we could read says non-commercial. **Owner ruling needed:**
  (a) ship the published weights, accepting the training-data residue as most vendors do;
  (b) ship only weights WE trained, starting from the same Apache-2.0 architecture with ImageNet backbone
  weights, on our own L1 photos + SmartDoc + CORD + synthetic, which adds about 2–3 weeks;
  (c) ask counsel. **Recommendation:** (a) for development and the field pilot, and (b) before store release
  if counsel (c) says the residue matters. Fine-tuning on our photos happens in either case, because that is
  where the wild-photo gap closes (docap: 0.990 on SmartDoc, 0.702 in the wild).
- **Q-LED3 The precision bar** in §4.4. **Recommendation:** accept the proposed numbers as a starting point,
  and reset them after L1's baseline.
- **Q-LED4** Should the state machine run in JS (one event per detection frame) or natively (ported to Swift
  and Kotlin, held to one test file)? Decide at L0 from measured event latency. **Built natively,
  2026-11-23 (§8, D-LED6):** the owner's gate had to hold the trace and the shutter on the same clock,
  which a JS machine one bridge hop away cannot promise.

## 8. Progress log

- **2026-11-20:** Analysis written. Nothing built.
- **2026-11-20:** Owner answered Q-LED1: build. Industry research added as §2a: five vendor write-ups and
  four open-source codebases. It changed three things: the detector becomes one heatmap corner model on
  both platforms (§4.5); edge snapping becomes a candidate that must prove itself, since docap measured it
  hurting (§4.2); the stillness test moves to raw corners against an anchor, plus a motion-sensor gate (§3.2).
  Next: L0 spike on iPhone.
- **2026-11-20 — L0 built (iOS), not yet run on a phone.** `capture-native` gains a native view,
  `LiveEdgeCameraView` (Swift). It runs AVFoundation at 1080p and Apple's `VNDetectDocumentSegmentationRequest`
  through a sequence handler on every frame it can keep up with (late frames are dropped by AVFoundation,
  not queued). Drawing is native: a `CAShapeLayer` outline that draws itself in over 280 ms, a 12 % tint,
  a light haptic, a fade when the page is lost, and a critically damped spring on the display link. The JS
  side gets throttled events only (≤ 10 Hz: state, detections/s, capture-to-answer ms, confidence). It
  takes no photo.
  · Every decision is in `LiveEdgeGeometry.swift`, which imports only Foundation and CoreGraphics: Vision →
    screen mapping for an aspect-fill preview, the validator (findDocument's 12 % area and 40° skew,
    restated until L2 holds both to one fixture), convex IoU, One Euro (docap's 1.5 / 4), the 3-frame /
    180 ms hysteresis, and the spring. `tests/ios/run-live-edge-tests.sh` compiles it with plain swiftc:
    33 checks, macOS-only like the metric parity run.
  · Mutation-checked: 14 mutants, all killed. One first SURVIVED, the clipper-winding normalisation in
    the IoU, because the test passed the reversed quad as the SUBJECT and never as the clipper. The test
    now does both. The 0.1 s `dt` cap in the spring is a no-op mutant: sub-stepping alone keeps it stable,
    the cap only bounds the work, and its comment now says so.
  · Reached from More → "Live edge prototype", **development builds only** (`__DEV__`, like the design
    gallery). Android gets a message, because its module declares no view until L4.
  · `xcodebuild -scheme CaptureNative` succeeds; metric parity still PASS; runtime 1.2.0 → **1.3.0**.
  · **What L0 still needs is a phone:** a development build on an iPhone, the readout's two numbers
    written here, and the owner's comparison with the Documents tab's VisionKit scanner. A simulator has
    no camera, so nothing about detection can be seen there.

- **2026-11-20 — L1 tooling built and the first numbers are in (SmartDoc 2015, 1,319 frames).**
  `capture-engine/src/edges/` holds the scoring every detector is judged by: the SmartDoc Jaccard index
  (straightened to a unit square; the score is invariant to the target size because a scaling multiplies
  every area by one constant, and a test holds that), the worst corner's error at 1,568 px under the best
  rotation, the label format, and the report against the Q-LED3 bar. 26 tests. Mutation-checked:
  16 mutants, all killed. The first round had five survivors, four of them real gaps (union never larger
  than the target in any case, line-vs-segment crossing, nearest-rank `ceil` vs `round`, the bar's
  `all` ignoring false outlines), each closed with a case. The fifth was a broken mutant: deleting only the
  `if` left a `for` with no body, and a file that does not compile read as "survived". The horizon guard
  is NOT dead code: a randomised search found a non-crossed outline that scores a meaningless 0.125
  without it, and that outline is now the test.
  `tools/edges/`: `vision-detect.swift` (Apple's two detectors on stills, on a Mac: the same Vision
  framework as the phone), `score-edges.ts`, `smartdoc-labels.ts`, `docaligner.ts` (candidate (a) through
  onnxruntime-node 1.30.0, the version `apps/api` already uses, with the authors' pre/post-processing),
  `import-photos.ts` (copies into the gitignored `fixtures/real/private/edges/`, renamed by content hash),
  and `label.html` (a no-network corner labeller with a magnifier, driven end to end in Chromium:
  clicked corners came back in reading order within a pixel of SmartDoc's truth). How-to:
  `tools/edges/README.md`.

  | SmartDoc 2015, every 20th frame | JI mean | JI p5 | corner median | corner p95 | missed | background05 JI |
  |---|---|---|---|---|---|---|
  | **(a) DocAligner lcnet100** | **0.989** | **0.982** | **2.7 px** | **5.4 px** | 0 % | **0.986** |
  | (b) Apple document segmentation (what L0 runs) | 0.943 | 0.798 | 8.7 px | 90.7 px | 0 % | 0.733 |
  | Apple rectangles (WeScan settings) | 0.786 | 0.000 | 4.7 px | 16.5 px | 17.4 % | 0.003 |
  | findDocument (applicant-photo finder) | 0.012 | 0.000 | 6.5 px | 255.8 px | 98.7 % | 0.000 |

  · **The scorer is validated by an outside number:** our run of lcnet100 gives 0.989, and the authors
    publish 0.9892 for it. A wrong Jaccard, a wrong straightening or a wrong pre-processing would not
    land on the published figure.
  · **⚠ (a)'s SmartDoc score is flattering:** SmartDoc 2015 is in DocAligner's training data. It shows the
    pipeline is right, not how it does on a truck seat. **Our own L1 photos are the real test**, and the
    reason they matter more than any public number.
  · **(b), the detector in today's L0 prototype, is not precise enough by itself:** 8.7 px typical, and it
    collapses on the cluttered background05 (0.733; 5th percentile 0.19). This is the industry's lesson
    (§2a practice 1–2) measured on our own scorer. **L0 should switch to (a) through Core ML.**
  · **(a) passes 3 of 4 bar lines; the typical corner is 2.7 px against 2.** That is the gap §4.2's
    refinement exists for. It is now an experiment with a number to beat instead of a hope.
  · findDocument was built for framed applicant photos, where the border is table. Here the table runs to
    the frame edge, and it refuses by design (D-PCL5). It is not a live-detection candidate, and the
    two-generator OpenCV baseline (c) stays unbuilt unless (a) is ruled out.
  · Speeds are a Mac's (Apple's detectors native; DocAligner's 77 ms is mostly our JavaScript
    post-processing at 1,568 px), and they say nothing about a phone.

  **Next (L2):** our own photos (owner/office: ~300 per `tools/edges/README.md` §1), then the §4.2
  refinement scored against plain (a) on both sets, then (a) converted to Core ML for L0. Q-LED2 waits on
  the owner.

- **2026-11-23 — The capture gate (owner's rule, D-LED6) built into the iOS camera; on the owner's iPhone.**
  The owner, on a phone: "when we open the scanner and point it at a document, the app must not take the
  scan before the camera and the document are in a position that ensures our normalisation is decent; the
  edge animation must not start until those conditions are met; and when the animation ends, it takes the
  scan." **D-LED6** replaces §5 steps 2 and 4: nothing is drawn while a condition fails (one line of
  words says which), the outline TRACES itself once every condition holds, the trace IS the hold, and its
  end takes the photo. A condition breaking mid-trace rewinds it.
  · Conditions, in the order the driver is told them (`LiveCaptureGate.swift`, starting values with their
    sources): a page found (3 frames); every corner ≥ 1.5 % inside the frame; page ≥ 25 % of the frame;
    corners within 20° of square and opposite edges within 0.8 of each other (straightening stays even);
    straightened long edge ≥ the quality gate's `resolutionMinLongEdgePx`, passed in from the signed
    capture config, not restated; camera not focusing or adjusting exposure; motion sensors calm
    (ScanFromCam's 0.18/0.28 m/s², plus rotation); raw corners held within 1.5 % of the diagonal of an
    anchor for 0.2 s before the trace and through its 0.8 s. Re-arm after a shot only when the page has
    gone 0.5 s or a different page has been seen for 3 frames.
  · **D-LED7:** the preview frames and the photo now share one 4:3 field of view (a 4:3 format ≤ 1920 px
    wide, photos at the format's full resolution). The L0 1080p preset was 16:9, a crop the photo does
    not share, so corners from it would have landed in the wrong place on the photo.
  · The photo: the full-resolution original is kept; a page straightened by Core Image's perspective
    correction is shown on the screen so the owner can judge the gate. That page is a PREVIEW, not the
    product's normalisation — L2 refines the corners on the full-res photo, and L5 sends the original
    through `capture-engine`. Nothing uploads.
  · Q-LED4 answered by building: the gate runs natively (Swift), one decision file tested without a
    camera; JS gets events only on gate transitions and at 10 Hz. Android's port follows at L4.
  · Checks: `tests/ios/run-live-edge-tests.sh` 66 checks; four mutations (no anchor test in the trace,
    fire at once, no settle, no motion gate) each fail it. `CaptureNative` compiles for iOS. Runtime 1.5.0.
  · Still the spike's route (More → "Live edge prototype", development builds). "Capture BOL" still opens
    VisionKit until L5 puts this camera behind the provider seam.

- **2026-11-23 — One scanner for every document (owner), L5's seam built for iPhone.** The owner: "we are
  using the same scanner for all documents", the outline animates around the page edge, the animation's
  end takes the scan, and the existing pipeline does the rest. So:
  · `app/scan.tsx` is the scanner screen (our camera + D-LED6 gate, page count, Done, Close). A capture
    provider opens it through `src/capture/scanSession.ts` and awaits the pages.
  · Native `processPages` runs those pages through the SAME `ImagePipeline` VisionKit's pages use
    (original, derivative, hash, on-device OCR); `nativeSystemScannerProvider` takes a `PageSource`, so
    measurement, `assemblePage` and the §5 gate are one code path whichever camera took the page. The
    record names the camera: `capture.native.live_edge` / `raw_capture`, `osEnhanced: false`.
  · `engine.ts` picks our camera wherever it exists (iPhone, runtime 1.5.0+), else the OS scanner, else
    the plain camera. Capture BOL and a stop's BOL slot (`isDocumentSlot`, shared contract) both call
    `scanDocument`; trailer, seal and damage stay plain photos. `decideCapture` moved to
    `src/capture/captureDecision.ts` so both flows refuse and word a bad page identically.
  · Android keeps ML Kit's scanner behind the same call until L4.
  · Driver 576 tests, shared 18, Swift 66 checks; `CaptureNative` compiles; three mutants killed
    (session not superseding, empty finish as a scan, a non-document slot scanned).

## Sources

- Genius Scan SDK: https://geniusscansdk.com/features/ ·
  https://geniusscansdk.com/docs/v6/custom-integration/ui-components/ ·
  https://geniusscansdk.com/docs/changelog/ ·
  https://geniusscansdk.com/docs/v4/android/custom-scanner-guide/ ·
  https://geniusscansdk.com/blog/2026/06/production-camera-stack-edge-cases
- Apple, WWDC21 "Extract document data using Vision": https://developer.apple.com/videos/play/wwdc2021/10041/
- Segmentation + rectangle detection combined in production: https://dev.to/oddeggs/one-camera-for-qr-codes-and-receipts-with-apple-vision-76f
- U-Net document localisation (cites LDRNet): https://arxiv.org/pdf/2310.00937
- Genius Scan, "Document Detection — How Deep Learning Has Changed The Game" (2024): https://blog.thegrizzlylabs.com/2024/10/document-detection.html
- Readdle, "Inside ScannerPro: the Tech behind perfect scans": https://readdle.com/blog/scanner-pro-border-detection
- Dropbox, "Fast and Accurate Document Detection for Scanning" (2016): https://dropbox.tech/machine-learning/fast-and-accurate-document-detection-for-scanning
- KingSoft WPS on TensorFlow Lite (2019): https://blog.tensorflow.org/2019/12/kingsoft-wps-document-image-dewarping.html
- Scanbot, document edge detection with OpenCV: https://scanbot.io/techblog/document-edge-detection-with-opencv/
- Dynamsoft QuadStabilizer: https://www.dynamsoft.com/codepool/build-flutter-mobile-document-scanner.html · https://www.dynamsoft.com/codepool/android-document-scanner.html
- Receipt corners as detected objects, 85.3 % vs 36.9 % classical: https://arxiv.org/abs/2303.05763
- Open source read at source level: https://github.com/WeTransfer/WeScan (MIT, archived) · https://github.com/JaMoLpE88/ScanFromCam (Apache-2.0) · https://github.com/DocsaidLab/DocAligner (Apache-2.0 code) · https://github.com/rydn/docap (MIT)
- SmartDoc 2015 challenge 1: https://marcalr.github.io/pdfs/ICDAR15e.pdf · https://github.com/jchazalon/smartdoc15-ch1-dataset
- One Euro filter: https://gery.casiez.net/1euro/
