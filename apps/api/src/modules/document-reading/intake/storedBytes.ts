import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { INTAKE_LIMITS, type DocumentProfileId } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { DOCUMENT_BUCKET, sourceObjectPath } from "../storage.js";
import { intakeDedupKey, sourceBySha } from "./intake.js";

/**
 * Intake for bytes another module already holds (INSPECTION-CHALLENGE-PLAN IC10): the officer's report a
 * safety manager filed on an inspection lives in `evidence`'s `documents`, not here, and the person who
 * filed it was never asked to upload it twice.
 *
 * It is the office upload's three steps with the browser taken out — the same `<org>/<id>/source-<sha256>`
 * object, the same `document_intake` job, the same `runIntake` that renders, stores and queues the read —
 * so a report becomes a source exactly as a BOL does (D-DR1: a profile, never a second pipeline). The org
 * already holding these bytes (`unique (org_id, sha256)`, D-DR12) uploads nothing: the job is dispatched
 * for that source and `runIntake` only requests the read.
 *
 * The caller keeps the sha256 it gets back. A source is found again by its bytes, never by the id
 * dispatched here: when two intakes of the same bytes race, `runIntake` folds the second into the first.
 */
export type StoredBytesOutcome =
  | { ok: true; sourceId: string; sha256: string }
  | { ok: false; code: "too_large" | "upload_failed"; error: string };

export async function intakeStoredBytes(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  input: { bytes: Buffer; profile: DocumentProfileId; requestedBy: string | null },
  newId: () => string = randomUUID,
): Promise<StoredBytesOutcome> {
  if (input.bytes.length > INTAKE_LIMITS.maxBytes) {
    return { ok: false, code: "too_large", error: `The file is ${input.bytes.length} bytes; the reader takes ${INTAKE_LIMITS.maxBytes}.` };
  }
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const existing = await sourceBySha(admin, orgId, sha256);
  const sourceId = existing?.id ?? newId();
  if (!existing) {
    const { error } = await admin.storage
      .from(DOCUMENT_BUCKET)
      .upload(sourceObjectPath(orgId, sourceId, sha256), input.bytes, { contentType: "application/octet-stream", upsert: true });
    if (error) return { ok: false, code: "upload_failed", error: error.message };
  }
  // A dedupe conflict means this source's intake is already queued or running: the read it was asked
  // for is on its way, which is the answer the caller wanted.
  await dispatchJob(admin, env, "document_intake", {
    orgId,
    payload: { sourceId, sha256, profile: input.profile, requestedBy: input.requestedBy },
    dedupKey: intakeDedupKey(sourceId),
    requestedBy: input.requestedBy,
  });
  return { ok: true, sourceId, sha256 };
}
