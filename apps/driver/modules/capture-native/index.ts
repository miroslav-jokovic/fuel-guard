import { requireNativeModule } from "expo-modules-core";

/**
 * TS bridge for the self-built native scanner (DCE v1 SystemScanner provider). The native module CAPTURES
 * (OS document scanner) and MEASURES (OS OCR → legibility metrics); it never decides accept/reject — the
 * §5 gate is OUR TS code in @silvicom/capture-engine and runs in the provider above this bridge.
 *
 * Loaded lazily so a dev build WITHOUT the native module (or an unsupported device) degrades to the JS
 * fallback provider instead of crashing at import.
 */

/** Raw OCR metrics from the OS engine (iOS Vision / Android ML Kit) — a legibility SIGNAL only. */
export interface NativeOcr {
  engine: string;
  recognizedChars: number;
  recognizedWords: number;
  textCoverageFraction: number;
  medianCharHeightPx: number;
  smallTextBandCoverage: number;
  meanConfidence?: number;
  numberTokens: string[];
}

/** One page the OS scanner returned (already cropped + enhanced on the v1 SystemScanner path). */
export interface NativeScannedPage {
  uri: string;
  width: number;
  height: number;
  bytes?: number;
  mediaType: string;
  /** sha256 (hex) over the original-of-record bytes, computed natively. */
  integrityHash: string;
  osEnhanced: boolean;
  ocr?: NativeOcr;
}

/**
 * An outcome the native side EXPECTED and is reporting as a value (SCANNER-UPGRADE-PLAN.md D-SCAN7).
 *
 * `reason` is checked against the engine's taxonomy by the provider above this bridge; it is a plain
 * string here because this file is the boundary and a boundary should not pretend to know that what
 * crossed it is well-formed.
 */
export interface NativeUnavailable {
  reason: string;
  detail?: string;
}

export interface NativeScanResult {
  pages: NativeScannedPage[];
  cancelled?: boolean;
  /**
   * Present when the scanner could not run for a reason we anticipated — the Play-Services document
   * scanner module is absent on a de-Googled or enterprise-locked device, or the OS scanner is not
   * supported at all. NOT an error: `scan()` resolves, and the driver gets the sentence that tells
   * them what to do instead of "something went wrong".
   */
  unavailable?: NativeUnavailable;
}

export interface NativeSupport {
  camera: boolean;
  docScanner: boolean;
  ocr: boolean;
  /**
   * Android: Play-Services document-scanner module state (DCE §9). Until Step 1.1 this was declared
   * here and never populated — Android's `isSupported` returned a hardcoded `true/true/true` — so the
   * onboarding pre-warm the DCE specifies had nothing to read. It is now reported for real, with the
   * honest caveat that "available" means Play Services is present rather than that the ~300 KB module
   * has already been downloaded; only `scan()` can establish the latter.
   */
  scannerModule?: "available" | "unavailable" | "pending_download";
}

/**
 * What `measure()` answers — the metric definition of record, computed natively
 * (SCANNER-UPGRADE-PLAN.md Phase 3, D-SCAN1..5, D-SCAN8).
 *
 * The field names are `MeasuredMetrics` in `@silvicom/capture-engine`'s `metrics.ts`, deliberately
 * and to the letter. That package is the implementation of record and the server calls it directly;
 * iOS and Android reimplement it because they cannot call it, and are held to
 * `fixtures/expected.json` for their trouble. A name that differed here would be the seam where a
 * third quantity gets invented — which is exactly what the audit of 2026-09-06 found had already
 * happened once between the client config and the server gate.
 */
export interface NativeImageMetrics {
  /** Long edge of the ORIGINAL image, BEFORE the analysis downscale — the resolution floor's input. */
  longEdgePx: number;
  blurVariance: number;
  glareFraction: number;
  brightnessMean: number;
  contrastRms: number;
  shadowRange: number;
  /** The scale the five above were computed at, so a recorded number stays interpretable later. */
  analysisLongEdgePx: number;
}

export interface NativeScanOptions {
  maxPages: number;
  ocrMode: string;
  enhanceLongEdgePx: number;
  enhanceQuality: number;
}

export interface CaptureNativeModule {
  isSupported(): Promise<NativeSupport>;
  scan(options: NativeScanOptions): Promise<NativeScanResult>;
  /**
   * Measure one image at the analysis scale the SIGNED CONFIG declares.
   *
   * `analysisLongEdgePx` is passed on every call rather than baked into the native side, because
   * D-SCAN1 makes it part of what the metric MEANS: a blur variance is only comparable with another
   * one taken at the same scale. The config is the one place that value lives, so it travels from
   * there on every call and nowhere else holds a copy — a native default would be a second source of
   * truth that silently wins whenever a caller forgets, which is the shape this whole phase exists
   * to prevent.
   *
   * NOT YET CALLED by either provider: Step 3.3 wires it in, in shadow mode (D-SCAN10).
   */
  measure(uri: string, analysisLongEdgePx: number): Promise<NativeImageMetrics>;
  recognize(uri: string): Promise<NativeOcr>;
  cancel(): void;
}

let cached: CaptureNativeModule | null = null;
let resolved = false;

/** Returns the native module, or null when it isn't built into this binary (→ use the JS fallback). */
export function getCaptureNativeModule(): CaptureNativeModule | null {
  if (resolved) return cached;
  resolved = true;
  try {
    cached = requireNativeModule<CaptureNativeModule>("CaptureNative");
  } catch {
    cached = null;
  }
  return cached;
}
