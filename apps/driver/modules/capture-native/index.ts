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

export interface NativeScanOptions {
  maxPages: number;
  ocrMode: string;
  enhanceLongEdgePx: number;
  enhanceQuality: number;
}

export interface CaptureNativeModule {
  isSupported(): Promise<NativeSupport>;
  scan(options: NativeScanOptions): Promise<NativeScanResult>;
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
