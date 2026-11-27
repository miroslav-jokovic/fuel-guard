import {
  buildCaptureTelemetry,
  type CaptureTelemetry,
  type CapturedPage,
} from "@silvicom/capture-engine";

/**
 * Pure capture view-logic (M6). No React Native imports → unit-tested and portable. The screen turns a
 * scan result into an accept/re-shoot decision here, and shapes the offline-outbox payload here.
 */

// The accept/refuse rule and its words are every document's, not only hazmat's: they live in
// `src/capture/captureDecision.ts` and are re-exported here so this feature's callers and tests read on.
export { REJECTION_COPY, decideCapture, type CaptureDecision, type PageRejection } from "@/capture/captureDecision";

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
    /** The ORIGINAL's hash. `sha256` above is the archive's — they differ from Phase 4b (0328). */
    integrityHash: string;
    quality: CapturedPage["quality"];
    ocrEvidence: CapturedPage["ocr"];
    /** Size of the object being uploaded to `storagePath`, so three outputs is a measured cost. */
    archiveBytes?: number;
    /** Declares that a distinct untouched ORIGINAL exists; the server signs a second upload URL. */
    original?: { bytes: number };
    /** Shadow-mode telemetry (Step 5.1) → `hazmat_documents.capture_metrics`. */
    metrics?: CaptureTelemetry;
  };
}

/**
 * The files one page needs uploaded, and the reason this is not just `fileUris` any more.
 *
 * A page was one file until Phase 4b. It is now two on the native path — the untouched ORIGINAL and
 * the derivative that uploads immediately and that extraction reads — and one on the JS fallback,
 * which picks a single image and has nothing to derive from it. Positional alignment between
 * `registers` and a flat `fileUris` cannot express that: the stride is 2 for one provider and 1 for
 * the other, and a handler that guessed would upload page 2's original as page 3's archive.
 *
 * `originalUri` is absent exactly when the provider produced one artifact, and that is DERIVED from
 * the page (the two fields point at the same file) rather than declared by a provider flag — a flag
 * would be a second source of truth for something the URIs already say.
 */
export interface PageUpload {
  archiveUri: string;
  originalUri?: string;
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
  /** One per page, in page order, page numbers 1..n. */
  registers: RegisterBody[];
  /**
   * Which STAGED files each register uploads, aligned by index with `registers`.
   *
   * Filled in by the caller after staging, because staging is IO and this module is pure. Absent on
   * a record queued before Phase 4b, and the handler falls back to `fileUris[index]` for those — the
   * outbox survives an app update, and a Friday capture that drains after a weekend update holds
   * work that exists nowhere else (plan §13.8 / D12).
   */
  uploads?: PageUpload[];
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
  /**
   * Which attempt at this document this scan is — 1 on the first, higher when the driver re-shot
   * after a rejection (Step 5.1). Optional so a caller that does not track it records nothing rather
   * than recording a confident 1, which would make the re-shoot rate — trigger (a) of the Phase 7
   * decision — read as zero for ever.
   */
  attempt?: number;
}): { payload: HazmatCapturePayload; uploads: PageUpload[] } {
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
      registers: args.pages.map((page, index) => {
        const archive = page.enhancedColor;
        return {
          id: args.documentIds[index]!,
          kind: "bol" as const,
          page: index + 1,
          // ⚠ The hash of the ARCHIVE, because `sha256` describes the object at `storagePath` and the
          // server downloads THOSE bytes and refuses a mismatch (Step 1.3). It used to be
          // `page.integrityHash`, which was correct only while a page had one file. `?? integrityHash`
          // is the single-artifact case, not a fallback for a missing value: when the two fields point
          // at the same file the page-level hash IS that file's hash.
          sha256: archive.sha256 ?? page.integrityHash,
          contentType: archive.mediaType ?? "image/webp",
          capture: {
            configVersion: page.metadata.configVersion,
            mode: page.provenance.captureMode,
            osEnhanced: page.provenance.osEnhanced,
            integrityHash: page.integrityHash, // the ORIGINAL's
            quality: page.quality,
            ocrEvidence: page.ocr,
            archiveBytes: archive.bytes,
            ...(hasDistinctOriginal(page) ? { original: { bytes: page.originalOfRecord.bytes ?? 0 } } : {}),
            // Every measured value, including the five the gate rendered `na` and therefore threw
            // away (Step 5.1). Built here rather than in the provider so it is the same record on
            // every provider, and pure so a test reaches it.
            metrics: buildCaptureTelemetry(page, { attempt: args.attempt }),
          },
        };
      }),
    },
    uploads: args.pages.map((page) => ({
      archiveUri: page.enhancedColor.uri,
      ...(hasDistinctOriginal(page) ? { originalUri: page.originalOfRecord.uri } : {}),
    })),
  };
}

/**
 * True when this page kept an untouched original separate from what it uploads for reading.
 *
 * Derived from the URIs rather than from a provider flag: the JS fallback aliases all four image
 * fields to the one file it has, and the native path does not. A flag would be a second statement of
 * something the page already says, which is the copy root CLAUDE.md's register warns about.
 */
function hasDistinctOriginal(page: CapturedPage): boolean {
  return page.originalOfRecord.uri !== page.enhancedColor.uri;
}
