import type { CapturedPage, RejectionReason, ScanResult } from "@fuelguard/capture-engine";

/**
 * Pure capture view-logic (M6). No React Native imports → unit-tested and portable. The screen turns a
 * scan result into an accept/re-shoot decision here, and shapes the offline-outbox payload here.
 */

/** Driver-facing copy for each rejection reason (the re-shoot prompt). */
export const REJECTION_COPY: Record<RejectionReason, string> = {
  DOCUMENT_NOT_DETECTED: "No document detected — fill the frame with the BOL and retake.",
  IMAGE_BLURRED: "Too blurry — hold steady and retake.",
  GLARE_OVER_TEXT: "Glare on the page — tilt away from the light and retake.",
  SHADOW_OVER_TEXT: "Shadow over the text — even out the lighting and retake.",
  RESOLUTION_TOO_LOW: "Too low-resolution — move closer and retake.",
  LENS_DIRTY: "Camera lens looks dirty — wipe it and retake.",
  PAGE_INCOMPLETE: "Part of the page is cut off — capture the whole BOL and retake.",
  LOW_CONTRAST: "Low contrast — improve the lighting and retake.",
  UNDER_OR_OVER_EXPOSED: "Exposure is off — adjust the lighting and retake.",
  TEXT_ILLEGIBLE: "Text isn't legible — get closer and steadier, then retake.",
  OCR_UNAVAILABLE: "Couldn't read the page — retake.",
  SCANNER_MODULE_UNAVAILABLE: "Scanner isn't ready on this device — connect to Wi-Fi once, then retake.",
  UNSUPPORTED_DEVICE: "Camera permission is required to capture a BOL.",
  CAPTURE_CANCELLED: "Capture cancelled.",
  PROVIDER_ERROR: "Something went wrong with the capture — retake.",
};

export interface CaptureDecision {
  accepted: boolean;
  page: CapturedPage | null;
  reasons: string[];
}

/** Accept/reject a scan, mapping gate reasons to driver copy. v1 uses the first page of the scan. */
export function decideCapture(result: ScanResult): CaptureDecision {
  if (!result.ok) return { accepted: false, page: null, reasons: [REJECTION_COPY[result.reason]] };
  const page = result.pages[0] ?? null;
  if (!page) return { accepted: false, page: null, reasons: ["No page captured — retake."] };
  if (!page.quality.passed) return { accepted: false, page, reasons: page.quality.reasons.map((r) => REJECTION_COPY[r]) };
  return { accepted: true, page, reasons: [] };
}

/** Register-document request body derived from an accepted page (matches the server schema). */
export interface RegisterBody {
  id: string;
  kind: "bol";
  page: number;
  sha256: string;
  contentType: string;
  capture: {
    configVersion: string;
    mode: CapturedPage["provenance"]["captureMode"];
    osEnhanced: boolean;
    integrityHash: string;
    quality: CapturedPage["quality"];
    ocrEvidence: CapturedPage["ocr"];
  };
}

/** The full offline-outbox payload for one captured BOL page (create + register, replay-safe). */
export interface HazmatCapturePayload {
  loadId: string;
  create: { id: string };
  register: RegisterBody;
}

export function buildCapturePayload(args: {
  loadId: string;
  documentId: string;
  pageNumber: number;
  page: CapturedPage;
}): { payload: HazmatCapturePayload; localUri: string } {
  const { page } = args;
  return {
    payload: {
      loadId: args.loadId,
      create: { id: args.loadId },
      register: {
        id: args.documentId,
        kind: "bol",
        page: args.pageNumber,
        sha256: page.integrityHash,
        contentType: page.originalOfRecord.mediaType ?? "image/webp",
        capture: {
          configVersion: page.metadata.configVersion,
          mode: page.provenance.captureMode,
          osEnhanced: page.provenance.osEnhanced,
          integrityHash: page.integrityHash,
          quality: page.quality,
          ocrEvidence: page.ocr,
        },
      },
    },
    localUri: page.originalOfRecord.uri,
  };
}
