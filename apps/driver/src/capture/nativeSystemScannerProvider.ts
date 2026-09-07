import {
  evaluateGate,
  unavailableOcr,
  type CaptureConfig,
  type CaptureProvider,
  type CapturedPage,
  type ImageMetrics,
  type ImageRef,
  type OcrEvidence,
  type ScanOptions,
  type ScanResult,
  type SupportResult,
} from "@silvicom/capture-engine";
import {
  getCaptureNativeModule,
  type CaptureNativeModule,
  type NativeOcr,
  type NativeScannedPage,
} from "../../modules/capture-native";
import {
  imageMetricsFromMeasurement,
  interpretNativeScan,
  rejectionFromThrown,
  supportFromNative,
} from "./nativeScanOutcome";

/**
 * DCE v1 provider — the self-built native SystemScanner (OS document scanner + OS OCR) behind the engine
 * seam. The native module captures + measures; this provider assembles the CapturedPage and runs the §5
 * gate (OUR code). Returns null when the native module isn't in the binary (caller falls back to JS).
 */

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

/**
 * Measure one page natively (plan Step 3.3, D-SCAN1..5, D-SCAN10).
 *
 * ── WHICH BYTES THIS MEASURES, SAID PLAINLY ───────────────────────────────────────────────────
 * D-SCAN4 says metrics are measured on the retained ORIGINAL, never on a derivative. There is no
 * retained original yet — Phase 4 creates it — so this measures `p.uri`, which is the 1568 px JPEG
 * the native side already wrote. That is a derivative, and the numbers recorded before Phase 4 lands
 * are therefore not comparable with the ones recorded after. Written here rather than implied,
 * because Step 5.2 derives thresholds from recorded values and needs to know which era each came
 * from; `analysisLongEdgePx` is stamped on every reading for the same reason.
 *
 * ── WHY A FAILURE HERE IS NOT A FAILED CAPTURE ────────────────────────────────────────────────
 * Returning `undefined` leaves every image metric absent, which the gate renders as `na` — §5's
 * "never a silent pass" — and the server's usability gate remains the authoritative backstop. The
 * alternative, failing the capture, would mean a driver who photographed a perfectly good page is
 * told to retake it because a measurement we are not yet gating on could not be taken.
 */
async function measurePage(
  native: CaptureNativeModule,
  p: NativeScannedPage,
  config: CaptureConfig,
): Promise<Partial<ImageMetrics>> {
  try {
    return imageMetricsFromMeasurement(await native.measure(p.uri, config.analysis.longEdgePx));
  } catch {
    // What an absent measurement MEANS is decided in `nativeScanOutcome.ts`, where a unit test can
    // reach it without a device (D-SCAN13). This function keeps the I/O and the try, and nothing else.
    return imageMetricsFromMeasurement(null);
  }
}

function assemblePage(
  p: NativeScannedPage,
  measured: Partial<ImageMetrics>,
  config: CaptureConfig,
  platform: "ios" | "android",
): CapturedPage {
  const image: ImageRef = { uri: p.uri, width: p.width, height: p.height, bytes: p.bytes, mediaType: coerceMediaType(p.mediaType) };
  const ocr = toOcr(p.ocr);
  // System scanner returns a cropped, enhanced page → coverage is effectively full (an ASSERTION,
  // not a measurement — Step 5.3 removes it). Blur, glare, shadow, brightness and contrast are real
  // measurements from `measure()` as of Step 3.3, and every one of their gate floors is `null`, so
  // they are RECORDED and gated on by nobody until Step 5.2 derives thresholds from the recorded
  // distribution (D-SCAN10). `longEdgePx` comes from the page the scanner returned rather than from
  // the measurement, which reports the same thing — the two agreeing is a property worth keeping
  // accidental rather than one to depend on.
  const metrics: ImageMetrics = { longEdgePx: Math.max(p.width, p.height), coverageFraction: 1, ...measured };
  const quality = evaluateGate({ metrics, ocr, platform }, config);
  return {
    originalOfRecord: image,
    perspectiveCorrected: image, // OS already corrected on the v1 SystemScanner path
    enhancedColor: image,
    enhancedGray: image,
    quality,
    ocr,
    metadata: {
      providerId: "capture.native.system_scanner",
      providerVersion: "0.1.0",
      ocrEngineId: ocr.engine,
      configVersion: config.configVersion,
      device: platform,
    },
    integrityHash: p.integrityHash,
    provenance: { captureMode: "system_scanner", osEnhanced: p.osEnhanced },
  };
}

export function createNativeSystemScannerProvider(
  config: CaptureConfig,
  platform: "ios" | "android",
): CaptureProvider | null {
  const native = getCaptureNativeModule();
  if (!native) return null;
  return {
    id: "capture.native.system_scanner",
    version: "0.1.0",
    async isSupported(): Promise<SupportResult> {
      return supportFromNative(await native.isSupported());
    },
    async scan(options?: ScanOptions): Promise<ScanResult> {
      try {
        const res = await native.scan({
          maxPages: options?.maxPages ?? 10,
          ocrMode: config.ocrLegibility.ocrMode,
          enhanceLongEdgePx: config.enhance.modelFacing.longEdgePx,
          enhanceQuality: config.enhance.modelFacing.quality,
        });
        // Every decision about what this result MEANS lives in `nativeScanOutcome.ts`, where it can be
        // unit-tested without a device (D-SCAN13). This function keeps the I/O and nothing else.
        const outcome = interpretNativeScan(res);
        if (outcome.kind === "rejected") return { ok: false, reason: outcome.reason, message: outcome.message };
        // Sequential rather than `Promise.all`: `measure()` decodes a multi-megapixel image, and
        // Step 1.4 closed two out-of-memory paths in this module by bounding exactly this kind of
        // concurrency. A ten-page scan measuring ten pages at once would reopen one of them from the
        // JavaScript side, where the native module's own limit cannot see it.
        const pages: CapturedPage[] = [];
        for (const p of outcome.pages) {
          pages.push(assemblePage(p, await measurePage(native, p, config), config, platform));
        }
        return { ok: true, pages };
      } catch (e) {
        // A rejection now means only "something unforeseen happened" — see rejectionFromThrown.
        return { ok: false, reason: rejectionFromThrown(e), message: e instanceof Error ? e.message : String(e) };
      }
    },
    cancel(): void {
      native.cancel();
    },
  };
}
