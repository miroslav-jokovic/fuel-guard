import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "../../lib/audit.js";
import { applicationPreviewPdf, isPreviewError } from "./applicationPdf/preview.js";
import { packetMarksFor } from "./applicationPdf/packetDocument.js";
import { signatureMarkBytes } from "./applicationPdf/sources.js";
import { isIntakeError, resolveInvitation, type IntakeError } from "./applicationIntake.js";

/**
 * The packet the driver is ABOUT to sign, served to the driver (C1).
 *
 * ── THE DEFECT THIS EXISTS TO FIX ─────────────────────────────────────────────────────────────
 * Nine public routes hung off an application link and not one of them served the packet. The
 * ceremony walked a driver to twenty-two named places, told them the carrier's page number and the
 * sentence for each, and asked for a signature — **without ever showing them the page**. Rendered at
 * 1440px, stop 1 reads "Page 3 of the application", "Orientation and the drug test it includes",
 * and a Sign here button, with nothing on the screen that is the page. That is somebody signing a
 * federal record they have not read, which is what C1's done-when sentence is about: *a driver can
 * read the page they are about to sign, on the page they are about to sign it*.
 *
 * ── WHY THE TOKEN IS ENOUGH ───────────────────────────────────────────────────────────────────
 * ⚠ `applicationCopy.ts`'s bar, and it is a good one: ask what the holder of the credential can see
 * that they could not see before. Here: **nothing**. The same token already reads the draft — a date
 * of birth, an address history, an employment history — and has already signed four federal
 * authorizations in this person's name. Serving them the document assembled from their own answers
 * is not an escalation; refusing it while the draft is readable would be the incoherent position.
 *
 * The same three bounds apply anyway, because "not an escalation" is not "unbounded":
 *   · **Only while the link is LIVE.** `resolveInvitation` is the whole gate, and a dead link gets
 *     the one neutral refusal this surface gives every dead link.
 *   · **Only before filing.** After submission the FILED copy is the document, and it is served by
 *     `GET /:token/document` from storage with its hash. Two copies of a filed federal record, one
 *     re-rendered on demand, is the state that endpoint's header refuses and this one must not
 *     create.
 *   · **Audited.** `application_packet_read` names the org, the invitation and how many marks were
 *     on the paper when it was read.
 *
 * ── ⚠ THE ONE THING THAT IS NOT LIKE `applicationCopy.ts` ─────────────────────────────────────
 * That one returns a signed URL; this returns BYTES. The difference is not a change of idiom — it
 * is that there is no object to sign a URL to. A filed application is in Storage, hashed and cited;
 * this document is rendered on demand from the draft and deliberately not stored, because storing it
 * would put an unsigned, uncited copy of a §391.51(b)(1) record beside the real one. ⚠ **Nothing
 * here may write the PDF anywhere.** The freeze is at filing, and an artifact that outlives the
 * request is the beginning of a second filing path.
 *
 * ── AND WHY IT DOES NOT REFUSE BEFORE APPROVAL (D-HUI12) ──────────────────────────────────────
 * `POST /:token/mark` answers `packet_not_yet_approved` while the office is still reading, and that
 * is right: signing is the act that has to wait. **Reading is not signing.** A driver who opens
 * their link the evening they send it should be able to read what they will be asked to put their
 * name on, before anybody asks them. Gating the reading copy on the office's approval would mean
 * the only moment a driver can study the document is the moment they are being asked to sign it,
 * which is the pressure C1 exists to remove.
 */

export interface ApplicantReadingCopy {
  pdf: Buffer;
  filename: string;
  /** How many of the twenty-two are already on the paper, for the audit line and for the client. */
  markCount: number;
}

/**
 * ⚠ Deliberately the same shape and status as `applicationCopy.ts`'s refusals, and one of them is
 * the same CODE. A link that has been filed is not an error the driver caused; the document they
 * want exists and is one route away.
 */
const ALREADY_FILED: IntakeError = {
  code: "already_filed",
  message: "You have sent this application. Open your copy to read what was filed.",
};

const NOTHING_TO_READ: IntakeError = {
  code: "nothing_to_read",
  message: "There is nothing to show yet. Fill in your application first.",
};

export async function applicantReadingCopy(
  admin: SupabaseClient,
  token: string,
  now: Date,
): Promise<ApplicantReadingCopy | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  // ⚠ Before `applicationPreviewPdf`'s own `already_filed`, so the driver gets the sentence that
  // points at their filed copy rather than the one written for an office that clicked Preview on a
  // finished application.
  if (invitation.submitted_at) return ALREADY_FILED;

  /**
   * What is already on the paper (D-HUI11), and the pictures those marks were made with.
   *
   * ⚠ **BOTH marks, because the packet carries both** (Q-HUI14). The signature goes on nineteen
   * lines and the initials on three, and a reading copy that fetched only the signature would show
   * this driver `p05`, `p06` and `p09` in Helvetica while the packet they are signing prints their
   * own hand there. That is A2's failure — two renderings of one document disagreeing — reached
   * through the reading copy instead of through the office's preview.
   *
   * ⚠ Still gated on `marks.length`: with nothing signed there is no line for a picture to sit on,
   * and this is a public unauthenticated route where two Storage reads per open are worth not making.
   */
  const marks = await packetMarksFor(admin, invitation.org_id, invitation.id);
  const drawnMark = marks.length
    ? await signatureMarkBytes(admin, invitation.org_id, invitation.id, "signature")
    : null;
  const initialsMark = marks.length
    ? await signatureMarkBytes(admin, invitation.org_id, invitation.id, "initials")
    : null;

  const preview = await applicationPreviewPdf(admin, invitation.org_id, invitation.id, {
    marks,
    // D-HUI10. The route's header says why a document that is not filed is nonetheless shown
    // unbanded to the person being asked to sign it.
    band: null,
    drawnMark,
    initialsMark,
  });
  if (isPreviewError(preview)) {
    // ⚠ Mapped, not passed through. `applicationPreviewPdf`'s sentences are written for an office
    // reading somebody else's application — "They have not filled anything in yet" is addressed to
    // a recruiter, and the applicant is the person who did not fill it in.
    if (preview.code === "already_filed") return ALREADY_FILED;
    return NOTHING_TO_READ;
  }

  // ⚠ Awaited, and the result deliberately ignored — `applicationCopy.ts`'s reasoning exactly.
  // `writeAudit` retries once and returns false rather than throwing, and a driver must not be
  // refused the document they are about to sign because the audit table was briefly unavailable,
  // but the read must not go out before the attempt to record it.
  await writeAudit(admin, {
    orgId: invitation.org_id,
    actorId: null,
    action: "application_packet_read",
    entity: "application_invitations",
    entityId: invitation.id,
    meta: { marks: marks.length },
  });

  return {
    pdf: preview.pdf,
    // ⚠ Not "preview", and not the office's filename. This is the driver's own paper, and the word
    // preview on it would suggest the thing they are signing is a rehearsal.
    filename: "your-application.pdf",
    markCount: marks.length,
  };
}
