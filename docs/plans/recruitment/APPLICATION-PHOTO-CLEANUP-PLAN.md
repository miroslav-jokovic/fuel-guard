# Applicant photo cleanup: a straight, evenly lit, small copy beside the untouched original (2026-11-16)

Decision IDs `D-PCL*`, owner questions `Q-PCL*` (prefix unused elsewhere as of 2026-11-16).
Parent: `APPLICATION-FIX-PLAN.md` §7 (Q-AM19's second half, "photo straightening and evening", was left to
the scanner programme's Phase 6). Owner's instruction, verbatim: *"lets analyze and lets now build our image
normalization and optimization, please research on web best way to do this"*.

## 1. What is true today (measured 2026-11-16)

- **The photo the office reads is the photo the phone made**, downscaled to a 1,568 px long edge and
  re-encoded (`webFileProvider.ts`): WebP q80 where the browser can, JPEG where it cannot (every iPhone —
  Safari's canvas does not encode WebP). The in-page scanner crops to the outline the driver aimed at, plus
  a 6% margin (`useLiveScan.ts` `CROP_MARGIN`), as an axis-aligned rectangle. Nothing is straightened,
  nothing is evened, nothing is white-balanced. A gallery upload is not cropped at all.
- **Production holds 13 applicant photos.** Read through `computeMetrics` on upload (`captureVerification.ts`):

  | | median | range |
  |---|---|---|
  | `brightnessMean` (0–1; clean white paper ≈ 0.85+) | 0.55 | 0.08 – 0.76 |
  | `shadowRange` (0 = even light, 1 = one corner black) | 0.46 | 0.21 – 1.00 |
  | `glareFraction` | 0.0002 | 0 – 0.24 (one licence front) |
  | file size | 263 KB | 124 KB (WebP) – 643 KB (JPEG) |

  So the common defect is **uneven, dim light**, which processing can repair, not glare, which it cannot
  (blown pixels hold no information; that licence is a re-shoot, and the re-shoot floor waits on D-SCAN10).
- The office sees the bytes through `applicantDocuments.ts`; filing copies the same bytes into the driver's
  file (`copyCaptureIntoFile`, `documents` = evidence, append-only).
- **Optimisation for FILED documents already exists** (DQF plan B1–B3, `packages/shared/src/documentDerivatives.ts`,
  `apps/api/src/modules/evidence/documentDerivatives.ts`, queue job `document_derive`): every filed image gets a
  `thumb` (320 px, q65) and a `normalized` (2,000 px, q82) WebP, each its own append-only `documents` row linked by
  `derived_from`, the original untouched. Those two are resize + encode ONLY, on purpose — see §3a.

## 2. What the research says (2026-11-16)

- **Geometry** — the standard pipeline is: find the document's four corners on a downscaled frame, refine,
  then warp the full-resolution frame with a homography by inverse mapping (for each output pixel, sample the
  source bilinearly). OpenCV.js does it in an 8–30 MB download; the projects that measured it have moved to
  small dependency-free TypeScript: Stirling-PDF replaced opencv.js + jscanify with two TS modules and
  *improved* SmartDoc 2015 accuracy (mean IoU 0.831 → 0.899, median corner error 17.4 → 5.7 px), falling back
  to the unwarped image when no page is found. `@quannqit/doc-scanner` (MIT, ~6 kB) proposes candidates from
  colour (bright, low-saturation regions under several Otsu thresholds, closed then opened) and from straight
  edges, and scores each quad by how much of its outline lies on a consistent step edge.
- **Light** — the classic, explainable method is *divide by the estimated background*: estimate the slowly
  varying paper colour per channel at a scale larger than the text (max/closing to remove ink, then blur),
  divide, cap the gain so a dark fold cannot explode, and land the paper on neutral white from the same
  estimate (white balance for free). The deep-learning methods (CVPR 2023 BGShadowNet, UDoc-GAN) estimate the
  same background with a network; nothing here justifies a model.
- **What must not be destroyed** — scanner-plan D-SCAN11 already says it: signatures, coloured stamps,
  highlighter, red hazmat marks. Never binarise; preserve colour.

Sources: github.com/Stirling-Tools/Stirling-PDF/pull/8719 · github.com/quannqit/doc-scanner ·
github.com/marquaye/scanic · github.com/yashaswikaahuja/wa-drive/issues/345 (divide-by-background recipe) ·
arxiv.org/pdf/1904.09763 (Water-Filling) · CVPR 2023 "Document Image Shadow Removal Guided by Color-Aware
Background".

## 3. Decisions

**D-PCL1 — The original is never altered; the clean copy is a derivative beside it.** The driver's photo is
evidence of what they sent. The clean copy is reproducible from the original and an algorithm version, so it
is stored with that version and can be rebuilt when the algorithm improves. Same rule as D-SCAN11.

**D-PCL2 — It runs on the server, in the worker, not in the phone.** One implementation instead of one per
browser; tested in CI against the fixture corpus; versioned; re-runnable over old photos; it serves every
path that produces a photo (live scanner, gallery, PDF, the documents-only link) and later the driver app.
The phone keeps doing what it does well — aim, crop, downscale. Cost: the API has one vCPU, and verification
alone was measured at 35–79 ms inline, so the cleanup is a queue job after verification, never inline.

**D-PCL3 — The algorithms live in `@silvicom/capture-engine`, pure and zero-dependency**, on raw RGB
buffers, beside `metrics.ts` — so a later browser preview or native port reads the same definition. No
OpenCV, no WASM, no model (D-SCAN plan §7's evidence rule stands).

**D-PCL4 — One profile per photo SHAPE, derived from the slot, never restated.** The shape (card / page /
face / mark) is already said once, in the web's `LIVE_SLOTS`; it moves to `@silvicom/shared` beside the slot
list, and both the scanner's outline and the cleanup read it.
  - **page** (certificates, letters, "other"): straighten; divide by the background; paper to white.
  - **card** (CDL, TWIC, SSN card, passport, work permit): straighten; *global* white balance and levels only.
    A card's printed background is not white paper, and dividing by a local background would bleach its design.
  - **face** (selfie) and **mark** (drawn signature/initials): untouched. No clean copy is made.

**D-PCL5 — No document found means no warp, never a guess.** Corner detection returns a quad and a
confidence or nothing. Nothing → the clean copy is the light correction alone on the photo as framed (the
scanner's crop already bounds it). A bad warp is worse than none.

**D-PCL6 — Optimisation is the clean copy's encoding**: WebP at the config long edge. An evened background
compresses far better than a shadow gradient; the saving is measured on the corpus, not promised here.

## 3a. ⚠ The rule this plan meets, found 2026-11-16 after P1 was built

`documentDerivatives.ts` (B1) records why a filed document's derivatives may only auto-orient, resize and encode:
*"legibility changes the evidence — acceptable as extraction input, unacceptable as output a human — a DOT
auditor — looks at to decide whether a medical card is valid."* The hazmat normaliser's `.normalise()` and
`.median(1)` were refused for exactly that reason. A clean copy (straightened, light evened) is that kind of
change, so where it may be SHOWN is the owner's to rule (Q-PCL1), and P2–P4 wait on it. P1 is unaffected:
it is pure, has no caller, and serves every answer (for (c) it is machine input only).

## 4. Steps

| Step | What | Migration | Status |
|---|---|---|---|
| P1 | `capture-engine/src/enhance/`: homography + bilinear warp, document quad detection, illumination (page), levelling + white balance (card); fixture tests incl. a synthetic tilt with a known homography and a coloured stamp's hue | none | built |
| P2+P3 | **Waits on Q-PCL1.** If (a): a new table `application_capture_cleans` (capture id, the ORIGINAL's `server_sha256` it was made from — a re-shoot makes it stale by construction — version, quad, path, bytes) in its own bucket, shipped with its writer (a queue job after verification); the bucket gets its own line in the orphan sweep, which also clears it after an applicant purge (rows cascade). The photo's shape moves from the web's `LIVE_SLOTS` to `@silvicom/shared` (D-PCL4). Backfill over existing captures. | 0622 or next | blocked |
| P4 | **Waits on Q-PCL1.** The office drawer shows the clean copy, labelled as cleaned, with "Show original" one click away | none | blocked |

## 4a. What is deliberately not built, and what would open it

- **Edge-based corner candidates** (doc-scanner's Hough lines; Stirling-PDF's step-edge scorer). The colour
  finder refuses a document whose colour matches the table (white page on a white desk). Opens when P3's
  rows show a material share of page photos with `clean_quad` null — that share is the measurement.
- **Sub-pixel corner refinement.** Corners are found at 512 px and land within ~5 px at 1,200–1,500 px in
  the fixtures. Opens if the office sees a document's edge trimmed or a sliver of table in a clean copy.
- **A preview in the browser.** The engine is pure, so the driver could see the clean copy before sending.
  Not before the server's copies have been looked at on real photos.
- **Glare.** No processing recovers a blown pixel. The licence photo with 24% glare is a re-shoot, which
  waits on D-SCAN10's measured floors.

## 5. Owner questions

**Q-PCL1 — Where may a cleaned (straightened, light-evened) copy of a photo be SHOWN to a person?**
B1's rule (§3a) is that anything a person looks at to judge a document is the document as photographed.
- (a) **The office's review of an applicant, only** — the recruiter reading a licence number, a name, an expiry
  before deciding to move the applicant on. Labelled "Cleaned for reading", with "Show original" one click
  away. Filing, the driver's file, the DQ viewer and every export keep the original and B1's resize-only copies.
- (b) (a), **and** a third derivative of every filed image (`variant = 'clean'`, a `documents` row linked by
  `derived_from` like `thumb`/`normalized`), shown in the file viewer with the same label. Amends B1; exports
  and the binder still use originals.
- (c) **Nowhere.** The clean copy is machine input only (reading a licence number, OCR), exactly B1's line.
*Recommendation: (a).* It is where the problem was seen (the office squinting at a shadowed licence photo in
the drawer), the decision made there is a recruiter's working decision rather than a compliance one, and it
leaves B1 — and what an auditor sees — exactly as it is. (b) can follow if the office asks for it in the file.

## 6. Progress log

- 2026-11-16: plan written; P1 started on `claude/application-photo-normalize`.
- 2026-11-16: **P1 built** — `packages/capture-engine/src/enhance/` (`raster`, `homography`, `findDocument`,
  `light`, `levelCard`, `clean`), `CLEAN_VERSION = "pcl-1"`, 33 tests in `tests/enhance.test.ts`.
  - **Every refusal and safeguard is held by a test that fails without it** (mutation-checked): the
    background-inside check, the frame-edge check, the corner-skew check, the fill check, the table-spread
    cap, the page gain cap, the pale-colour reach, the card cast cap, the card's bright-half start, its
    outlier drop and its gain cap.
  - **Two rules were written and removed because nothing could show they mattered**: a floor on Otsu's
    separation (a shadow with no document splits as cleanly as a page on a table) and a minimum table
    spread. One choice is kept and labelled as argued, not measured: hull simplification by
    Visvalingam rather than every k-th point (index sampling passes the suite).
  - **Found by looking, not by the tests:** a page darkened toward one corner was found 77 px inside its
    real corner — Otsu split the sheet's dark half from its bright half. Fixed by capping the threshold at
    twice the table's own spread; the case is now a test.
  - **Measured on the rendered samples** (synthetic, so no sensor noise): a 1,200 × 1,500 page photo cleans
    in ~100 ms on this Mac; WebP q80 of the clean copy 123 KB against 224 KB for the JPEG an iPhone sends
    today (129 KB as WebP); a card 17 KB against 58 KB JPEG. Real photos are noisier; P3 measures them.
  - **Next:** P2/P3 were designed (a table, not columns: the clean copy records the original's hash it was made
    from, so a re-shoot makes it stale without anybody clearing it; its own bucket, because the orphan sweep
    matches one table per bucket and would delete clean files from the captures bucket nightly). **Stopped
    before building** on finding B1's rule (§3a): Q-PCL1 asks the owner where a cleaned copy may be shown.
