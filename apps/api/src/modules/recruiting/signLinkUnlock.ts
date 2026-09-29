import type { SupabaseClient } from "@supabase/supabase-js";
import { SIGN_LINK_UNLOCK_LIMIT } from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";
import type { IntakeError } from "./applicationIntake.js";

/**
 * Five wrong dates of birth on a link the office SENT for signing, and the link stops (D-AW14, C3s3a).
 *
 * ── WHY A COUNTER NOW, WHEN D-APP16 REFUSED ONE ───────────────────────────────────────────────
 * `unlockDraft`'s header refuses a lockout, and for the link a driver was invited with it still does: a
 * driver mistyping their own birthday in a truck stop must not need a support call. The sent sign link
 * differs in the two ways the owner named on 2026-09-26. It travels by text and email to wherever the
 * phone is, and the date of birth guarding it is printed on the CDL the driver photographed in Part 1 —
 * so it is not a secret to anybody who has seen that photo. And the remedy is cheap: the link is sent
 * while the driver is in the office, so "send it again" is a press at the desk, which resets the count.
 *
 * ── WHAT "STOPS" MEANS ────────────────────────────────────────────────────────────────────────
 * The fifth wrong answer clears `sign_token_hash` and `sms_token_hash` in the same UPDATE that counts
 * it, so the emailed link and the texted one both die at once; `revoked_at` is NOT set, because a
 * revoked invitation cannot be sent for signing again (0369's AI002) and the driver's permissions, form
 * and adoptions are all on it. The invitation's own link — the invite door — is untouched and keeps
 * D-APP16's rule.
 *
 * ⚠ The count is a conditional UPDATE on the value read (PostgREST has no `x = x + 1`), retried on a
 * lost race: two wrong answers in the same instant must both count, or the limit is five per burst.
 */

export const SIGN_LINK_LOCKED: IntakeError = {
  code: "sign_link_locked",
  message: "This signing link has stopped working after too many wrong dates of birth. Ask the carrier to send it again.",
};

export const UNLOCK_NOT_COUNTED: IntakeError = {
  code: "unlock_failed",
  message: "That could not be checked just now. Try again in a moment.",
};

/** Race retries. Three is generous: a losing request needs a second writer between its read and write. */
const ATTEMPTS = 3;

/**
 * Count one wrong answer. Answers how many are left — 0 once this answer stopped the link — or an error
 * when the count could not be written, which refuses rather than let an uncounted guess through.
 */
export async function countWrongUnlock(
  admin: SupabaseClient,
  invitation: { id: string; org_id: string; driver_id: string; unlock_failures?: number },
): Promise<number | IntakeError> {
  let seen = invitation.unlock_failures ?? 0;
  for (let i = 0; i < ATTEMPTS; i += 1) {
    // Lost a race to the answer that stopped it: already stopped, and already audited.
    if (seen >= SIGN_LINK_UNLOCK_LIMIT) return 0;
    const next = seen + 1;
    const stops = next >= SIGN_LINK_UNLOCK_LIMIT;
    const { data, error } = await admin
      .from("application_invitations")
      .update(stops ? { unlock_failures: next, sign_token_hash: null, sms_token_hash: null } : { unlock_failures: next })
      .eq("org_id", invitation.org_id)
      .eq("id", invitation.id)
      .eq("unlock_failures", seen)
      .select("id");
    if (error) return UNLOCK_NOT_COUNTED;
    if (((data ?? []) as unknown[]).length === 1) {
      if (stops) {
        await writeAudit(admin, {
          orgId: invitation.org_id,
          actorId: null,
          action: "compliance.sign_link_locked",
          entity: "application_invitations",
          entityId: invitation.id,
          // The count and the driver, so the office's drawer can say why the link stopped. Never a date.
          meta: { driverId: invitation.driver_id, unlockFailures: next },
        });
      }
      return Math.max(0, SIGN_LINK_UNLOCK_LIMIT - next);
    }
    const { data: fresh } = await admin
      .from("application_invitations")
      .select("unlock_failures")
      .eq("org_id", invitation.org_id)
      .eq("id", invitation.id)
      .maybeSingle();
    const now = (fresh as { unlock_failures?: number } | null)?.unlock_failures;
    if (typeof now !== "number") return UNLOCK_NOT_COUNTED;
    seen = now;
  }
  return UNLOCK_NOT_COUNTED;
}
