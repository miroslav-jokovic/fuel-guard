import type {
  CaptureConfig,
  CaptureProvider,
  CapturedPage,
  ImageMetrics,
  ScanOptions,
  ScanResult,
  SupportResult,
} from "@silvicom/capture-engine";
import {
  getCaptureNativeModule,
  type CaptureNativeModule,
  type NativeScannedPage,
} from "../../modules/capture-native";
import {
  assemblePage,
  imageMetricsFromMeasurement,
  interpretNativeScan,
  measurementTarget,
  rejectionFromThrown,
  supportFromNative,
} from "./nativeScanOutcome";

/**
 * DCE v1 provider — the self-built native SystemScanner (OS document scanner + OS OCR) behind the engine
 * seam. The native module captures + measures; this provider assembles the CapturedPage and runs the §5
 * gate (OUR code). Returns null when the native module isn't in the binary (caller falls back to JS).
 */

/**
 * Measure one page natively (plan Step 3.3, D-SCAN1..5, D-SCAN10).
 *
 * ── WHICH BYTES THIS MEASURES, SAID PLAINLY ───────────────────────────────────────────────────
 * D-SCAN4 says metrics are measured on the retained ORIGINAL, never on a derivative, and since Phase
 * 4b it is: this measures `p.original.uri`. It measured the 1568 px derivative for as long as that
 * was the only file a page had.
 *
 * ⚠ **So there are two eras of recorded metrics and they are not comparable.** M2 measured the same
 * document at 4283.7 blur variance at 3000 px and 7299.9 at 800 px — a 1.7× swing from scale alone —
 * and although D-SCAN1 downscales every measurement to the same analysis edge, it downscales from a
 * different starting image in each era, through a different resampler, after a different number of
 * JPEG re-encodes. Step 5.2 derives thresholds from recorded values, and a distribution that mixes
 * the two is a distribution of two different quantities. `analysisLongEdgePx` is stamped on every
 * reading, and `capture_config_version` dates it.
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
    return imageMetricsFromMeasurement(await native.measure(measurementTarget(p), config.analysis.longEdgePx));
  } catch {
    // What an absent measurement MEANS is decided in `nativeScanOutcome.ts`, where a unit test can
    // reach it without a device (D-SCAN13). This function keeps the I/O and the try, and nothing else.
    return imageMetricsFromMeasurement(null);
  }
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
