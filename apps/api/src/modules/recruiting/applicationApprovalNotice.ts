import type { SupabaseClient } from "@supabase/supabase-js";
import { renderApplicationApprovedEmail } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { sendEmail } from "../../lib/mailer.js";
import { mintInvitationToken } from "./applicationIntake.js";
import { sendApplicationSms } from "./applicationSms.js";

/**
 * Telling the applicant they have been approved (Q-AX4, D-AX14).
 *
 * ── THE SEAM THIS CLOSES ──────────────────────────────────────────────────────────────────────
 * F4 made the application a two-visit document: the driver hands it over, the office reads and
 * corrects it, the driver comes back and certifies what now stands. Nothing carried the middle step.
 * The office approved days later and the only thing that told the driver was reopening their own link
 * on the off-chance — so the waiting screen promised nothing, and the recruiter's drawer said "the
 * applicant has been asked to sign it" when nobody had asked them anything.
 *
 * Q-AX4's candidates were (a) send it from the approval, (b) a separate "tell them it is ready"
 * button, (c) nothing and the recruiter phones. (a), because the office has already made its decision
 * by then and a step that can be forgotten is a step that will be forgotten.
 *
 * ── ⚠ WHY NOTHING HERE ROTATES A TOKEN ────────────────────────────────────────────────────────
 * There is no link to send. 0220 stores a SHA-256 and the plaintext is returned once at mint. The
 * abandonment sweep's answer is to rotate the hash and email the new token (0232), and that answer is
 * REJECTED here: `APPLY_FLOW_COPY.handoff` told this applicant "keep this link — it is where you will
 * sign, and it still works", and approval is the moment they act on it. Rotating would break the
 * product's one promise to them at the one moment it is load-bearing, and would open a lockout this
 * flow cannot afford — a nudge that fails to send costs a driver an unfinished form, an approval that
 * fails to send would cost them a COMPLETED application they can no longer reach.
 *
 * So the email names the earlier email's subject line and sends them to their own inbox
 * (`renderApplicationApprovedEmail` carries the full argument). The cost is a search; the recovery,
 * when even that fails, is the recruiter, who can revoke and re-invite.
 *
 * ── A REFUSAL IS AN OUTCOME, NEVER A FAILURE ─────────────────────────────────────────────────
 * Same rule the invitation route set: the approval is committed and audited before this is called,
 * and whatever this returns is reported beside it rather than raised. An approval that rolled back
 * because a mail provider was rate-limited would strand a driver who is allowed to sign behind a
 * state that says they are not.
 */

/** What became of the notice. `sent: false` is a sentence for the recruiter, not an error. */
export interface ApprovalNotice {
  sent: boolean;
  /** Where it went, echoed so the drawer can name the address without re-reading the row. */
  email: string | null;
  /** `no_address` | `mail_disabled` | `send_failed` | `already_notified`. null when it went. */
  reason: string | null;
  /** Whether a text also went out. Always false until 10DLC registration completes (A11b). */
  texted: boolean;
}

/**
 * The text, inside one 160-character segment.
 *
 * Carrier identification and a discoverable `STOP` are both required in the body by every US
 * messaging programme — see `smsBody` in the nudge sweep for the full reasoning. What is left says
 * the one thing this message exists to say, and points at the same place the email does.
 *
 * ⚠ **A5b deliberately did NOT put the new sign link in here, and the segment is why.** Measured
 * 2026-09-18: this body with a real apply URL runs 170–193 characters depending on the carrier's
 * name, so a link costs the single-segment property the line above claims, and carriers bill per
 * segment. The nudge next door already pays that price (199 characters) because a driver who
 * abandoned a form has nothing else to act on. Here the sentence stays true and gets truer — the
 * email it points at now carries a link of its own — and A5b's requirement was about the email.
 */
export const approvedSmsBody = (carrier: string): string =>
  `${carrier}: your driver application has been reviewed and is ready to sign. Open the application `
  + `link we emailed you. Reply STOP to opt out.`;

/**
 * The carrier's own name — what the applicant recognises, since they applied to a trucking company
 * rather than to this product. Falls back rather than failing, like `carrierName` next door: a notice
 * that says "the carrier" is worth sending, and one that never went because an org row had no name is
 * not.
 */
async function carrierName(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? "the carrier";
}

/**
 * Mint the sign token and store its hash, returning the link to send — or null.
 *
 * ── ⚠ WHY THIS IS A SECOND HASH AND NOT A ROTATION (A5b, D-AX15, 0345) ────────────────────────
 * `token_hash` is not touched. The applicant's original link keeps working, which is what lets the
 * waiting screen go on promising that it will; the whole objection this step had to answer was that
 * rotating breaks that promise at the moment the applicant acts on it. Approval adds a door.
 *
 * ── AND WHY THE UPDATE REFUSES TO OVERWRITE ───────────────────────────────────────────────────
 * ⚠ `.is("sign_token_hash", null)` — mint once, ever. A second mint would silently kill a link that
 * has already been emailed, and the plaintext of the first is unrecoverable: 0345 stores a SHA-256,
 * like 0220 before it. `approveApplication` only reaches here once (its own `.is("approved_at", null)`
 * guard), so in practice this never fires; it is here because "in practice" is what the rotation
 * argument above is trying not to rely on.
 *
 * Returns null when nothing could be stored, and the caller then sends the copy that names the earlier
 * email instead. ⚠ Never a link whose hash is not on the row: a dead link in an approval email is the
 * lockout this whole design exists to avoid.
 */
async function mintSignLink(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  invitationId: string,
): Promise<string | null> {
  const { token, hash } = mintInvitationToken();
  const { data, error } = await admin
    .from("application_invitations")
    .update({ sign_token_hash: hash })
    // The service role bypasses RLS; every query on this path carries its own tenant scope.
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .is("sign_token_hash", null)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    // Not loud enough to be an error: the applicant still gets a usable email, just the older copy.
    console.warn("[application-approval] no sign link minted", {
      invitationId,
      detail: error?.message ?? "already minted",
    });
    return null;
  }
  return `${env.WEB_APP_URL}/apply/${token}`;
}

/**
 * Tell one applicant their application is ready to sign.
 *
 * ⚠ The text is attempted FIRST and the email goes regardless, exactly as the nudge does. Every gate
 * that can refuse a message — no consent, draft wording, quiet hours, an opt-out — leaves the email
 * untouched, so a refused text is never an applicant hearing nothing.
 *
 * ⚠ The link is minted BEFORE either goes out, for the reason the nudge sweep's header spells out at
 * length: a message carrying a link that is not yet on the row is a message that does not work when it
 * arrives. Unlike the nudge, a failure between the two costs nothing — the original link is untouched
 * and still opens the same screen.
 */
export async function notifyApplicationApproved(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  invitationId: string,
  driverId: string,
  email: string | null,
  now: Date,
): Promise<ApprovalNotice> {
  if (!email) return { sent: false, email: null, reason: "no_address", texted: false };
  // Asked here rather than left to the mailer so the drawer can separate "we are not configured to
  // send" from "the provider refused it". The first is an administrator's problem and the second is
  // the applicant's address; sending a recruiter after the wrong one wastes the call.
  if (env.MAIL_PROVIDER === "none") return { sent: false, email, reason: "mail_disabled", texted: false };

  const carrier = await carrierName(admin, orgId);
  const signUrl = await mintSignLink(admin, env, orgId, invitationId);
  const texted = await sendApplicationSms(admin, env, orgId, driverId, approvedSmsBody(carrier), now);

  const mail = renderApplicationApprovedEmail(carrier, signUrl);
  const result = await sendEmail(env, {
    to: [email],
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
  if (!result.ok) {
    // Loud: the recruiter is told "could not send" and can pick up the phone, but nobody learns WHY
    // without this — and an applicant who is allowed to sign and does not know it is the one state
    // this whole two-visit flow was built to avoid.
    console.error("[application-approval] could not send", { detail: result.detail });
  }
  return { sent: result.ok, email, reason: result.ok ? null : "send_failed", texted: texted.sent };
}
