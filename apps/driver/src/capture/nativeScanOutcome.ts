import {
  evaluateGate,
  toRejectionReason,
  unavailableOcr,
  type CaptureConfig,
  type CapturedPage,
  type ImageMetrics,
  type ImageRef,
  type OcrEvidence,
  type RejectionReason,
  type SupportResult,
} from "@silvicom/capture-engine";
import type {
  NativeImage,
  NativeImageMetrics,
  NativeOcr,
  NativeScanResult,
  NativeScannedPage,
  NativeSupport,
} from "../../modules/capture-native";

/**
 * How a native scan result becomes an engine outcome (SCANNER-UPGRADE-PLAN.md Step 1.1, D-SCAN7).
 *
 * ── WHY THIS IS ITS OWN FILE ──────────────────────────────────────────────────────────────────
 * Every decision here is pure, and none of it should need a phone to check. The provider beside this
 * file cannot be imported in a unit test — it reaches the native module, which reaches
 * `expo-modules-core`, which expects a React Native runtime — so logic that lives inside it is logic
 * that can only be verified by holding a device. D-SCAN13 moved the device session to the end of the
 * programme, which makes that trade much worse than it was: anything left in the provider stays
 * unverified for months. So the decisions move out here, where `pnpm test` reaches them today, and
 * the provider keeps only the I/O.
 *
 * The types come in with `import type`, which is erased at compile time — so importing this file does
 * NOT load the native bridge, which is the entire point.
 */

/** What a native scan turned out to be, before any image work is done. */
export type NativeScanOutcome =
  | { kind: "pages"; pages: NativeScannedPage[] }
  | { kind: "rejected"; reason: RejectionReason; message?: string };

/**
 * Interpret a resolved native scan.
 *
 * Order matters and is deliberate: `unavailable` is checked BEFORE `cancelled`, because a scanner
 * that could not start has not been cancelled by anybody, and telling a driver "Capture cancelled"
 * when their phone has no Play services sends them to look for a mistake they did not make.
 */
export function interpretNativeScan(res: NativeScanResult): NativeScanOutcome {
  if (res.unavailable) {
    // Checked against the taxonomy, never asserted into it: a reason the native side invents must not
    // become a RejectionReason just because it is a string in the right place.
    return {
      kind: "rejected",
      reason: toRejectionReason(res.unavailable.reason),
      message: res.unavailable.detail,
    };
  }
  if (res.cancelled) return { kind: "rejected", reason: "CAPTURE_CANCELLED" };
  if (res.pages.length === 0) {
    // Neither unavailable, nor cancelled, nor carrying anything. Nothing in the contract forbids it,
    // and a silent `{ ok: true, pages: [] }` would reach `decideCapture` as "No page captured" with no
    // reason attached. Name it here instead.
    return { kind: "rejected", reason: "PROVIDER_ERROR", message: "The scanner returned no pages." };
  }
  return { kind: "pages", pages: res.pages };
}

/**
 * A thrown value's `code`, when it carries a recognisable one; `PROVIDER_ERROR` otherwise.
 *
 * This is a SECONDARY path and the design does not rest on it. On Android a Kotlin `CodedException`
 * does reach JS carrying a `code` — `expo-modules-core`'s `Exceptions.cpp` builds a `CodedError` from
 * the `ExpoModulesCore_CodedError` global installed in `setUpJsLogger.fx.ts`. On iOS the equivalent
 * construction happens inside the prebuilt `ExpoModulesJSI` binary and could not be confirmed from
 * source (checked 2026-09-06). Rather than ship a design whose correctness depends on an unverified
 * half, every EXPECTED outcome now arrives as a value and a rejection means only "unforeseen" — so
 * reading the code here can add precision and can never be load-bearing.
 */
export function rejectionFromThrown(e: unknown): RejectionReason {
  const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  return toRejectionReason(code);
}

/**
 * Which flavour of "cannot scan" a support probe describes.
 *
 * The distinction earns its place: Play services being absent is the DCE §9 case and has a remedy a
 * driver can act on (connect to Wi-Fi once) or a fleet-level one (v2 RawCapture for locked fleets).
 * No camera is a different conversation and no amount of Wi-Fi fixes it.
 */
export function reasonForUnsupported(s: Pick<NativeSupport, "camera" | "docScanner" | "scannerModule">): RejectionReason {
  if (!s.camera) return "UNSUPPORTED_DEVICE";
  return s.scannerModule === "unavailable" ? "SCANNER_MODULE_UNAVAILABLE" : "UNSUPPORTED_DEVICE";
}

/** The engine's SupportResult from a native probe, carrying WHY when it cannot scan. */
export function supportFromNative(s: NativeSupport): SupportResult {
  const supported = s.camera && s.docScanner;
  return {
    supported,
    camera: s.camera,
    docScanner: s.docScanner,
    ocr: s.ocr,
    scannerModule: s.scannerModule,
    reason: supported ? undefined : reasonForUnsupported(s),
  };
}

/**
 * What a native `measure()` becomes in the gate's `ImageMetrics` (plan Step 3.3, D-SCAN10).
 *
 * ── THE DECISION THIS HOLDS ───────────────────────────────────────────────────────────────────
 * A measurement that could not be taken must leave every field ABSENT, not zero. The gate reads an
 * absent field as `na` — §5's "never a silent pass", with the server's usability gate as the
 * authoritative backstop — whereas a zeroed field is a real measurement of a catastrophically bad
 * page, and the day Step 5.2 turns the floors back on that is a driver being told to retake a
 * perfectly good photograph because a decode failed.
 *
 * It is the same distinction the config makes between a retired threshold and `0`, one layer down:
 * absent means "not known", and nothing in this engine is allowed to spell "not known" as a number.
 *
 * `longEdgePx` is deliberately NOT taken from here. It is the resolution floor's input and the
 * provider already has it from the page the scanner returned; sourcing it from the measurement would
 * mean a failed measurement could not be told apart from a page with no pixels.
 */
export function imageMetricsFromMeasurement(m: NativeImageMetrics | null): Partial<ImageMetrics> {
  if (!m) return {};
  return {
    blurVariance: m.blurVariance,
    glareFraction: m.glareFraction,
    brightnessMean: m.brightnessMean,
    contrastRms: m.contrastRms,
    shadowRange: m.shadowRange,
  };
}


/**
 * ── WHY PAGE ASSEMBLY LIVES HERE AND NOT IN THE PROVIDER (moved at Phase 4b) ──────────────────
 * It used to sit beside the native module, and a mutation proved what that cost: pointing `measure()`
 * at the DERIVATIVE instead of the original — undoing D-SCAN4 exactly — passed the whole driver
 * suite, because nothing in it could reach the code that decides. The provider imports the native
 * bridge, which imports `expo-modules-core`, which needs a React Native runtime, so every decision
 * inside it is a decision only a phone can check. D-SCAN13 put the phone at the END of the programme.
 *
 * So the rule this file already stated for rejection reasons now covers the whole page: decisions
 * here, I/O there. Which artifact is measured, which one is uploaded, which hash means what and which
 * dimensions the resolution floor reads are all facts about the contract, and `pnpm test` reaches
 * every one of them on a laptop.
 */

/** Which file the metrics are computed from — the ORIGINAL, per D-SCAN4. */
export function measurementTarget(p: NativeScannedPage): string {
  return p.original.uri;
}

function coerceMediaType(s: string): ImageRef["mediaType"] {
  return s === "image/webp" || s === "image/jpeg" || s === "image/png" ? s : "image/webp";
}

function toOcr(n: NativeOcr | undefined): OcrEvidence {
  if (!n) return unavailableOcr("native.none");
  return {
    engine: n.engine,
    recognizedChars: n.recognizedChars,
    recognizedWords: n.recognizedWords,
    textCoverageFraction: n.textCoverageFraction,
    medianCharHeightPx: n.medianCharHeightPx,
    smallTextBandCoverage: n.smallTextBandCoverage,
    meanConfidence: n.meanConfidence,
    numberTokens: n.numberTokens,
    available: true,
  };
}

/** A native artifact as the engine's ImageRef — same fields, and the hash of exactly those bytes. */
function toImageRef(n: NativeImage): ImageRef {
  return { uri: n.uri, width: n.width, height: n.height, bytes: n.bytes, mediaType: coerceMediaType(n.mediaType), sha256: n.sha256 };
}

export function assemblePage(
  p: NativeScannedPage,
  measured: Partial<ImageMetrics>,
  config: CaptureConfig,
  platform: "ios" | "android",
): CapturedPage {
  const original = toImageRef(p.original);
  const derived = toImageRef(p.derived);
  const ocr = toOcr(p.ocr);
  // ── NO `coverageFraction` HERE, AND ITS ABSENCE IS THE POINT (Step 5.3, audit finding F6) ────
  // This line used to read `coverageFraction: 1` — an ASSERTION, not a measurement, and the last
  // invented number in the metric path. It could not be measured and still cannot: the OS document
  // scanner reports the cropped page and never the crop's area against the frame it came from, so
  // that ratio exists only inside VisionKit and ML Kit. Asserting 1 made the gate's coverage check
  // report PASS on every capture ever taken, count toward the accept score, and look like it was
  // working.
  //
  // Absent instead, which the gate renders as `na` — §5's standing rule that `na` is never a silent
  // pass. It is a stated gap covered by the server's usability backstop, and it is one of the
  // concrete signals feeding the Phase 7 v2 decision: a custom viewfinder OWNS the frame, so it is
  // the thing that could measure this. `coverageMinFraction` is retired to `null` in the same merge,
  // so no floor is left waiting to gate on a quantity nobody produces.
  //
  // Blur, glare, shadow, brightness and contrast are real measurements from `measure()` as of Step
  // 3.3, and every one of their gate floors is `null`, so they are RECORDED and gated on by nobody
  // until Step 5.2 derives thresholds from the recorded distribution (D-SCAN10). `longEdgePx` comes
  // from the ORIGINAL the scanner returned rather than from the measurement, which reports the same
  // thing — the two agreeing is a property worth keeping accidental rather than one to depend on.
  // ⚠ The resolution floor is measured on the ORIGINAL, which is the page as the scanner produced it.
  // Measuring the derivative would make this check a statement about `enhanceLongEdgePx` — a number
  // we chose — rather than about what the camera captured, and it would pass every time by
  // construction.
  const metrics: ImageMetrics = { longEdgePx: Math.max(original.width, original.height), ...measured };
  const quality = evaluateGate({ metrics, ocr, platform }, config);
  return {
    originalOfRecord: original,
    // The three derivative fields still alias each other, and that is the honest v1 shape rather than
    // an oversight: the OS corrected perspective and enhanced in one step and returns one image
    // (DCE §3). Step 6.1 produces a real ARCHIVE and MACHINE pair and they stop aliasing.
    perspectiveCorrected: derived,
    enhancedColor: derived,
    enhancedGray: derived,
    quality,
    ocr,
    metadata: {
      providerId: "capture.native.system_scanner",
      providerVersion: "0.1.0",
      ocrEngineId: ocr.engine,
      configVersion: config.configVersion,
      device: platform,
    },
    // The ORIGINAL's hash, which is what this field has always been documented to be — and, until
    // Phase 4b, was vacuously so, because a page had one file.
    integrityHash: p.original.sha256,
    provenance: { captureMode: "system_scanner", osEnhanced: p.osEnhanced },
  };
}
