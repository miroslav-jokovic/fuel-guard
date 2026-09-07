/**
 * Public API contracts for @silvicom/capture-engine (DCE §2).
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
  /**
   * sha256 (hex) over THIS artifact's encoded bytes, when the producer computed one.
   *
   * Added at Phase 4b, and it exists because a page stopped being one file. `integrityHash` on the
   * page is the ORIGINAL's hash and always was (DCE §2, migration 0133); it could not also describe
   * a derivative, and the server verifies the bytes it downloads against the hash registered for
   * them. Optional because a provider that produces a single artifact — the JS fallback picks one
   * file and has nothing to derive from it — has one hash, on the page, and repeating it here would
   * be a copy.
   */
  sha256?: string;
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
 *
 * ── WHY THIS IS AN ARRAY AND NOT A BARE UNION (SCANNER-UPGRADE-PLAN.md Step 1.1) ──────────────
 * A union type has no runtime counterpart, so the moment anything has to decide whether a string
 * arriving from outside TypeScript is a real reason, it must restate the list — and a restated list
 * is a copy with a delay fuse (root CLAUDE.md: deriving beats restating). Reasons DO arrive from
 * outside now: the native module reports an expected outcome as a value, and a rejected promise may
 * carry a `code`. Both are checked against this array, so a reason the native side invents cannot
 * become a `RejectionReason` by assertion.
 */
export const REJECTION_REASONS = [
  "DOCUMENT_NOT_DETECTED",
  "IMAGE_BLURRED",
  "GLARE_OVER_TEXT",
  "SHADOW_OVER_TEXT",
  "RESOLUTION_TOO_LOW",
  "LENS_DIRTY",
  "PAGE_INCOMPLETE",
  "LOW_CONTRAST",
  "UNDER_OR_OVER_EXPOSED",
  "TEXT_ILLEGIBLE",
  "OCR_UNAVAILABLE",
  "SCANNER_MODULE_UNAVAILABLE",
  "UNSUPPORTED_DEVICE",
  "CAPTURE_CANCELLED",
  "PROVIDER_ERROR",
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

export function isRejectionReason(value: unknown): value is RejectionReason {
  return typeof value === "string" && (REJECTION_REASONS as readonly string[]).includes(value);
}

/**
 * Coerce an untrusted value to a reason, falling back rather than throwing.
 *
 * The fallback is the whole point. `PROVIDER_ERROR` means "something unforeseen happened", which is
 * exactly what an unrecognised code IS — and a capture flow that threw here would turn a merely
 * unfamiliar reason into a crash in front of a driver holding a bill of lading.
 */
export function toRejectionReason(
  value: unknown,
  fallback: RejectionReason = "PROVIDER_ERROR",
): RejectionReason {
  return isRejectionReason(value) ? value : fallback;
}

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
 * One captured page (DCE §2).
 *
 * ── THE FOUR IMAGE FIELDS STOPPED ALIASING AT PHASE 4b (D-SCAN6, audit finding F1) ────────────
 * They used to be four references to ONE object: a 1568 px JPEG q80 derivative, with `integrityHash`
 * computed over it. So the "original of record" was a re-encode of a downscale, and the evidentiary
 * claim the field name makes was not true of the bytes it pointed at.
 *
 * Now `originalOfRecord` is the untouched page the OS scanner produced, and the other three are the
 * derivative that uploads and that extraction reads. `perspectiveCorrected`, `enhancedColor` and
 * `enhancedGray` still alias EACH OTHER on the v1 SystemScanner path, and that is honest rather than
 * lazy: the OS did the perspective correction and the enhancement in one step and gives us one image
 * back (DCE §3). Step 6.1 splits ARCHIVE from MACHINE and they stop aliasing too.
 *
 * ⚠ **"Untouched" means something different on each platform, and pretending otherwise would be the
 * kind of claim this field exists to stop making.** Android's `GmsDocumentScanner` hands back a JPEG
 * file URI, so the original there is a byte copy — genuinely the scanner's own bytes. iOS's
 * `VNDocumentCameraScan` exposes only `imageOfPage(at:) -> UIImage` and never bytes, so the closest
 * available original is that image encoded at full resolution and maximum JPEG quality: no resize, no
 * enhancement, no re-crop. `provenance.osEnhanced` already says the OS processed the page; this note
 * says how faithfully we preserved what it handed us.
 */
export interface CapturedPage {
  /** The bytes the scanner produced (see the platform note above). Hashed as `integrityHash`. */
  originalOfRecord: ImageRef;
  perspectiveCorrected: ImageRef;
  enhancedColor: ImageRef;
  enhancedGray: ImageRef;
  quality: QualityReport;
  ocr: OcrEvidence;
  metadata: CaptureMetadata;
  /**
   * sha256 over `originalOfRecord`'s bytes — the evidentiary hash, and never a derivative's.
   *
   * It has always been documented this way and, until Phase 4b, was vacuously so: one file wore all
   * four hats. `enhancedColor.sha256` is what the server registers as `sha256` for the object it
   * downloads and verifies; this one lands in `integrity_hash` (0133, restated by 0328).
   */
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
