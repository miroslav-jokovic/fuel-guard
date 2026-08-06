# Document Capture Engine — Architecture & Roadmap (v0.3, design-first)

**Status:** DESIGN — approval gate before native code · **Owner surface:** `apps/driver` (FuelGuard, built/tested first) · **Reuse target:** HazmatGuard driver app (PLAN.md N4/M6.0)

**Decision record**
- **2026-08-06a:** CV core = **self-built, no paid vendor.** Free, on-device, first-party OS + permissive-OSS building blocks behind our own API. Nothing leaves the device.
- **2026-08-06a:** v1 = **reliable core subset**; provider seam keeps the core swappable.
- **2026-08-06b:** `textVisibility` → concrete **OCR legibility gate** (§5); optional **OCR numeric cross-check** in extraction (§6).
- **2026-08-06c (research-resolved — supersedes the earlier "open questions"):** the §12 register is now **closed with decisions**. Two findings reshaped the design and are reflected below:
  1. **The OS system scanners are crop-only black boxes.** Apple `VNDocumentCameraViewController` and Android ML Kit `GmsDocumentScanner` both return only a **finished, cropped, enhanced page image — no raw frame, no corner quad.** So "our own quality gate + enhancement on the raw image" and using the OS scanner UI are **mutually exclusive.** → **v1 = SystemScanner provider (accept the crop, gate/enhance/OCR on it); v2 = RawCapture provider** (our camera + Apple `VNDetectDocumentSegmentationRequest` / OpenCV) for full raw-frame control, built only if measured-needed.
  2. **On-device OCR confidence is unreliable on both platforms** (iOS quantizes to ~0.5/1.0; Android's is documented but historically flaky with a silent "returns 0" failure mode). → the legibility gate is **redesigned to lead with geometry + coverage signals**, which both platforms expose reliably; confidence is a secondary, platform-tuned signal only (§5).

> **Single responsibility of the scanner.** Produce the cleanest usable document image and **reject** anything unfit for reliable reading. Not an OCR engine, not a parser. It uses text recognition only as a legibility *signal*, never extracts meaning, never guesses, never alters text. It preserves the received image as the evidentiary record.

---

## 0. Two governing principles

**P1 — Measurable, configurable, testable; no magic numbers.** Every threshold/parameter lives in a **versioned config**, tunable on real truck-cab data without an app release, and stamped on every capture and every hazmat run beside `engineVersion`/`datasetVersion`/`PLACARD_ART_VERSION`.

**P2 — The core is a swappable provider.** Our public API, quality gate, config, and result contract sit *above* the provider seam. "Self-built, no vendor" = our provider is internal. v1 and v2 are two providers behind one unchanging API.

---

## 1. Layered architecture

```
 React Native / TS       ← public API ONLY: scan / analyze / enhance / recognizeText / cancel / isSupported
        │  Expo Modules API (TurboModule, New Architecture)
        ▼
 Capture Orchestrator (native, thin, per-platform)
        │
        ├─► Capture Provider  ◄── swap seam #1
        │      • SystemScannerProvider  (v1 — iOS VNDocumentCameraViewController / Android GmsDocumentScanner; CROP-ONLY)
        │      • RawCaptureProvider      (v2 — our camera + iOS VNDetectDocumentSegmentationRequest / Android OpenCV; raw frame + quad)
        │
        ├─► OCR Provider  ◄── swap seam #2  (iOS Vision VNRecognizeText / Android ML Kit Text Recognition v2)
        │      → feeds the legibility gate (§5) and the numeric cross-check (§6)
        │
        ├─► Quality Validation Engine (OUR code, config-driven) — accept/reject; incl. OCR legibility gate
        │
        └─► Result Assembler — original-of-record · model-facing + archive derivatives · quality report · OCR evidence · SHA-256
```

**Build v1 as a thin custom Expo module over the OS APIs, not a third-party wrapper.** Research showed every third-party RN wrapper's New-Architecture support on Expo 57 / RN 0.86 is unconfirmed, and none expose more than the crop anyway. The OS scanner + OS OCR are a handful of native calls; wrapping them ourselves via the Expo Modules API gives a New-Arch-native, dependency-light, stable API we fully control — and removes the single largest compatibility risk. Existing wrappers are reference/fallback only.

---

## 2. Public API (identical on both platforms)

```ts
// @capture/engine — the only surface other modules touch.
export function isSupported(): Promise<SupportResult>;                 // camera + doc-scanner + OCR + (Android) Play-Services module state
export function scan(options?: ScanOptions): Promise<ScanResult>;
export function analyze(image: ImageRef): Promise<QualityReport>;
export function enhance(image: ImageRef, opts?: EnhanceOptions): Promise<Derivatives>;
export function recognizeText(image: ImageRef, opts?: OcrOptions): Promise<OcrResult>;
export function cancel(): void;

export interface CapturedPage {
  originalOfRecord:     ImageRef;   // v1: the OS scanner's returned page (hashed, preserved). v2: the raw captured frame.
  perspectiveCorrected: ImageRef;   // v1: same as originalOfRecord (OS already corrected). v2: our correction from the quad.
  enhancedColor:        ImageRef;
  enhancedGray:         ImageRef;
  quality:              QualityReport;
  ocr:                  OcrEvidence;      // legibility metrics + number tokens (a SIGNAL, never stored as content)
  metadata:             CaptureMetadata;  // provider id+version, ocr engine id+version, timings, device
  integrityHash:        string;           // sha256 over originalOfRecord bytes
  provenance:           { captureMode: 'system_scanner' | 'raw_capture'; osEnhanced: boolean };
}

export type CheckName =
  | 'documentDetected' | 'coverage' | 'blur' | 'glare' | 'shadow'
  | 'brightness' | 'contrast' | 'resolution'
  | 'ocrLegibility'                         // §5 — geometry/coverage-led, confidence secondary
  | 'perspectiveSeverity' | 'lensSmudge';   // v2-only (need the raw frame/quad); reported 'n/a' in v1
```

**Rejection taxonomy:** `DOCUMENT_NOT_DETECTED · IMAGE_BLURRED · GLARE_OVER_TEXT · SHADOW_OVER_TEXT · RESOLUTION_TOO_LOW · LENS_DIRTY · PAGE_INCOMPLETE · LOW_CONTRAST · UNDER_OR_OVER_EXPOSED · TEXT_ILLEGIBLE · OCR_UNAVAILABLE · SCANNER_MODULE_UNAVAILABLE · UNSUPPORTED_DEVICE · CAPTURE_CANCELLED · PROVIDER_ERROR`

`SCANNER_MODULE_UNAVAILABLE` is Android-specific (Play-Services scanner module absent/not-yet-downloaded — §9).

---

## 3. What v1 gives up vs v2 (stated plainly)

| Capability | v1 SystemScanner | v2 RawCapture |
|---|---|---|
| Effort | Low (thin module over OS UI) | High (custom camera + segmentation/OpenCV) |
| Raw sensor frame | ❌ not available | ✅ |
| Document corner quad | ❌ not available | ✅ (iOS `VNDetectDocumentSegmentationRequest`; Android OpenCV contours) |
| Our own perspective/enhancement on raw | ❌ (OS already cropped+enhanced) | ✅ deterministic, versioned |
| Reproducible/auditable transform | ⚠️ OS enhancement is a black box, varies by OS version | ✅ our transform, versioned |
| Blur/glare/shadow/perspective gates | on the OS output only | on the raw frame |
| OCR legibility gate (§5) | ✅ on the returned image | ✅ |
| Numeric cross-check (§6) | ✅ | ✅ |
| Android dependency | Play Services scanner module (§9) | none (OpenCV bundled) |

**v1 is honest about the trade:** we accept the OS scanner's polished crop as the *original of record* (hashed, preserved) and run our gate/OCR/derivatives on it. We do **not** claim to control capture or own the enhancement in v1. v2 is the path to full raw-frame control and a fully reproducible, auditable transform — built behind the same API when measurement (or the Play-Services constraint) justifies it.

---

## 4. Versioned configuration (P1)

```jsonc
{
  "configVersion": "capture-2026.08.0",
  "gates": {
    "blurLaplacianVarMin": 120, "glareClippedFractionMax": 0.06, "shadowRangeMax": 0.55,
    "coverageMinFraction": 0.60, "brightnessMeanRange": [0.35, 0.85], "contrastRmsMin": 0.18,
    "resolutionMinLongEdgePx": 1600, "overallAcceptScoreMin": 0.75
  },
  "ocrLegibility": {                          // §5 — geometry/coverage FIRST, confidence secondary
    "enabled": true, "ocrMode": "accurate",
    "minRecognizedChars": 80, "minRecognizedWords": 20,
    "textCoverageFractionMin": 0.08,
    "minMedianCharHeightPx": 16,              // ML Kit legibility floor; Apple similar
    "smallTextBandCoverageMin": 0.02,
    "confidenceSignal": { "use": "secondary", "meanMin": 0.50, "platformOverrides": { "ios": {}, "android": {} } }
  },
  "enhance": {
    "modelFacing":  { "longEdgePx": 1568, "format": "webp", "quality": 80, "conservative": true },
    "archiveFacing":{ "illuminationNormalize": true, "localContrast": "adaptiveThreshold_or_clahe_v2", "denoise": "gentle",
                      "whiteBalance": true, "edgeAwareSharpen": "low", "binarize": false }
  },
  "delivery": { "minConfigVersionMonotonic": true, "signatureRequired": true }
}
```

Notes carried from research: `localContrast` cannot assume CLAHE — `react-native-fast-opencv` does **not** expose CLAHE/`equalizeHist`, so v2 enhancement uses `adaptiveThreshold`-based local contrast (or a CLAHE we add in C++). Not on the v1 path (OS enhances). `confidenceSignal.use: "secondary"` encodes the OCR-confidence finding directly in config.

---

## 5. OCR legibility gate — redesigned around reliable signals

**Why redesigned.** Research: **neither** platform gives a trustworthy word-confidence. iOS Vision quantizes to ~0.5/1.0 in `.accurate` mode; Android ML Kit documents `getConfidence()` 0..1 but it is historically unreliable for Latin and can silently return `0`. A gate built on confidence would be non-portable and brittle. **Both platforms *do* reliably expose geometry:** recognized text with per-element bounding boxes, corner points, and character/symbol sizes.

**Logic (geometry + coverage first):**

```
input: page image (v1: OS crop; v2: our corrected image), ocrLegibility config
1. ocr = OcrProvider.recognizeText(image, mode)          // elements[]: {text, box, cornerPoints, (confidence?)}
2. reliable metrics (portable across both platforms):
     recognizedChars       = Σ len(element.text)
     recognizedWords/elems  = count(elements)
     textCoverageFraction  = union_area(element.box) / document_area
     medianCharHeightPx     = median glyph height (from element box height / char count)   // legibility floor
     smallTextBandCoverage  = coverage in the smallest-height quartile                    // fine print survives?
3. secondary (coarse, platform-tuned, NEVER the sole basis):
     meanConfidence         = mean(element.confidence)   // used only if present + a spread of non-zero values seen
4. passed = recognizedChars>=min & words>=min & textCoverageFraction>=min
          & medianCharHeightPx>=min & smallTextBandCoverage>=min
          & (confidence unavailable OR meanConfidence>=platformMin)     // confidence can only ADD caution, not rescue
5. fail → map to rejection reason (coverage/char low → PAGE_INCOMPLETE/DOCUMENT_NOT_DETECTED;
          height/legibility low → TEXT_ILLEGIBLE; ocr threw → OCR_UNAVAILABLE, degrade to image-only gates + flag)
output: CheckResult{score, confidence, passed, diagnostics: all metrics}  + OcrEvidence for the assembler
```

Enterprise properties unchanged: legibility-not-correctness; OCR engine id+version recorded; degraded mode fails **closed** (never silent-pass); runs on the final frame, not every preview frame; thresholds tuned per platform on the golden set (§10). The confidence caveat is now encoded in both the design and the config.

---

## 6. OCR numeric cross-check (extraction cross-validation — server)

Unchanged in intent; **confirmed feasible** by research and independent of the confidence problem (we compare digit **tokens**, not confidence). Lives in `apps/api/src/services/hazmatExtraction/crossValidate.ts`, config-gated **off** until proven on the golden corpus.

- **Token source (resolved):** the **on-device** `OcrEvidence.numberTokens` (recognized-text is reliably available on both platforms) ride up with the upload — free, offline, no new server infra. A **server-side Tesseract worker** stays the documented alternative *only if* golden-corpus recall proves insufficient.
- **Rule (unchanged):** OCR may only **add** a `needs_review` flag on an uncorroborated UN/NA number; it never overrides Claude, never rewrites a number, never clears a flag. Disagreement → human. Provenance stamped on the run.

---

## 7. Compliance-pipeline integration

```
scan() → CapturedPage[] (incl. OcrEvidence) → offline outbox → API
   → server image.ts backstop (Phase 1, D11/D12) → orchestrate → extraction (Claude dual-pass)
   → crossValidate (+ §6) → verdict
```

New additive run fields (driver-capture milestone): `capture_config_version`, `capture_quality`, `ocr_evidence`, `integrity_hash`, `capture_mode` (`system_scanner`|`raw_capture`), `os_enhanced`. These feed the M12 Roadside Defense Packet (image was gated, legible, and — recording `capture_mode`/`os_enhanced` — the packet states honestly whether the transform was ours-and-reproducible or the OS's black box).

---

## 8. Config delivery & signing (resolves Q7)

Enterprise pattern, so a bad config can never weaken the gate:

- **Bundled signed default** ships in the app — the app always has a valid config offline (truck cabs).
- **Remote override** fetched over TLS at app start (never at capture time), **Ed25519 detached-signature verified against a public key pinned in the binary** before it is trusted. Unsigned/failed-signature → rejected, keep last-known-good.
- **Version-monotonic:** a fetched config older than the active one is rejected (`minConfigVersionMonotonic`) — blocks rollback attacks.
- **Fail to last-known-good** (then bundled default). Never fail to "no gate."
- **Staged rollout** by cohort/percentage; `configVersion` recorded on every capture + run for provenance and A/B measurement.

---

## 9. Risks (research-updated, verified)

- **Android ML Kit Doc Scanner needs Google Play Services** and **downloads its module (~300 KB) on first use** → first run needs connectivity; **unavailable on de-Googled/AOSP/enterprise-locked devices.** Mitigation: `isSupported()` reports module state; `SCANNER_MODULE_UNAVAILABLE` handled; pre-warm the module download at onboarding (on Wi-Fi); v2 RawCapture (OpenCV) is the Play-Services-free fallback for locked fleets.
- **"Nothing leaves device" is not explicitly asserted by ML Kit docs** → **mandatory network-capture verification** during a scan + an OCR call at DCE-0, since BOLs are PII. (Apple Vision is documented on-device.)
- **OCR confidence unreliable on both platforms** → handled by the §5 redesign (geometry-led); confidence spread still validated empirically on min-spec at DCE-3.
- **`react-native-vision-camera` v5 dropped its Expo config plugin** (verified) and is a Nitro rewrite → only relevant to v2; if adopted, set permissions via `app.config` `ios.infoPlist`/`android.permissions`, or pin v4.7.2. Decide at the v2 spike.
- **`react-native-fast-opencv` lacks CLAHE/`equalizeHist`** and is single-maintainer with iOS 4.9 / Android 4.12 OpenCV skew → v2-only; enhancement uses adaptiveThreshold or an added-in-C++ CLAHE; test cross-platform parity.
- **Over-enhancement hurts the vision model** → model-facing derivative stays conservative by config.

---

## 10. Testing & measurement

Unit (config loader/signature, gate math, cross-check), native module tests, **golden-image regression** on a curated truck-cab dataset (sun/dusk/cabin-light/wrinkled/gloss/sleeved/angled), perf benchmarks (capture <1 s, processing <2 s), device matrix (incl. a **no-Play-Services** Android + a **min-spec** Android for OCR confidence + latency). Promotion gates: the §5 thresholds tune on the golden set before a config version ships; the §6 cross-check must catch real misreads without excessive false-flags before enabling. Shares the M8 real-BOL adjudication corpus.

---

## 11. Platform providers (verified capabilities)

| Concern | iOS | Android |
|---|---|---|
| v1 capture | `VNDocumentCameraViewController` (crop-only, no quad/raw) | `GmsDocumentScanner` (crop-only JPEG/PDF; Play-Services module) |
| v2 raw capture | own camera + `VNDetectDocumentSegmentationRequest` (corners + mask on raw `CVPixelBuffer`) | own camera + OpenCV contour detection |
| OCR | `VNRecognizeTextRequest` (0..1 conf, quantized; boxes ok) | ML Kit Text Recognition v2 (conf documented-but-flaky; rich geometry) |
| On-device | documented | inference-local; **verify no egress at DCE-0** |

---

## 12. Resolutions register (the former open questions — now CLOSED)

| # | Question | Resolution | Residual spike check |
|---|---|---|---|
| 1 | Do the libs build on Expo 57 / RN 0.86 / New Arch? | **v1 avoids the risk**: thin custom Expo module over OS APIs (New-Arch-native), not third-party wrappers. vision-camera(v5, MIT, no telemetry)/fast-opencv(1.0.1, MIT, no telemetry) deferred to v2. | v2: vision-camera v5 + fast-opencv on RN 0.86 |
| 2 | OS scanner: raw image + quad, or crop-only? | **CLOSED: crop-only on both.** Drives the v1(SystemScanner)/v2(RawCapture) split. iOS raw+quad path = `VNDetectDocumentSegmentationRequest`. | none (documented) |
| 3 | OCR confidence scale? | **CLOSED: unreliable both platforms.** Gate redesigned geometry/coverage-first; confidence secondary + platform overrides. | confirm a non-zero confidence spread on min-spec (secondary only) |
| 4 | On-device OCR within budget? | **CLOSED: yes** (~100 ms order; run on final frame; bundled model). | benchmark worst-case dense page on min-spec Android |
| 5 | On-device tokens enough for §6? | **CLOSED: yes for v1** (recognized text reliably available; token-compare doesn't need confidence). Tesseract server fallback defined. | measure token recall on golden corpus |
| 6 | Licenses / telemetry? | **CLOSED: all permissive** (MIT/Apache), vision-camera & fast-opencv verified no-telemetry from tarballs. OS APIs first-party. | **network-capture** ML Kit scan+OCR (PII); confirm no egress |
| 7 | Config delivery / signing? | **CLOSED: designed (§8)** — signed bundled default + signature-verified, version-monotonic remote override, fail-to-last-known-good. | implement signature verify at DCE-5 |

---

## Approval gate

Design is now research-grounded and the open questions are closed to decisions. On approval, implementation begins at **DCE-0**: thin custom Expo module scaffold + the two residual device checks that genuinely need hardware (ML Kit no-egress network capture; OCR confidence/latency on a min-spec Android). No native code before then.
