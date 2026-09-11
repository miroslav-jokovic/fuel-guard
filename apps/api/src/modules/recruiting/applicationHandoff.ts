import type { SupabaseClient } from "@supabase/supabase-js";
import { type ApplicationPath } from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";
import {
  ALREADY_SUBMITTED,
  isIntakeError,
  resolveInvitation,
  type IntakeError,
} from "./applicationIntake.js";

/**
 * The driver handing the finished application to the office (F4, D-AX11).
 *
 * ── WHY THERE IS A PHASE HERE AT ALL ──────────────────────────────────────────────────────────
 * Until now an application went straight from the driver's last screen into the qualification file:
 * they certified §391.21(b)(12) and it was filed, read by nobody. The owner's words: *"complete
 * application should be reviewable and editable on our side in dashboard and after that when
 * approved and reviewed we should send it back to driver for signing."* So the driver's last act on
 * the first visit is to hand it over, and the certification — which is a statement about the
 * document as it finally stands — happens on the second, after the office has corrected whatever it
 * corrected. A certification of answers somebody else has since changed certifies something else.
 *
 * ── WHAT THIS ENDPOINT DELIBERATELY DOES NOT CHECK ────────────────────────────────────────────
 * Completeness. The applicant's page runs `driverApplicationSchema` — the server's own object — over
 * the whole document before it calls this, and the binding check is at CERTIFICATION, where the
 * record is actually filed and where the document is parsed in full. A second completeness check
 * here would have to be written against the DRAFT shape rather than the contract shape (the draft
 * holds `questionnaire`, empty strings, and numbers as text), which means restating the contract in
 * a second vocabulary — and the reader in between is a person, who can see an unfinished application
 * for what it is and decline to approve it.
 *
 * ── AND WHY IT IS IDEMPOTENT ──────────────────────────────────────────────────────────────────
 * "Send it" is a button on a phone with a slow connection. A second tap must not move the phase
 * again or write a second audit row; the first hand-off is the one that happened.
 */

export interface HandoffContext {
  ip: string | null;
  userAgent: string | null;
}

/**
 * One correction, as the person who wrote the answer is shown it (D-AX12).
 *
 * ⚠ `editedBy` is NOT here, and its absence is the decision. The driver is owed what changed about
 * their own statement before they swear to it; which member of staff typed it is the carrier's
 * internal record, and naming an individual to an applicant is a different thing from telling them
 * the carrier corrected something.
 */
export interface ApplicantVisibleEdit {
  path: ApplicationPath;
  before: unknown;
  after: unknown;
  editedAt: string;
}

/** What the office changed, for the screen that asks the driver to certify it (D-AX12). */
export async function applicantVisibleEdits(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<ApplicantVisibleEdit[]> {
  const { data } = await admin
    .from("application_edits")
    .select("path, before, after, edited_at")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .order("edited_at", { ascending: true });

  return (data ?? []).map((row) => {
    const e = row as { path: ApplicationPath; before: unknown; after: unknown; edited_at: string };
    return { path: e.path, before: e.before, after: e.after, editedAt: e.edited_at };
  });
}

export const NOTHING_TO_REVIEW: IntakeError = {
  code: "nothing_to_review",
  message: "There is nothing saved on this application yet. Fill it in and send it again.",
};

/**
 * Hand the application to the office.
 *
 * Returns when it was handed over — the first time, or the time it was already handed over.
 */
export async function requestReview(
  admin: SupabaseClient,
  token: string,
  ctx: HandoffContext,
  now: Date,
): Promise<{ reviewRequestedAt: string } | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  if (invitation.submitted_at) return ALREADY_SUBMITTED;
  if (invitation.review_requested_at) return { reviewRequestedAt: invitation.review_requested_at };

  // There has to BE an application. The draft is what the office opens, and stamping a phase over an
  // empty one puts a row in somebody's queue with nothing in it.
  const { data: draft } = await admin
    .from("application_drafts")
    .select("invitation_id")
    .eq("org_id", invitation.org_id)
    .eq("invitation_id", invitation.id)
    .maybeSingle();
  if (!draft) return NOTHING_TO_REVIEW;

  const reviewRequestedAt = now.toISOString();
  const { error } = await admin
    .from("application_invitations")
    .update({ review_requested_at: reviewRequestedAt })
    .eq("org_id", invitation.org_id)
    .eq("id", invitation.id)
    // ⚠ The filter, not the read above, is what makes two taps one hand-off: a check-then-write has a
    // gap, and this path is a button on a phone that gets pressed twice.
    .is("review_requested_at", null);
  if (error) {
    return { code: "handoff_failed", message: "That could not be sent. Try again." };
  }

  /**
   * ⚠ `actorId` is null and must be: an applicant is not a user of this system, holds no session and
   * has no row in `members`. The invitation is the actor's whole identity here, and it is the entity
   * the row points at.
   */
  await writeAudit(admin, {
    orgId: invitation.org_id,
    actorId: null,
    action: "application_review_requested",
    entity: "application_invitations",
    entityId: invitation.id,
    meta: { driverId: invitation.driver_id, ip: ctx.ip, userAgent: ctx.userAgent },
  });

  return { reviewRequestedAt };
}
