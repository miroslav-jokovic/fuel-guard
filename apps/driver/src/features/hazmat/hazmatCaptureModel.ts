import type { CapturedPage, RejectionReason, ScanResult } from "@silvicom/capture-engine";

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

/** Why one page of a multi-page scan was refused, named so the driver knows which sheet to re-shoot. */
export interface PageRejection {
  /** 1-based, matching what the driver counted as they scanned and what the server stores. */
  page: number;
  reasons: string[];
}

export interface CaptureDecision {
  accepted: boolean;
  /** Every page of an accepted scan, in scan order. Empty when the scan was refused. */
  pages: CapturedPage[];
  /** Scan-level copy (cancelled, scanner unavailable) plus a line per refused page. */
  reasons: string[];
  /** Per-page detail behind `reasons`, for a UI that wants to mark the offending page. */
  pageRejections: PageRejection[];
  /**
   * Files the scanner wrote that will now never be used — every image of a refused scan. The caller
   * deletes them; nothing else can, because `sweepOrphans` only knows about the staging directory and
   * these were written to the OS cache by native code (plan Step 1.4, F9).
   */
  discardUris: string[];
}

/**
 * Every distinct file a captured page refers to.
 *
 * On the v1 SystemScanner path all four image fields alias one file, so this returns one URI — but
 * they stop aliasing at Phase 4, when the untouched original is preserved separately from its
 * derivatives. Deduplicating now means the cleanup keeps working then instead of quietly leaking
 * three files out of four.
 */
function fileUrisOf(page: CapturedPage): string[] {
  return [...new Set([
    page.originalOfRecord.uri,
    page.perspectiveCorrected.uri,
    page.enhancedColor.uri,
    page.enhancedGray.uri,
  ])];
}

/**
 * Accept or refuse a whole scan, mapping gate reasons to driver copy.
 *
 * ── WHY THIS IS ALL-OR-NOTHING, AND WHY THAT IS NOT LAZINESS ──────────────────────────────────
 * Until now this took `result.pages[0]` and dropped the rest with no message: a driver who scanned a
 * three-page bill of lading uploaded one page and was told nothing — the exact case the plan's
 * "3-page BOL < 1.5 MB" definition of done is written for.
 *
 * The fix keeps every page, and refuses the whole scan if any single page fails the gate. Accepting
 * the good pages and asking for just the bad one would be better, and it is not available to us: the
 * OS document scanner owns its own multi-page session, and once `scan()` has returned there is no way
 * back into it for page two alone. Re-entering means re-shooting all of them. So the honest v1
 * behaviour is to refuse the set and say WHICH page was the problem, rather than to accept a partial
 * set the driver believes is complete. That changes at v2 RawCapture, where the session is ours.
 */
export function decideCapture(result: ScanResult, maxPages = 10): CaptureDecision {
  const discardUris = result.ok ? result.pages.flatMap(fileUrisOf) : [];
  const refuse = (reasons: string[], pageRejections: PageRejection[] = []): CaptureDecision => ({
    accepted: false,
    pages: [],
    reasons,
    pageRejections,
    discardUris,
  });

  if (!result.ok) return refuse([REJECTION_COPY[result.reason]]);
  if (result.pages.length === 0) return refuse(["No page captured — retake."]);

  // iOS's VNDocumentCameraViewController has no page-limit API, so `maxPages` cannot be enforced
  // where it is requested. Enforcing it here — after the fact, loudly — beats the alternatives:
  // silently dropping the surplus is the defect this step exists to remove, and letting it through
  // would hit the server's own MAX_BOL_PAGES cap mid-upload, after the driver had been told it worked.
  if (result.pages.length > maxPages) {
    return refuse([
      `That's ${result.pages.length} pages and the limit is ${maxPages} — scan the document in smaller batches.`,
    ]);
  }

  const pageRejections: PageRejection[] = [];
  result.pages.forEach((page, index) => {
    if (page.quality.passed) return;
    pageRejections.push({
      page: index + 1,
      reasons: page.quality.reasons.map((r) => REJECTION_COPY[r]),
    });
  });

  if (pageRejections.length > 0) {
    // "Page 2: Too blurry — hold steady and retake." A single-page scan says just the reason: adding
    // "Page 1" to a scan that only had one page is noise dressed up as precision.
    const single = result.pages.length === 1;
    return refuse(
      pageRejections.flatMap((r) => r.reasons.map((reason) => (single ? reason : `Page ${r.page}: ${reason}`))),
      pageRejections,
    );
  }

  // Nothing to discard on the accepted path here: those files are still the only copy until the
  // caller has staged them, and it discards them itself once they are not.
  return { accepted: true, pages: result.pages, reasons: [], pageRejections: [], discardUris: [] };
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

/**
 * The full offline-outbox payload for one captured BOL — every page of it (create + registers,
 * replay-safe).
 *
 * ── WHY ONE RECORD FOR N PAGES, RATHER THAN N RECORDS ─────────────────────────────────────────
 * The outbox drains records independently, and the last act of this capture is `submit`, which starts
 * the extraction. Split across N records, whichever drained first would submit a load holding one
 * page and the analysis would run against an incomplete document — a wrong verdict produced
 * confidently, which is the one outcome this whole subsystem exists to prevent. Keeping the set in one
 * record also keeps true the promise its handler already makes in a comment: "The whole capture is ONE
 * queued item, replay-safe end to end." `outbox.file_uris` has always been a JSON array; this is the
 * first thing to use it as one.
 */
export interface HazmatCapturePayload {
  loadId: string;
  create: { id: string };
  /** One per page, in page order, page numbers 1..n. Aligned by index with the record's fileUris. */
  registers: RegisterBody[];
}

/**
 * The pages a queued capture record is asking to be uploaded, whichever shape it was queued in.
 *
 * ── WHY BOTH SHAPES, AND WHY THIS IS NOT DEAD CODE ────────────────────────────────────────────
 * Before Step 1.2 a record carried a single `register`; it now carries `registers`. The outbox
 * survives an app update — a driver who scanned offline on Friday and took the update over the
 * weekend has a Friday-shaped record still on disk, holding work that exists nowhere else. Refusing
 * it would be the one failure this subsystem is built to prevent (plan §13.8 / D12), so both drain.
 *
 * The legacy branch may be deleted when somebody can show no device still holds one. Until then it
 * stays, and this comment is what stops it being tidied away by someone who reads it as leftovers.
 */
export function queuedRegisters(payload: {
  registers?: RegisterBody[];
  register?: RegisterBody;
}): RegisterBody[] {
  if (payload.registers && payload.registers.length > 0) return payload.registers;
  return payload.register ? [payload.register] : [];
}

/**
 * Shape the offline payload for an accepted scan.
 *
 * `documentIds` are client-generated UUIDs, one per page, and they are what makes a replay a no-op:
 * the row is keyed by them, and the storage object is named from them, so a re-drained record
 * collides with itself rather than uploading a second copy.
 */
export function buildCapturePayloads(args: {
  loadId: string;
  documentIds: string[];
  pages: CapturedPage[];
}): { payload: HazmatCapturePayload; localUris: string[] } {
  if (args.documentIds.length !== args.pages.length) {
    // A caller that generated the wrong number of ids would otherwise register page 3 under page 2's
    // id, or drop it. Loud here beats mysterious at the server.
    throw new Error(
      `buildCapturePayloads: ${args.pages.length} page(s) but ${args.documentIds.length} document id(s)`,
    );
  }
  return {
    payload: {
      loadId: args.loadId,
      create: { id: args.loadId },
      registers: args.pages.map((page, index) => ({
        id: args.documentIds[index]!,
        kind: "bol",
        page: index + 1,
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
      })),
    },
    localUris: args.pages.map((page) => page.originalOfRecord.uri),
  };
}
