import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICATION_CAPTURES_BUCKET,
  DOCUMENTS_BUCKET,
  documentStoragePath,
  type DriverApplication,
} from "@silvicom/shared";
import { renderApplicationPdf, type ApplicationPdfInput } from "./render.js";

/**
 * Rendering the application and filing it (A6).
 *
 * ── IT IS A DERIVATIVE, AND THE WHOLE ERROR STORY FOLLOWS FROM THAT (D-APP9) ──────────────────
 * The evidence is `driver_applications.payload`, the `driver_authorizations` rows and the
 * `esign_consents` row — all committed before this runs, all append-only, all in
 * `RETENTION_FORBIDDEN`. This produces a PDF from them. So a render failure is not a submission
 * failure: it costs a document that can be produced again from evidence that never moved, and
 * failing the driver's submission over it would trade something irreplaceable for something
 * regenerable.
 *
 * ── "LOGGED AND RETRIED", WITHOUT A QUEUE ─────────────────────────────────────────────────────
 * A6's text asks for a retry. `ensureApplicationPdf` IS the retry: it files the PDF if one is not
 * filed and returns the existing one if it is, so the same function serves the submit path (best
 * effort, immediately) and the recruiter's download (on demand, later). A failed render therefore
 * heals the next time anybody asks for the document, which for a derivative is a better guarantee
 * than a job kind — nothing to register, nothing to cap, no fleet-wide invariant to keep, and no
 * window where the queue is drained but the document is still missing.
 */

interface ApplicationRow {
  id: string;
  org_id: string;
  driver_id: string;
  invitation_id: string | null;
  payload: DriverApplication;
  signed_name: string;
  certified_at: string;
  applicant_ip: string | null;
}

export interface FiledApplicationPdf {
  documentId: string;
  storagePath: string;
  /** True when this call rendered it, false when it was already filed. */
  rendered: boolean;
}

/**
 * The drawn signature mark this session gave, if it gave one (A8b, D-APP8).
 *
 * ── HOW IT IS FOUND, WHICH IS NOT OBVIOUS ─────────────────────────────────────────────────────
 * The mark promotes into `documents` as kind `other`, which is indistinguishable from a promoted
 * `ssn_card` — so `documents` alone cannot answer "which of these is the signature". The index is the
 * staged row: `application_captures` names the slot, and A8a's identity property does the rest —
 * `documents.id` IS the capture id, so one lookup by slot gives the id of the filed copy.
 *
 * ── AND WHY THERE IS A FALLBACK ───────────────────────────────────────────────────────────────
 * This function runs in two situations that differ. Immediately after submit the promoted copy exists
 * in `compliance-docs`, which is where it should be read from — permanent, append-only, on the same
 * side of the evidence line as the document being drawn. On a re-render triggered before a submission
 * (there is no such path today, but `ensureApplicationPdf` is public and idempotent by design) only
 * the staged object exists. Both are tried, in that order.
 *
 * ⚠ EVERY FAILURE RETURNS NULL, INCLUDING "A11 PRUNED THE STAGING ROW". Once the retention rule lands,
 * a re-render years later will find no `application_captures` row and will draw the document with the
 * typed name alone — which is what D-APP8 says the signature of record has been the whole time. The
 * PDF filed on the day still carries the mark. If that is judged too lossy, A11's rule is one
 * exception away from keeping `signature_mark` rows; it is named in that step for exactly this reason.
 */
async function signatureMarkBytes(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string | null,
): Promise<Buffer | null> {
  try {
    return await readSignatureMark(admin, orgId, invitationId);
  } catch (e) {
    // The whole of D-APP8, as a catch block. Whatever went wrong reading an ornament, the
    // §391.51(b)(1) document still has to be producible — and on the recruiter's download path there
    // is no caller above this one that would forgive a throw.
    console.warn("[application] could not read the drawn signature mark", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

async function readSignatureMark(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string | null,
): Promise<Buffer | null> {
  if (!invitationId) return null;
  const { data: staged } = await admin
    .from("application_captures")
    .select("id, storage_path")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .eq("slot", "signature_mark")
    .maybeSingle();
  const capture = staged as { id: string; storage_path: string } | null;
  if (!capture) return null;

  const { data: filed } = await admin
    .from("documents")
    .select("storage_path")
    .eq("org_id", orgId)
    .eq("id", capture.id)
    .maybeSingle();
  const promoted = (filed as { storage_path?: string } | null)?.storage_path ?? null;

  const from: Array<[string, string]> = promoted
    ? [[DOCUMENTS_BUCKET, promoted]]
    : [[APPLICATION_CAPTURES_BUCKET, capture.storage_path]];
  for (const [bucket, path] of from) {
    const { data: blob } = await admin.storage.from(bucket).download(path);
    if (blob) return Buffer.from(await blob.arrayBuffer());
  }
  return null;
}


/** Everything the document is drawn from, read in one place so the renderer stays pure. */
async function gather(
  admin: SupabaseClient,
  application: ApplicationRow,
): Promise<ApplicationPdfInput> {
  const { data: org } = await admin
    .from("organizations")
    .select("name, legal_address")
    .eq("id", application.org_id)
    .maybeSingle();

  // The instruments THIS session collected, in the order they were signed. Keyed on the invitation
  // (A5): a rehire's older signatures belong to their own application, not to this document.
  const { data: auths } = await admin
    .from("driver_authorizations")
    .select("purpose, disclosure_version, disclosure_text, intent_statement, signed_name, accepted_at")
    .eq("org_id", application.org_id)
    .eq("invitation_id", application.invitation_id ?? "")
    .is("revokes", null)
    .order("accepted_at", { ascending: true });

  const { data: consent } = await admin
    .from("esign_consents")
    .select("disclosure_version, disclosure_text, intent_statement, consented_at")
    .eq("org_id", application.org_id)
    .eq("invitation_id", application.invitation_id ?? "")
    .maybeSingle();

  return {
    signatureMark: await signatureMarkBytes(admin, application.org_id, application.invitation_id),
    carrier: {
      name: (org as { name?: string } | null)?.name ?? "the carrier",
      address: (org as { legal_address?: string | null } | null)?.legal_address ?? null,
    },
    application: application.payload,
    applicationId: application.id,
    certifiedAt: application.certified_at,
    signedName: application.signed_name,
    applicantIp: application.applicant_ip,
    authorizations: (auths ?? []) as ApplicationPdfInput["authorizations"],
    esignConsent: (consent ?? null) as ApplicationPdfInput["esignConsent"],
  };
}

/**
 * File the rendered application, or hand back the one already filed.
 *
 * Idempotent by the `qualification_records` citation: `attach_application_document` sets
 * `document_id` only where it is null, so a second render loses the race harmlessly rather than
 * leaving the §391.51(b)(1) record pointing at a different copy of the same document.
 */
export async function ensureApplicationPdf(
  admin: SupabaseClient,
  orgId: string,
  applicationId: string,
): Promise<FiledApplicationPdf | null> {
  const { data: app } = await admin
    .from("driver_applications")
    .select("id, org_id, driver_id, invitation_id, payload, signed_name, certified_at, applicant_ip")
    .eq("org_id", orgId)
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) return null;
  const application = app as ApplicationRow;

  // Already filed? The §391.51(b)(1) record is the index: it cites the document, and citing it is the
  // last thing this function does, so a row with a `document_id` means a completed filing.
  const { data: cited } = await admin
    .from("qualification_records")
    .select("document_id")
    .eq("org_id", orgId)
    .eq("kind", "employment_application")
    .eq("reference", applicationId)
    .maybeSingle();
  const existingId = (cited as { document_id?: string | null } | null)?.document_id ?? null;
  if (existingId) {
    const { data: doc } = await admin
      .from("documents")
      .select("id, storage_path")
      .eq("org_id", orgId)
      .eq("id", existingId)
      .maybeSingle();
    const filed = doc as { id: string; storage_path: string } | null;
    if (filed) return { documentId: filed.id, storagePath: filed.storage_path, rendered: false };
  }

  const pdf = await renderApplicationPdf(await gather(admin, application));
  const documentId = randomUUID();
  const path = documentStoragePath(orgId, "driver", application.driver_id, documentId, "application/pdf");
  const { error: uploadError } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, pdf, { contentType: "application/pdf", upsert: false });
  if (uploadError) return null;

  await admin.from("documents").insert({
    id: documentId,
    org_id: orgId,
    subject_type: "driver",
    subject_id: application.driver_id,
    kind: "employment_application",
    storage_path: path,
    content_type: "application/pdf",
    bytes: pdf.byteLength,
    // The hash of the BYTES, which is where it can live — the footer carries the digest of the
    // source instead, because a file cannot contain its own hash (see `render.ts`).
    sha256: createHash("sha256").update(pdf).digest("hex"),
    // Nobody in the carrier uploaded this: the applicant's own submission produced it, and a staff id
    // here would misattribute it to whoever happened to open the page.
    uploaded_by: null,
  });

  await admin.rpc("attach_application_document", {
    p_org: orgId,
    p_application: applicationId,
    p_document: documentId,
  });

  return { documentId, storagePath: path, rendered: true };
}
