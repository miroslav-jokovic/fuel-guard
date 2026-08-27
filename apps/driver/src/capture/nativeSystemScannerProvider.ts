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
import { getCaptureNativeModule, type NativeOcr, type NativeScannedPage } from "../../modules/capture-native";

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

function assemblePage(p: NativeScannedPage, config: CaptureConfig, platform: "ios" | "android"): CapturedPage {
  const image: ImageRef = { uri: p.uri, width: p.width, height: p.height, bytes: p.bytes, mediaType: coerceMediaType(p.mediaType) };
  const ocr = toOcr(p.ocr);
  // System scanner returns a cropped, enhanced page → coverage is effectively full; blur/glare are
  // measured natively when present, else left `na` (the server usabilityGate is the backstop).
  const metrics: ImageMetrics = { longEdgePx: Math.max(p.width, p.height), coverageFraction: 1 };
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
      const s = await native.isSupported();
      return { supported: s.camera && s.docScanner, camera: s.camera, docScanner: s.docScanner, ocr: s.ocr, scannerModule: s.scannerModule };
    },
    async scan(options?: ScanOptions): Promise<ScanResult> {
      try {
        const res = await native.scan({
          maxPages: options?.maxPages ?? 10,
          ocrMode: config.ocrLegibility.ocrMode,
          enhanceLongEdgePx: config.enhance.modelFacing.longEdgePx,
          enhanceQuality: config.enhance.modelFacing.quality,
        });
        if (res.cancelled) return { ok: false, reason: "CAPTURE_CANCELLED" };
        return { ok: true, pages: res.pages.map((p) => assemblePage(p, config, platform)) };
      } catch (e) {
        return { ok: false, reason: "PROVIDER_ERROR", message: e instanceof Error ? e.message : String(e) };
      }
    },
    cancel(): void {
      native.cancel();
    },
  };
}
