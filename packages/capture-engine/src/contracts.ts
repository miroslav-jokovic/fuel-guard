/**
 * Public API contracts for @fuelguard/capture-engine (DCE §2).
 *
 * This is the ONLY surface other modules touch. Pure types + pure functions live in this package;
 * it imports NOTHING platform-specific (no React Native, no Node, no crypto) so it typechecks and
 * unit-tests anywhere. Providers (native Expo module, JS fallback) and the app wire the IO around it.
 *
 * Single responsibility of the scanner (DCE preamble): produce the cleanest usable document image and
 * REJECT anything unfit for reliable reading. It is not an OCR engine and not a parser — it uses text
 * recognition only as a legibility SIGNAL (§5), never extracts meaning, never alters text, and
 * preserves the received image as the evidentiary record.
 */

/** How the original-of-record was produced. `expo_camera` is the JS fallback provider (no OS scanner). */
export type CaptureMode = "system_scanner" | "raw_capture" | "expo_camera";

export interface ImageRef {
  /** Local file URI (file://…) or an opaque handle the owning provider understands. */
  uri: string;
  width: number;
  height: number;
  /** Encoded byte length when known — used for the "3-page BOL < 1.5 MB" DoD (PLAN §12.3). */
  bytes?: number;
  mediaType?: "image/webp" | "image/jpeg" | "image/png";
}

/**
 * The quality checks the gate can report (DCE §2). `perspectiveSeverity` / `lensSmudge` need the raw
 * frame + quad and are therefore `na` on the v1 SystemScanner path; `ocrLegibility` is the §5 gate.
 */
export type CheckName =
  | "documentDetected"
  | "coverage"
  | "blur"
  | "glare"
  | "shadow"
  | "brightness"
  | "contrast"
  | "resolution"
  | "ocrLegibility"
  | "perspectiveSeverity"
  | "lensSmudge";

/** `na` = not applicable / not measurable on this provider (never a silent pass — see §5). */
export type CheckStatus = "pass" | "fail" | "na";

export interface CheckResult {
  name: CheckName;
  status: CheckStatus;
  /** 0..1 normalized score where meaningful; omitted for `na`. */
  score?: number;
  /** Raw measured value(s) for provenance/debug — never trusted as content. */
  detail?: Record<string, number | boolean | string>;
}

/**
 * Rejection taxonomy (DCE §2). `SCANNER_MODULE_UNAVAILABLE` is Android-specific (Play-Services scanner
 * module absent/not-yet-downloaded — DCE §9).
 */
export type RejectionReason =
  | "DOCUMENT_NOT_DETECTED"
  | "IMAGE_BLURRED"
  | "GLARE_OVER_TEXT"
  | "SHADOW_OVER_TEXT"
  | "RESOLUTION_TOO_LOW"
  | "LENS_DIRTY"
  | "PAGE_INCOMPLETE"
  | "LOW_CONTRAST"
  | "UNDER_OR_OVER_EXPOSED"
  | "TEXT_ILLEGIBLE"
  | "OCR_UNAVAILABLE"
  | "SCANNER_MODULE_UNAVAILABLE"
  | "UNSUPPORTED_DEVICE"
  | "CAPTURE_CANCELLED"
  | "PROVIDER_ERROR";

export interface QualityReport {
  passed: boolean;
  checks: CheckResult[];
  /** Empty when accepted; the reasons to show the driver for a re-shoot otherwise. */
  reasons: RejectionReason[];
  /** Overall accept score 0..1 (fraction of applicable checks passed); compared to overallAcceptScoreMin. */
  score: number;
  /** True when the §5 legibility gate ran in degraded (image-only) mode because OCR was unavailable. */
  ocrDegraded: boolean;
}

/**
 * OCR evidence — a legibility SIGNAL, never stored as content (DCE §5/§6). Geometry/coverage metrics
 * are portable across iOS Vision + Android ML Kit; `meanConfidence` is secondary and may be absent
 * (both platforms' word-confidence is unreliable — DCE §12 #3).
 */
export interface OcrEvidence {
  /** OCR engine id + version, e.g. "ios.vision" / "android.mlkit@2". Recorded on the run for provenance. */
  engine: string;
  recognizedChars: number;
  recognizedWords: number;
  textCoverageFraction: number;
  medianCharHeightPx: number;
  smallTextBandCoverage: number;
  meanConfidence?: number;
  /** Digit tokens for the server §6 numeric cross-check — a SIGNAL only, never authoritative. */
  numberTokens: string[];
  /** false → the gate degraded to image-only checks and flagged it (never silent-passes legibility). */
  available: boolean;
}

export interface CaptureMetadata {
  providerId: string;
  providerVersion: string;
  ocrEngineId?: string;
  ocrEngineVersion?: string;
  captureMs?: number;
  processingMs?: number;
  device?: string;
  /** The capture config version in force — stamped on every capture + run (DCE P1/§8). */
  configVersion: string;
}

/**
 * One captured page (DCE §2). `originalOfRecord` is hashed + preserved as the evidentiary record; on the
 * v1 SystemScanner path `perspectiveCorrected` equals it (the OS already cropped/enhanced).
 */
export interface CapturedPage {
  originalOfRecord: ImageRef;
  perspectiveCorrected: ImageRef;
  enhancedColor: ImageRef;
  enhancedGray: ImageRef;
  quality: QualityReport;
  ocr: OcrEvidence;
  metadata: CaptureMetadata;
  /** sha256 over originalOfRecord bytes — integrity + extraction cache-key component. */
  integrityHash: string;
  provenance: { captureMode: CaptureMode; osEnhanced: boolean };
}

export type ScanResult =
  | { ok: true; pages: CapturedPage[] }
  | { ok: false; reason: RejectionReason; message?: string };

export interface SupportResult {
  supported: boolean;
  camera: boolean;
  docScanner: boolean;
  ocr: boolean;
  /** Android only: Play-Services document-scanner module state (DCE §9). */
  scannerModule?: "available" | "unavailable" | "pending_download";
  reason?: RejectionReason;
}
