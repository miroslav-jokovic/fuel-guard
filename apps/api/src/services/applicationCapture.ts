import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICATION_CAPTURES_BUCKET,
  APPLICATION_CAPTURE_DOCUMENT_KIND,
  APPLICATION_CAPTURE_PAGE,
  DOCUMENTS_BUCKET,
  applicationCaptureStoragePath,
  documentStoragePath,
  type ApplicationCaptureConfirm,
  type ApplicationCaptureContentType,
  type ApplicationCaptureSlot,
  type ApplicationCaptureStart,
  type ApplicationCaptureView,
} from "@silvicom/shared";
import {
  ALREADY_SUBMITTED,
  isIntakeError,
  requireEsignConsent,
  resolveInvitation,
  type IntakeError,
} from "./applicationIntake.js";

/**
 * The applicant's photographs, staged and promoted (A8, D-APP10).
 *
 * ── THE ORDER OF OPERATIONS IS THE WHOLE DESIGN ───────────────────────────────────────────────
 * mint a signed URL (no row) → the browser PUTs to Storage → confirm reads the object back and
 * writes the row → submit copies the object into `compliance-docs` and files the `documents` row in
 * the same transaction as the certified application.
 *
 * Every failure in that chain leaves BYTES nobody references, never a ROW citing bytes that are not
 * there. That asymmetry is deliberate and it is the opposite of `compliance.ts`'s register-then-upload,
 * which is right for evidence — a claim that a document exists must outlive a dropped connection, and
 * the nightly reconcile flags a missing object loudly as possible evidence loss (D13). Here a row
 * means "this photograph is in the bucket and the driver has been told the slot is filled", so it is
 * written last. Orphaned bytes are collected by that same sweep after its 24-hour grace.
 *
 * ── AND WHY THE BYTES NEVER TOUCH THIS PROCESS ────────────────────────────────────────────────
 * A signed upload URL out, a Storage-to-Storage copy at submit. The API reads metadata about the
 * object and never the object, which is `compliance.ts:110`'s property and the reason a driver
 * uploading a 6 MB photograph on a truck-stop connection does not occupy an API worker while they do.
 */

/** A staged capture, as the promotion and the applicant's own page need to see it. */
interface CaptureRow {
  id: string;
  slot: ApplicationCaptureSlot;
  storage_path: string;
  content_type: ApplicationCaptureContentType;
  bytes: number | null;
  sha256: string;
  captured_at: string;
}

const CAPTURE_COLUMNS = "id, slot, storage_path, content_type, bytes, sha256, captured_at";

/**
 * The three refusals every capture call shares with every other write on this link.
 *
 * Live token, 7001(c) consent given, application not yet certified — in that order. The last one is
 * not housekeeping: `documents` rows are filed by the submit transaction from the staged set, so a
 * photograph staged afterwards would sit in a bucket that nothing will ever promote, and telling the
 * driver it was received would be a lie.
 */
async function openSession(
  admin: SupabaseClient,
  token: string,
  now: Date,
): Promise<{ id: string; org_id: string; driver_id: string } | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  const consent = requireEsignConsent(invitation);
  if (consent) return consent;
  if (invitation.submitted_at) return ALREADY_SUBMITTED;
  return invitation;
}

export const CAPTURE_UPLOAD_FAILED: IntakeError = {
  code: "capture_upload_failed",
  message: "That photo did not finish uploading. Take it again.",
};

/**
 * Somewhere to put one photograph — and nothing else.
 *
 * No row is written here, so a browser that never completes the PUT has changed nothing. The capture
 * id is minted server-side rather than accepted: it becomes the storage key AND, at promotion, the
 * `documents.id`, which is what makes filing exactly-once by identity rather than by a flag.
 */
export async function startCapture(
  admin: SupabaseClient,
  token: string,
  body: ApplicationCaptureStart,
  now: Date,
): Promise<{ captureId: string; storagePath: string; uploadUrl: string; uploadToken: string } | IntakeError> {
  const session = await openSession(admin, token, now);
  if (isIntakeError(session)) return session;

  const captureId = randomUUID();
  const storagePath = applicationCaptureStoragePath(
    session.org_id, session.id, captureId, body.content_type,
  );
  const { data, error } = await admin.storage
    .from(APPLICATION_CAPTURES_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error || !data) {
    return { code: "capture_sign_failed", message: "Could not start the upload. Try again." };
  }
  return { captureId, storagePath, uploadUrl: data.signedUrl, uploadToken: data.token };
}

/**
 * What Storage says about one object — or null when it is not there.
 *
 * `list` with a search rather than `info`: it is the oldest and most widely supported call in the
 * Storage API, and this path must not be the thing that breaks on a Storage version we did not
 * choose. The size comes back as metadata, and taking it from HERE rather than from the request body
 * is what makes the staged row a description of the object rather than of what a client claimed.
 */
async function statObject(
  admin: SupabaseClient,
  path: string,
): Promise<{ bytes: number | null } | null> {
  const cut = path.lastIndexOf("/");
  const dir = cut < 0 ? "" : path.slice(0, cut);
  const name = cut < 0 ? path : path.slice(cut + 1);
  const { data, error } = await admin.storage
    .from(APPLICATION_CAPTURES_BUCKET)
    .list(dir, { limit: 100, search: name });
  if (error) return null;
  const hit = ((data ?? []) as Array<{ name: string; metadata?: { size?: number } }>)
    .find((o) => o.name === name);
  if (!hit) return null;
  // Nullable rather than defaulted: Storage does not always report a size, and a wrong number on a
  // row that claims to describe an object is worse than an honest absence.
  return { bytes: typeof hit.metadata?.size === "number" ? hit.metadata.size : null };
}

/**
 * The bytes landed: stage the row, replacing whatever that slot held.
 *
 * The object is read back first. A confirm for an upload that never happened is refused rather than
 * recorded, because the only thing this row is for is telling the driver — and then the submit
 * transaction — that the photograph exists.
 *
 * The superseded object is removed best effort. A failure there costs bytes the nightly sweep will
 * collect; failing the driver's re-shoot over it would cost the photograph.
 */
export async function confirmCapture(
  admin: SupabaseClient,
  token: string,
  captureId: string,
  body: ApplicationCaptureConfirm,
  now: Date,
): Promise<{ slot: ApplicationCaptureSlot; capturedAt: string } | IntakeError> {
  const session = await openSession(admin, token, now);
  if (isIntakeError(session)) return session;

  /**
   * The key is RECOMPUTED, never accepted. It is derived from the org and the invitation this token
   * resolved to, so the request can name a content type and cannot name a prefix outside its own
   * session — the same reason no endpoint on this surface takes an org id (`publicApplication.ts`).
   */
  const path = applicationCaptureStoragePath(
    session.org_id, session.id, captureId, body.content_type,
  );
  const found = await statObject(admin, path);
  // Nothing at that key: either the PUT never finished or it went somewhere else. Either way there is
  // no photograph, and recording one would be the lie this ordering exists to prevent.
  if (!found) return CAPTURE_UPLOAD_FAILED;

  const { data, error } = await admin.rpc("stage_application_capture", {
    p_org: session.org_id,
    p_invitation: session.id,
    p_driver: session.driver_id,
    p_capture: captureId,
    p_slot: body.slot,
    p_path: path,
    // The type the key was minted for — and the object is provably at that key, which is what makes
    // the claim checked rather than trusted. Storage's own reported mime type is a second opinion a
    // proxy or a browser can get wrong.
    p_content_type: body.content_type,
    p_bytes: found.bytes,
    p_sha256: body.sha256,
  });
  if (error) return { code: "capture_stage_failed", message: error.message };

  const row = data as { captured_at?: string; replaced_path?: string | null } | null;
  const replaced = row?.replaced_path ?? null;
  if (replaced && replaced !== path) {
    const { error: removeError } = await admin.storage.from(APPLICATION_CAPTURES_BUCKET).remove([replaced]);
    if (removeError) {
      console.warn("[application] could not remove a superseded capture", { path: replaced });
    }
  }
  return { slot: body.slot, capturedAt: String(row?.captured_at ?? now.toISOString()) };
}

/**
 * What this session has photographed, for `GET /:token`.
 *
 * Slots and dates, not pictures. The driver took them and has already seen them; re-serving them
 * would mean minting a signed read URL per slot on an unauthenticated surface, on every page load,
 * for no decision the driver has to make.
 */
export async function listCaptures(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<ApplicationCaptureView[]> {
  const { data } = await admin
    .from("application_captures")
    .select(CAPTURE_COLUMNS)
    // The service role bypasses RLS: this query carries its own tenant scope even though the
    // invitation id came from a resolved token.
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId);
  return ((data ?? []) as CaptureRow[]).map((row) => ({
    slot: row.slot,
    contentType: row.content_type,
    bytes: row.bytes,
    capturedAt: row.captured_at,
  }));
}

/** One staged capture, as `submit_driver_application` files it. */
export interface PromotedCapture {
  capture_id: string;
  kind: string;
  page: number;
  storage_path: string;
}

export const CAPTURE_PROMOTION_FAILED: IntakeError = {
  code: "capture_promotion_failed",
  message: "We could not attach your photos to the application. Try sending it again.",
};

/**
 * Copy every staged capture into the evidence bucket, ready for the submit transaction to file.
 *
 * ── WHY THIS RUNS BEFORE THE TRANSACTION AND NOT AFTER ────────────────────────────────────────
 * Bytes cannot be moved from SQL, and the two possible orders fail differently. Copy first and the
 * transaction may roll back over objects nobody references — collected by the nightly sweep. Write
 * the rows first and a failed copy leaves `documents` citing evidence that is not there, which is the
 * one state 0146's whole design exists to prevent. So: copy, then file.
 *
 * ── AND WHY A FAILED COPY REFUSES THE SUBMISSION ──────────────────────────────────────────────
 * The rendered PDF (A6) is a derivative and never fails a submission, because it can be produced
 * again from evidence that never moved. A photograph is not: the only copy is in a staging bucket
 * that A11 will prune, and filing the application without it would put a driver's licence beyond
 * reach of the file it belongs to, silently. The staged rows are untouched by the refusal, so
 * pressing send again promotes the same set.
 */
export async function promoteCaptures(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  driverId: string,
): Promise<PromotedCapture[] | IntakeError> {
  const { data, error } = await admin
    .from("application_captures")
    .select(CAPTURE_COLUMNS)
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId);
  if (error) return CAPTURE_PROMOTION_FAILED;

  const rows = (data ?? []) as CaptureRow[];
  const promoted: PromotedCapture[] = [];
  for (const row of rows) {
    // The filed document IS the staged capture, by id. That is what makes promotion exactly-once: a
    // replayed copy lands on the same key and a replayed insert would violate the primary key rather
    // than quietly produce a second copy of a licence.
    const destination = documentStoragePath(orgId, "driver", driverId, row.id, row.content_type);
    const { error: copyError } = await admin.storage
      .from(APPLICATION_CAPTURES_BUCKET)
      .copy(row.storage_path, destination, { destinationBucket: DOCUMENTS_BUCKET });
    if (copyError && !(await objectExists(admin, DOCUMENTS_BUCKET, destination))) {
      console.error("[application] could not promote a staged capture", {
        slot: row.slot,
        error: copyError.message,
      });
      return CAPTURE_PROMOTION_FAILED;
    }
    promoted.push({
      capture_id: row.id,
      kind: APPLICATION_CAPTURE_DOCUMENT_KIND[row.slot],
      page: APPLICATION_CAPTURE_PAGE[row.slot],
      storage_path: destination,
    });
  }
  return promoted;
}

/**
 * Did the copy already happen?
 *
 * Asked only when a copy failed, and it is what makes a retried submission work: the second attempt's
 * copy is refused because the destination exists, which is success wearing an error's clothes. Tested
 * by looking rather than by matching on an error string, because the string belongs to a service we
 * do not version.
 */
async function objectExists(admin: SupabaseClient, bucket: string, path: string): Promise<boolean> {
  const cut = path.lastIndexOf("/");
  const dir = cut < 0 ? "" : path.slice(0, cut);
  const name = cut < 0 ? path : path.slice(cut + 1);
  const { data } = await admin.storage.from(bucket).list(dir, { limit: 100, search: name });
  return ((data ?? []) as Array<{ name: string }>).some((o) => o.name === name);
}
