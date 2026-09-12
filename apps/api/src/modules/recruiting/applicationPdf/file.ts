import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DOCUMENTS_BUCKET,
  documentStoragePath,
  type DriverApplication,
} from "@silvicom/shared";
import { renderApplicationPdf, type ApplicationPdfInput } from "./render.js";
import { authorizationsFor, carrierOf, esignConsentFor, signatureMarkBytes } from "./sources.js";

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
  applicant_user_agent: string | null;
}

export interface FiledApplicationPdf {
  documentId: string;
  storagePath: string;
  /** True when this call rendered it, false when it was already filed. */
  rendered: boolean;
}

/** Everything the document is drawn from — the shared reads in `sources.ts`, plus the certification. */
async function gather(
  admin: SupabaseClient,
  application: ApplicationRow,
): Promise<ApplicationPdfInput> {
  const orgId = application.org_id;
  const invitationId = application.invitation_id;
  return {
    signatureMark: await signatureMarkBytes(admin, orgId, invitationId),
    carrier: await carrierOf(admin, orgId),
    application: application.payload,
    applicationId: application.id,
    certifiedAt: application.certified_at,
    signedName: application.signed_name,
    applicantIp: application.applicant_ip,
    applicantUserAgent: application.applicant_user_agent,
    // Null: this is the FILED document. `preview.ts` is the other caller, and it is the only one
    // allowed to draw the band — a filed §391.51(b)(1) record that said DRAFT across every page
    // would be an auditor's first question.
    preview: null,
    authorizations: await authorizationsFor(admin, orgId, invitationId),
    esignConsent: await esignConsentFor(admin, orgId, invitationId),
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
    .select(
      "id, org_id, driver_id, invitation_id, payload, signed_name, certified_at, applicant_ip, applicant_user_agent",
    )
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
