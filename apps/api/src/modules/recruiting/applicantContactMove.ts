import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseUsPhone, type ApplicationContactMove } from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";
import { textedAt, withdrawSmsConsentOnNumber } from "./applicationSms.js";

/**
 * What an office correction of the applicant's email or phone does to how the carrier REACHES them
 * (APPLICATION-FIX-PLAN F3c part 2, E3: "email or phone edits update the invitation's contact and say
 * so. That is an audited act.").
 *
 * ── THE EMAIL MOVES ───────────────────────────────────────────────────────────────────────────
 * Every message about this application — the approval notice, the unlock code, the signing link, the
 * travel plan — goes to `application_invitations.email`, set when the link was made. Until E3 an office
 * correction of the email answer changed the answer and left every later message going to the address
 * the office had just said was wrong. Now the invitation's email follows the corrected answer
 * (`editApplication` writes it; it owns the invitation). A cleared answer moves nothing: an address the
 * carrier can still reach them at is kept rather than replaced with none.
 *
 * ⚠ `drivers.email` does not move. No application path has ever written it — the roster owns that
 * row, and a recruiter does not hold the roster section (memory: a-recruiter-cannot-write-the-roster-
 * section). APPLICATION-FIX-PLAN Q-AM16 has it.
 *
 * ── THE PHONE CANNOT MOVE; THE OLD NUMBER STOPS ───────────────────────────────────────────────
 * Texts go to the number a CONSENT names (`sendApplicationSms`), never to the phone answer, and consent
 * attaches to a number (0233): nobody agreed to texts at the corrected one, so nothing here grants it.
 * What the correction does say is that the old answer was not their number — and texting a number that
 * is not theirs is the one thing the TCPA charges per message for. So when this applicant was texted at
 * the number the phone answer held, that consent is revoked (`withdrawSmsConsentOnNumber`, this
 * applicant only, reason `office_corrected_phone`); they agree again on their own link for the new one.
 * A consent on some OTHER number they gave is untouched — the correction says nothing about it.
 *
 * Both acts are audited by field name, never a value (`apps/api/CLAUDE.md`).
 */

export const PHONE_CORRECTED = "office_corrected_phone";

/** The texts that stop when the phone answer moves from `was` to `now`. */
export async function stopTextsToReplacedPhone(
  admin: SupabaseClient,
  orgId: string,
  invitation: { id: string; driver_id: string },
  was: string | null | undefined,
  now: string | null | undefined,
  actorId: string,
): Promise<ApplicationContactMove> {
  const old = normaliseUsPhone(was ?? null);
  if (!old || old === normaliseUsPhone(now ?? null)) return {};
  const stopped = await withdrawSmsConsentOnNumber(admin, orgId, invitation.driver_id, old, PHONE_CORRECTED);
  if (stopped === 0) return {};
  await writeAudit(admin, {
    orgId,
    actorId,
    action: "application_contact_moved",
    entity: "application_invitations",
    entityId: invitation.id,
    meta: { driverId: invitation.driver_id, field: "phone", textsStopped: stopped },
  });
  return { textsStopped: true };
}

/** Whether saving a new phone answer would stop texts: this applicant is texted at the one on file. */
export async function phoneAnswerIsTexted(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  phone: string | null | undefined,
): Promise<boolean> {
  const number = normaliseUsPhone(phone ?? null);
  return number ? textedAt(admin, orgId, driverId, number) : false;
}

const sameEmail = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** The invitation's new email, or null when it stays (blank answer, or already the same address). */
export function invitationEmailAfter(current: string | null | undefined, corrected: unknown): string | null {
  if (typeof corrected !== "string" || corrected.trim() === "") return null;
  return sameEmail(current, corrected) ? null : corrected.trim();
}
