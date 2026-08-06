/**
 * The swappable provider seam (DCE P2 / §1). The public API sits ABOVE these interfaces so "self-built,
 * no vendor" means our provider is internal, and v1 (SystemScanner) and v2 (RawCapture) are two
 * providers behind one unchanging API.
 *
 * Interfaces only — implementations live where the IO lives: the native Expo module
 * (`apps/driver/modules/capture-native`) and the JS fallback (`apps/driver/src/capture`).
 */

import type { ImageRef, OcrEvidence, ScanResult, SupportResult } from "./contracts.js";

export interface ScanOptions {
  /** Cap pages per scan session (server enforces MAX_BOL_PAGES = 10 as the hard cap). */
  maxPages?: number;
}

/**
 * A capture provider: turns the camera/scanner into gated CapturedPage[] behind one API. `scan` must
 * run its pages through the §5 gate and return `{ ok: false, reason }` for a rejected capture so the
 * flow can prompt a re-shoot without an upload.
 */
export interface CaptureProvider {
  readonly id: string;
  readonly version: string;
  isSupported(): Promise<SupportResult>;
  scan(options?: ScanOptions): Promise<ScanResult>;
  cancel(): void;
}

/** OCR provider (swap seam #2) — feeds the §5 legibility gate + the §6 numeric cross-check. */
export interface OcrProvider {
  readonly id: string;
  readonly version: string;
  recognize(image: ImageRef): Promise<OcrEvidence>;
}

/** An OcrEvidence stand-in for providers/devices where OCR is unavailable — degrades the gate, closed. */
export function unavailableOcr(engine: string): OcrEvidence {
  return {
    engine,
    recognizedChars: 0,
    recognizedWords: 0,
    textCoverageFraction: 0,
    medianCharHeightPx: 0,
    smallTextBandCoverage: 0,
    numberTokens: [],
    available: false,
  };
}
