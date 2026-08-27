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

export interface NativeScanResult {
  pages: NativeScannedPage[];
  cancelled?: boolean;
}

export interface NativeSupport {
  camera: boolean;
  docScanner: boolean;
  ocr: boolean;
  /** Android: Play-Services document-scanner module state (DCE §9). */
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
