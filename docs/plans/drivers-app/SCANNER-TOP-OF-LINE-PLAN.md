# A top-of-the-line document scanner — where we are, what the best do, what to build · 2026-11-23

**Status:** analysis and recommendation; nothing below is built except where it says so. Owner's ask
(2026-11-23): "research and check our documents, and let's see what we can do to have a really top of the
line scanner for documents." Read with `LIVE-EDGE-DETECTION-PLAN.md` (the camera and the outline, D-LED*)
and `SCANNER-UPGRADE-PLAN.md` (the quality gate and the metrics, D-SCAN*); this document does not replace
either, it orders the work across them and adds what neither covers.

## 1. The finding that matters most: drivers' BOLs do not go through a scanner at all

There are four ways a document enters the driver app today:

| Where the driver taps | What opens | Gate, OCR, hash |
|---|---|---|
| Loads → stop → **BOL photo slot** (`app/loads/[id]/stop/[stopId].tsx:100` → `stopCapture.ts:35`) | the phone's **plain camera** (expo-image-picker) | **none** — resized to 1600 px, JPEG quality 0.6 (`stopCapture.ts:21-22,45`) |
| Documents → **Capture BOL** (`app/hazmat/capture.tsx:61`) | iOS **VisionKit**, Android **ML Kit** scanner | yes: resolution, OCR counts, score |
| Same, when the OS scanner is missing | plain camera | resolution only |
| More → Live edge prototype (development builds, iPhone) | **our camera** with the D-LED6 gate | not uploaded |

The stop-photo slot is the one a driver uses on every load. Documents → Capture BOL is the hazmat flow,
and production has never completed a capture through it (scanner plan Q5; `capture_metrics` has 0 rows).
So **the scanner we have been perfecting is not the one drivers use**, and the one they use has no edge
detection, no straightening, no quality check and throws away 40 % of the JPEG quality. Every item below is
wasted unless the BOL slot goes through the scanner (Q-TOP1). The plans already intend this
(BOL plan D-EXR10 / Step 0.0, two-click plan TC4.1–4.2); it has not been built.

## 2. What the best scanners do (research 2026-11-23, sources at the end)

- **Microsoft Lens is gone** (retired; scanning stopped ~March 2026). The leaders are Genius Scan (SDK 6,
  May 2026), Adobe Scan, Scanner Pro, Scanbot (now Apryse), and on the OS side VisionKit and ML Kit.
- **They all auto-shoot, but they judge the picture after it is taken, by readability.** Genius Scan scores
  readability on five levels and catches partial blur; Scanbot scores text sharpness + characters found;
  Veryfi rejects ≥ 20 % blur. All **warn and offer a retake of that page**, none silently accept or hard-block.
- **They pick the sharpest frame from a burst** (Transflo 7.1 did this and cut false blur flags).
- **They manage light:** torch on automatically in low light (Adobe, Veryfi, Transflo's auto-flash +
  low-light alert).
- **They clean the page:** automatic shadow removal on every scan (Scanner Pro, Adobe, CamScanner),
  page-curl flattening (Adobe "Straighten", Nov 2025), finger and stain removal (Adobe, ML Kit FULL).
- **The multi-page flow is a tray:** go back to any page to recrop, rotate, reorder, delete or retake it
  (Genius SDK 6), with large accessibility text.
- **Trucking apps** (Transflo, Samsara, Motive, Trucker Tools): auto-capture by default, auto flash, B/W
  output, offline queue, document type chosen by the driver or classified on the server.
- **iOS 26 adds** `DetectLensSmudgeRequest` (a dirty lens, 0–1) and `RecognizeDocumentsRequest`
  (structured text, tables, barcodes) — both on-device.
- **Buying:** Genius Scan, Scanbot and Dynamsoft are flat annual licences (quote only; Scanbot reported
  from ~$2,500 to ~€20k/yr). Each brings its own capture screen, so they would REPLACE our gate, metrics and
  corner model rather than add to them. The owner chose to build (Q-LED1); nothing found changes that.

## 3. Where we stand against that

| Capability | Best in class | Ours |
|---|---|---|
| Live outline + auto-shot under conditions | yes | **built today, iPhone, development only** (D-LED6) |
| Corner precision | learned corner models | Apple segmentation live (8.7 px median, p95 90.7 px on SmartDoc); DocAligner measured at 2.7 px, not in the app (Q-LED2) |
| Sharpness at the moment of the shot | burst, sharpest frame | **missing** — the D-LED6 gate checks focus-settled and stillness, not sharpness |
| Readability verdict + per-page retake | yes, warn + retake | OCR counts exist on the hazmat path; blur, glare, shadow floors are `null` (retired, D-SCAN10); rejection is all-or-nothing, no per-page retake (F-EX12) |
| Light (torch, glare) | auto torch, glare check | **missing** |
| Shadow / illumination clean-up | automatic | **missing on the driver** — `evenPage` exists in `capture-engine` but only the web applicant flow uses it |
| Page curl flattening | Adobe only | out of scope (LIVE-EDGE §6) |
| Page tray: review, recrop, reorder, retake | yes | **missing** (recrop is L5) |
| Original of record kept untouched | rarely | **yes** (Phase 4, `{id}.original.jpg`) — ahead of most |
| Measured, parity-tested metrics | no vendor publishes this | **yes** (bit-identical iOS/Android/server) — ahead of most |
| Thresholds tuned on real data | vendors' own data | **not tuned** — 0 recorded captures (Step 5.2 blocked) |
| Android parity with our camera | — | ML Kit only (L4 not started) |

We are ahead where it is invisible to a driver (evidence integrity, measurement) and behind where it is
visible (the camera, the light, the clean page, the tray).

## 4. Recommended order

Each step is shippable alone and is judged on a phone. Estimates are working days for one engineer.

**S1 — One scanner for every document (3–5 days).** The stop-photo BOL slot and Capture BOL both open the
same capture screen: our camera on iPhone (D-LED6), ML Kit on Android until S7. The plain camera remains
only as the fallback when neither exists. Keep the original, as Phase 4 does. *This alone moves every
driver's BOL from an unchecked q0.6 photo to a straightened, checked page.* (Q-TOP1)

**S2 — The sharpest frame and a readability check (4–6 days).** (a) Add sharpness to the D-LED6 gate,
relative to the best seen during the hold (plan §3.2 specified it; it is not built). (b) At the shot, take a
short burst and keep the sharpest. (c) After the shot, on-device OCR (already wired: Vision / ML Kit)
decides readable / doubtful / unreadable; doubtful and unreadable pages are shown with "Retake this page".
(d) Tune the floors on **SmartDoc-QA** (4,260 phone photos labelled with OCR accuracy, public) — that
unblocks Step 5.2 without waiting for months of our own captures, which then confirm it. (Q-TOP3)

**S3 — Light (2–3 days).** Torch on automatically when the frame is dark (a truck cab at night), a glare
check inside the outline after it fires, and the hint "Tilt the page away from the light". iOS 26's lens
smudge check on iPhone ("Wipe the camera lens").

**S4 — Precise corners (5–8 days, needs Q-LED2).** DocAligner as Core ML (iPhone) / TFLite (Android),
replacing Apple's segmentation for the shot; Apple's stays as the fast live outline if the model is slower.
Then L2's refinement on the full-resolution photo. Fine-tune on our own photos (the ~300 from L1), because
SmartDoc flatters it (0.989 there, ~0.70 on photos from the wild in docap's measurement).

**S5 — A clean page (4–6 days).** For the copy people read: illumination flattening (shadow of a hand or
the cab roof), using `evenPage` from `capture-engine` ported natively and held to the same fixtures,
mild contrast. Never binarise (the plans ban it — carbon copies lose their faint lines). The original stays
untouched beside it.

**S6 — The page tray (4–5 days).** Thumbnails of every page in this document; tap one to recrop (corner and
side handles, magnifier), rotate, retake or delete; drag to reorder; large text. This is L5's recrop screen
plus F-EX12's per-page retake.

**S7 — Android, our camera (10–15 days).** CameraX view, the same gate ported to Kotlin and held to the
same checks file as Swift (as `CaptureMetrics` is), S2–S5 on Android. Until then Android keeps ML Kit, which
already removes shadows, stains and fingers in FULL mode. (Q-TOP4)

**S8 — Later, each on its own number:** page-curl flattening (UVDoc, 8 M parameters, warps the
full-resolution photo; ship only with a "did the lines get straighter" check); glare removal by combining
two or three frames (Google PhotoScan's method; no document app ships it); compact PDF per document (Q-TOP5).

**Not recommended:** finger and stain removal by repainting pixels. A BOL is evidence; a scanner that
paints over part of it can paint over a signature or a number. Flatten light, never invent content.

**Total S1–S6 (iPhone first):** about 4–5 weeks; S7 adds 2–3. The device session the scanner plan has
owed since September (D-SCAN13) happens naturally inside S1–S2: the owner's phone is already running the
development build.

## 5. Open questions

- **Q-TOP1 Does the stop-photo BOL slot go through the scanner?** (a) yes, every BOL photo is a scan;
  (b) only when the load is hazmat; (c) leave it a photo. **Recommendation: (a).** It is the path drivers
  actually use, and plans D-EXR10 / TC4.1 already intend it.
- **Q-TOP2 = Q-LED2 (model weights).** **Recommendation:** (a) ship DocAligner's published weights for
  development and the pilot; train our own before store release only if counsel says the training-data
  residue matters.
- **Q-TOP3 An unreadable page: warn or refuse?** (a) warn, "Retake this page" first, "Use anyway" second;
  (b) refuse below a hard floor, warn above it; (c) always refuse. **Recommendation: (b)** — every vendor
  warns, but a hard floor for "nothing readable at all" stops a black photo from becoming a delivered load.
- **Q-TOP4 Android until S7:** (a) keep ML Kit (free, removes stains and shadows, closed screen, no gate of
  ours); (b) build S7 first. **Recommendation: (a)**, iPhone proves the design first.
- **Q-TOP5 Does the office need a PDF per document** (for McLeod imaging, the customer, factoring), or are
  page JPEGs enough? Ask the office; it decides whether S8's PDF is needed at all.

## 6. Progress log

- **2026-11-23:** Analysis written from a read of the six scanner plans and the code, plus a market and
  research survey. The D-LED6 capture gate (outline traces only when the page is placed well and the phone is
  still; the trace's end shoots) was built the same day and is on the owner's iPhone (LIVE-EDGE §8).

## Sources

Genius Scan SDK 6: https://blog.thegrizzlylabs.com/2026/05/announcing-genius-scan-sdk-6.html ·
blur detection: https://geniusscansdk.com/docs/v5/document-scanning/blur-detection/ ·
transportation: https://geniusscansdk.com/industries/transportation/ ·
Scanbot quality analyzer: https://scanbot.io/blog/enhanced-document-quality-analyzer/ ·
Veryfi Lens: https://docs.veryfi.com/lens/mobile/settings/ ·
Scanner Pro shadows: https://readdle.com/blog/why-scanner-pro-scans-look-better-than-ever ·
Adobe Scan: https://apps.apple.com/us/app/adobe-scan-pdf-doc-scanner/id1199564834 ·
Microsoft Lens retired: https://www.neowin.net/news/microsoft-lens-has-been-retired/ ·
ML Kit document scanner: https://android-developers.googleblog.com/2024/02/ml-kit-document-scanner-api.html ·
WWDC25 Vision (smudge, RecognizeDocuments): https://developer.apple.com/videos/play/wwdc2025/272/ ·
Transflo engine and 7.1 release notes: https://www.transflo.com/news/transflo-announces-all-new-scanning-engine/ ·
https://knowledge.transflo.com/mobile-plus/Content/03mobi/mobile-plus-release-notes.htm ·
Samsara driver documents: https://kb.samsara.com/hc/en-us/articles/4411269041549-Driver-Documents ·
UVDoc: https://arxiv.org/pdf/2302.02887 · PhotoScan glare: https://research.google/blog/photoscan-taking-glare-free-pictures-of-pictures/ ·
SmartDoc-QA: https://zenodo.org/record/5293201 · DocIQ: https://arxiv.org/pdf/2509.17012 ·
Genius Scan licensing: https://geniusscansdk.com/license/licensing/ ·
Dynamsoft pricing: https://www.dynamsoft.com/mobile-document-scanner/ask-for-quote/
