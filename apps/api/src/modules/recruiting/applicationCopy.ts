import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET } from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";
import { ensureApplicationPdf } from "./applicationPdf/file.js";
import { isIntakeError, resolveInvitation, type IntakeError } from "./applicationIntake.js";

/**
 * The applicant's own copy of what the carrier filed (APPLY-EXPERIENCE-PLAN X8, D-AX9).
 *
 * ── WHY THIS DID NOT EXIST, AND WHY THAT WAS A GAP ────────────────────────────────────────────
 * Nine public routes hang off an application link and not one of them served a document. Our own
 * 7001(c) consent tells the driver, in the carrier's name, that *"after you have sent your
 * application you can ask the carrier for a paper copy of anything you signed, at no charge"* — which
 * discharges 15 U.S.C. 7001(c)(1)(B)(iv) and is a long way below what somebody who has ever used a
 * commercial e-signature product expects, which is the finished document before they put the phone
 * down.
 *
 * ── WHY THE TOKEN IS ENOUGH, AND WHY THAT IS NOT A SHORTCUT ───────────────────────────────────
 * ⚠ The question to ask of a new public route is what it lets the holder of the credential see that
 * they could not see before. This one: nothing. The same token already reads the draft — which holds
 * a date of birth, an address history and an employment history — and already signed four federal
 * authorizations in this person's name. Serving them the document assembled from their own answers is
 * not an escalation; refusing it while the draft is readable would be the incoherent position.
 *
 * Three things bound it anyway, because "not an escalation" is not the same as "unbounded":
 *   · **Only after submission.** Before that there is no filed document, and the draft is already
 *     reachable through the endpoint that exists for it.
 *   · **A short-lived signed URL**, at `compliance.ts`'s own TTL. The bytes never pass through this
 *     API, and a URL copied out of a browser history is stale within minutes.
 *   · **Audited.** `application_copy_downloaded` names the org, the application and the invitation.
 *     A read of an evidence document is an event somebody may later need to account for, and an
 *     unauthenticated read of one especially so.
 *
 * ── AND WHY IT RENDERS ON DEMAND RATHER THAN 404-ING ──────────────────────────────────────────
 * `ensureApplicationPdf` is idempotent by the §391.51(b)(1) citation: it hands back the filed
 * document if there is one and produces it if there is not. A submitted application whose PDF failed
 * to upload at submit time is a real state — the renderer is a derivative and its failure is designed
 * to cost nothing irreplaceable — and the driver asking for their copy is as good a moment as any to
 * notice. The alternative is telling somebody their own application does not exist.
 */

export interface ApplicantCopy {
  url: string;
  filename: string;
  /** So the page can say how long the link is good for without hardcoding the same number twice. */
  expiresInSeconds: number;
}

/**
 * Matches `compliance.ts`'s `DOCUMENT_URL_TTL_SEC`: long enough to start a download on a truck-stop
 * connection, short enough that a URL left in a browser history is already dead.
 */
export const APPLICANT_COPY_TTL_SEC = 300;

const NOT_SUBMITTED: IntakeError = {
  code: "not_submitted",
  message: "You can download your copy once you have sent your application.",
};

const NO_DOCUMENT: IntakeError = {
  code: "document_unavailable",
  message: "Your copy could not be prepared just now. Try again in a moment, or ask the carrier for it.",
};

export async function applicantCopy(
  admin: SupabaseClient,
  token: string,
  now: Date,
): Promise<ApplicantCopy | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  if (!invitation.submitted_at) return NOT_SUBMITTED;

  const { data } = await admin
    .from("driver_applications")
    .select("id")
    .eq("org_id", invitation.org_id)
    .eq("invitation_id", invitation.id)
    .maybeSingle();
  const applicationId = (data as { id?: string } | null)?.id ?? null;
  // The invitation says it was submitted and no application answers to it. That is a broken
  // invariant rather than a state the driver caused, so it reads as "not just now" and not as
  // "your link is not valid" — which would send them back to a recruiter for a replacement link
  // that would not help.
  if (!applicationId) return NO_DOCUMENT;

  const filed = await ensureApplicationPdf(admin, invitation.org_id, applicationId);
  if (!filed) return NO_DOCUMENT;

  const { data: signed, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(filed.storagePath, APPLICANT_COPY_TTL_SEC, { download: "driver-application.pdf" });
  if (error || !signed?.signedUrl) return NO_DOCUMENT;

  // ⚠ Awaited, and the result deliberately ignored. `writeAudit` retries once and returns false
  // rather than throwing, and a driver must not be refused their own document because the audit
  // table was briefly unavailable — but the read must not go out before the attempt to record it.
  await writeAudit(admin, {
    orgId: invitation.org_id,
    actorId: null,
    action: "application_copy_downloaded",
    entity: "driver_applications",
    entityId: applicationId,
    meta: { invitationId: invitation.id, documentId: filed.documentId, rendered: filed.rendered },
  });

  return {
    url: signed.signedUrl,
    filename: "driver-application.pdf",
    expiresInSeconds: APPLICANT_COPY_TTL_SEC,
  };
}
