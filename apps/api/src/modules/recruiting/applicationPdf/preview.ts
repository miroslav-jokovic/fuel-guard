import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applicationProgress,
  type ApplicationDraftPayload,
  type ApplicationPhases,
} from "@silvicom/shared";
import { renderApplicationPdf } from "./render.js";
import { authorizationsFor, carrierOf, esignConsentFor, signatureMarkBytes } from "./sources.js";

/**
 * The application as a printable document BEFORE anybody has signed it (F6).
 *
 * ── WHY THE OFFICE NEEDS THIS ─────────────────────────────────────────────────────────────────
 * The review drawer shows the answers on a screen, which answers "what did they say". It does not
 * answer the things an office actually does with an application: read it away from the desk, print
 * it, put it in front of somebody who does not have a login, or post it to a terminal. Until this,
 * the ONLY way to get the §391.21 document out of this product was to wait for the driver to certify
 * it — and the whole point of the two-visit flow is that the office reads it first.
 *
 * ── IT IS THE SAME RENDERER, AND THAT IS THE STEP ─────────────────────────────────────────────
 * `renderApplicationPdf` over `application_drafts.payload` instead of `driver_applications.payload`.
 * Not a second draft-shaped renderer: the office is previewing the document that will be FILED, and
 * a second rendering of the same answers would be a second source of truth about what a §391.21
 * application looks like. Every page carries the band saying it certifies nothing.
 *
 * ── AND WHY IT REFUSES ONCE THE APPLICATION IS FILED ──────────────────────────────────────────
 * ⚠ A certified application already HAS a document — rendered at submit, hashed into
 * `documents.sha256`, cited by the §391.51(b)(1) `qualification_records` row, and offered on the
 * applicant's own page ("Open the application"). Re-rendering it here would hand somebody a second,
 * uncited copy of a filed federal record whose bytes do not match the one in the file. So this
 * refuses and says where the real one is.
 */

export interface PreviewError {
  code: string;
  message: string;
}

export const isPreviewError = (v: unknown): v is PreviewError =>
  typeof v === "object" && v !== null && "code" in v && "message" in v;

interface InvitationRow {
  id: string;
  org_id: string;
  driver_id: string;
  review_requested_at: string | null;
  approved_at: string | null;
  submitted_at: string | null;
}

export interface ApplicationPreview {
  pdf: Buffer;
  /** What the browser saves it as. "preview" is in the name so it cannot be mistaken for the filing. */
  filename: string;
}

export async function applicationPreviewPdf(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<ApplicationPreview | PreviewError> {
  const { data } = await admin
    .from("application_invitations")
    // The service role bypasses RLS, so the org filter is the only thing between two carriers.
    .select("id, org_id, driver_id, review_requested_at, approved_at, submitted_at")
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .maybeSingle();
  const invitation = (data as InvitationRow | null) ?? null;
  if (!invitation) {
    return { code: "application_not_found", message: "There is no application on this invitation." };
  }
  if (invitation.submitted_at) {
    return {
      code: "already_filed",
      message:
        "This application has been signed and filed. Open the filed application on the applicant's "
        + "page — that is the copy in the qualification file.",
    };
  }

  const { data: draft } = await admin
    .from("application_drafts")
    .select("payload")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  const payload = (draft as { payload?: Record<string, unknown> } | null)?.payload ?? null;
  if (!payload) {
    return {
      code: "nothing_to_preview",
      message: "They have not filled anything in yet, so there is nothing to print.",
    };
  }

  const phases: ApplicationPhases = {
    reviewRequestedAt: invitation.review_requested_at,
    approvedAt: invitation.approved_at,
    submittedAt: invitation.submitted_at,
  };

  const pdf = await renderApplicationPdf({
    carrier: await carrierOf(admin, orgId),
    /**
     * ⚠ Cast, not parsed — deliberately, and it is the same rule `file.ts` renders filed payloads
     * under. This is stored jsonb written by a form that has changed shape before and will again; a
     * preview that refused to draw because one key does not match today's contract would be exactly
     * the failure the renderer's `blank()`/`?? []` discipline exists to prevent. The office is owed
     * the document as it stands, gaps and all. The BINDING parse happens at certification.
     */
    application: payload as ApplicationDraftPayload,
    // The invitation, because there is no application row yet. The band and the footer both say so.
    applicationId: invitation.id,
    certifiedAt: null,
    signedName: "",
    applicantIp: null,
    applicantUserAgent: null,
    // ⚠ Passed, and it still only reaches the AUTHORIZATION pages: `render.ts` suppresses the mark
    // under the §391.21(b)(12) block on a preview, because a drawn signature beside an uncertified
    // statement is the one thing on these pages that could be mistaken for evidence (D-APP8).
    signatureMark: await signatureMarkBytes(admin, orgId, invitationId),
    preview: { stage: applicationProgress(phases, true) },
    // The releases ARE signed by now — they come before the form (D-AX11) — so the preview shows
    // which of them the carrier holds. That is half of what an office reads a draft application for.
    authorizations: await authorizationsFor(admin, orgId, invitationId),
    esignConsent: await esignConsentFor(admin, orgId, invitationId),
  });

  return { pdf, filename: `application-${invitation.id}-preview.pdf` };
}
