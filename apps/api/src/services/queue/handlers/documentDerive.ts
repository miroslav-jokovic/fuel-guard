import type { JobHandler } from "../types.js";
import { deriveDocument, DERIVER_VERSION } from "../../documentDerivatives.js";

/**
 * `document_derive` — thumb + normalized WebP for one compliance document (DQF plan B3).
 *
 * A QUEUE JOB, not part of the upload request: `POST /api/compliance/documents` returns before the
 * bytes even exist (the browser PUTs them to Storage afterwards), so the register call could not
 * wait on `sharp` even if it wanted to. The enqueue happens at registration; by the time a worker
 * claims the job the upload has almost always landed, and when it has not, `download_failed` fails
 * the job and the queue's retry meets the bytes on the next attempt.
 *
 * IDEMPOTENT: deriveDocument re-derives only missing variants, so a lease-expired retry is free and
 * a fully-derived document is a no-op — the same contract every handler in this registry keeps.
 */
export const documentDeriveHandler: JobHandler = async (ctx, job) => {
  const documentId = typeof job.payload.documentId === "string" ? job.payload.documentId : "";
  if (!documentId) throw new Error("document_derive job has no documentId");

  const result = await deriveDocument(ctx.admin, job.org_id, documentId);
  if ("code" in result) {
    // Not-derivable and already-derived come back as skips, never as codes — a code here is a real
    // failure (missing bytes, decode error, storage refusal) and the job should record it as one.
    throw new Error(`${result.code}: ${result.error}`);
  }
  return { documentId, created: result.created, skipped: result.skipped, version: DERIVER_VERSION };
};
