import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  UNLOCK_CODE_LENGTH,
  UNLOCK_CODE_MAX_TRIES,
  UNLOCK_CODE_TTL_MINUTES,
  maskEmail,
  maskPhone,
  renderUnlockCodeEmail,
  renderUnlockCodeText,
  type UnlockCodeAnswer,
  type UnlockCodeRequest,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { writeAudit } from "../../lib/audit.js";
import { carrierName, deliverApplicationMail } from "./applicationMail.js";
import { sendApplicationSms, smsConsentStatus } from "./applicationSms.js";
import { isIntakeError, resolveInvitation, type IntakeError } from "./applicationIntake.js";
import { gatedRelease, releasedView, type DraftView } from "./applicationDraft.js";

/**
 * A one-time code in place of the date of birth (APPLICATION-FIX-PLAN.md F0b; 0585).
 *
 * ── WHERE IT GOES, AND WHY ONLY THERE ─────────────────────────────────────────────────────────
 * To the invitation's own email, or by text to the number the applicant agreed to be texted on — never
 * to an address the request names. The page sends a channel and nothing else, so a stranger holding a
 * forwarded link (the case D-APP16 exists for) can ask for a code and only ever sends it to the inbox
 * or phone the link came to. A text goes through `sendApplicationSms` directly, "now or never", like
 * `/text-link`: every gate it holds (live consent, a number, a suppression, quiet hours) answers `held`,
 * and the page offers the email instead. A code that arrived after the quiet hours would be dead.
 *
 * ── ONLY THE LATEST CODE COUNTS ───────────────────────────────────────────────────────────────
 * Each send inserts a row; the check reads the newest row for the invitation and nothing older, so a
 * second "send me a code" retires the first without a write. Wrong codes are counted on that row by a
 * conditional UPDATE (`signLinkUnlock.ts`'s pattern: PostgREST has no `x = x + 1`, and two guesses in
 * one instant must both count); the fifth retires it. The route's limiters bound how many rows a link
 * can mint (`unlockCodeLimiter`) and how fast it can guess (`unlockLimiter`).
 *
 * ── WHAT A RIGHT CODE DOES ────────────────────────────────────────────────────────────────────
 * The same release the date of birth gives (`releasedView`, one function for both), the row's `used_at`
 * stamped, and an audit row. It does NOT change the date of birth on file and does not reset a sent
 * sign link's count: the office's review drawer says the date on file did not match (`latestCodeUnlock`)
 * and the office corrects it through Identity (Q-AM13). A sign link already stopped by five wrong dates
 * resolves to nothing, so no code can be asked for on it — the remedy there stays "send it again".
 *
 * ⚠ Every query org-filters itself: the service role bypasses RLS, and 0585's table has no policies.
 */

export const NOTHING_TO_UNLOCK: IntakeError = {
  code: "not_locked",
  message: "This application is not waiting for a date of birth, so there is nothing to unlock.",
};
export const CODE_NOT_ACCEPTED: IntakeError = {
  code: "code_not_accepted",
  message: "That code does not match, or it has run out. Ask for a new code and use the newest one.",
};
export const CODE_NOT_SENT: IntakeError = {
  code: "code_failed",
  message: "The code could not be sent just now. Try again in a moment.",
};

export const hashUnlockCode = (invitationId: string, code: string): string =>
  createHash("sha256").update(`${invitationId}:${code}`).digest("hex");

/** Six digits, leading zeros kept, from the CSPRNG. */
export const mintUnlockCode = (): string =>
  String(randomInt(0, 10 ** UNLOCK_CODE_LENGTH)).padStart(UNLOCK_CODE_LENGTH, "0");

async function invitationEmail(admin: SupabaseClient, orgId: string, id: string): Promise<string | null> {
  const { data } = await admin.from("application_invitations").select("email").eq("org_id", orgId).eq("id", id).maybeSingle();
  const email = (data as { email?: string | null } | null)?.email;
  return typeof email === "string" && email.trim() !== "" ? email.trim() : null;
}

/** `POST …/unlock-code`: mint a code, store its hash, send it. `mint` is injectable for tests. */
export async function requestUnlockCode(
  admin: SupabaseClient,
  env: Env,
  token: string,
  request: UnlockCodeRequest,
  now: Date,
  mint: () => string = mintUnlockCode,
): Promise<UnlockCodeAnswer | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  // A code is for a gated draft only — otherwise it would be a way to email the applicant on demand.
  const { stored } = await gatedRelease(admin, invitation, now);
  if (!stored) return NOTHING_TO_UNLOCK;

  const { channel, language } = request;
  const email = channel === "email" ? await invitationEmail(admin, invitation.org_id, invitation.id) : null;
  if (channel === "email" && !email) return { outcome: "held", channel, held: "no_address" };
  if (channel === "email" && env.MAIL_PROVIDER === "none") return { outcome: "held", channel, held: "mail_disabled" };

  const code = mint();
  const carrier = await carrierName(admin, invitation.org_id);
  let to: string;
  if (channel === "email") {
    const delivery = await deliverApplicationMail(env, email, renderUnlockCodeEmail(carrier, code, language));
    if (!delivery.sent) return CODE_NOT_SENT;
    to = maskEmail(email!);
  } else {
    const sent = await sendApplicationSms(
      admin, env, invitation.org_id, invitation.driver_id, renderUnlockCodeText(carrier, code, language), now,
    );
    if ("failed" in sent) return CODE_NOT_SENT;
    if (!sent.sent) return { outcome: "held", channel, held: sent.held };
    const status = await smsConsentStatus(admin, invitation.org_id, invitation.driver_id);
    to = maskPhone(status.phoneLast4 ?? "");
  }

  /**
   * ⚠ Stored only AFTER the message went. The newest row is the only one checked, so a row written
   * for a text that quiet hours then held would silently retire the code already sitting in the
   * driver's email. The cost of this order is a code that went out and was not stored — it is refused,
   * and the driver asks again — which is the safe way round.
   */
  const expiresAt = new Date(now.getTime() + UNLOCK_CODE_TTL_MINUTES * 60_000);
  const { error } = await admin.from("application_unlock_codes").insert({
    org_id: invitation.org_id,
    invitation_id: invitation.id,
    channel,
    code_hash: hashUnlockCode(invitation.id, code),
    expires_at: expiresAt.toISOString(),
    created_at: now.toISOString(),
  });
  if (error) return CODE_NOT_SENT;

  await writeAudit(admin, {
    orgId: invitation.org_id,
    actorId: null,
    action: "compliance.unlock_code_sent",
    entity: "application_invitations",
    entityId: invitation.id,
    // The channel and the driver — never the code, never the address.
    meta: { driverId: invitation.driver_id, channel },
  });
  return { outcome: "sent", channel, to, expiresInMinutes: UNLOCK_CODE_TTL_MINUTES };
}

interface CodeRow {
  id: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  used_at: string | null;
}

const sameHash = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** `POST …/unlock-code/verify`: the newest code, live and under its tries, or nothing. */
export async function unlockWithCode(
  admin: SupabaseClient,
  token: string,
  code: string,
  now: Date,
): Promise<DraftView | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;

  const { data } = await admin
    .from("application_unlock_codes")
    .select("id, code_hash, expires_at, attempts, used_at")
    .eq("org_id", invitation.org_id)
    .eq("invitation_id", invitation.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const latest = ((data ?? []) as CodeRow[])[0];
  // ⚠ The expiry compared as an instant, never as text: PostgREST serves `…+00:00`, and `…Z` against
  // `….000Z` sorts the wrong way as a string — the test that pins the edge found exactly that.
  if (!latest || latest.used_at || latest.attempts >= UNLOCK_CODE_MAX_TRIES || Date.parse(latest.expires_at) <= now.getTime()) {
    return CODE_NOT_ACCEPTED;
  }

  if (!sameHash(hashUnlockCode(invitation.id, code), latest.code_hash)) {
    // Counted against the value read: a lost race is a guess somebody else's guess already counted.
    await admin
      .from("application_unlock_codes")
      .update({ attempts: latest.attempts + 1 })
      .eq("org_id", invitation.org_id)
      .eq("id", latest.id)
      .eq("attempts", latest.attempts);
    return CODE_NOT_ACCEPTED;
  }

  // Spent once: two tabs sending the same right code — only the first opens it.
  const { data: spent } = await admin
    .from("application_unlock_codes")
    .update({ used_at: now.toISOString() })
    .eq("org_id", invitation.org_id)
    .eq("id", latest.id)
    .is("used_at", null)
    .select("id");
  if (((spent ?? []) as unknown[]).length !== 1) return CODE_NOT_ACCEPTED;

  await writeAudit(admin, {
    orgId: invitation.org_id,
    actorId: null,
    action: "compliance.draft_unlocked_by_code",
    entity: "application_invitations",
    entityId: invitation.id,
    meta: { driverId: invitation.driver_id },
  });
  const { row, partOne } = await gatedRelease(admin, invitation, now);
  return releasedView(row, partOne);
}

/**
 * When the applicant last opened their application with a code instead of the date of birth — the
 * office's prompt that the date on file did not match. Null when they never did.
 */
export async function latestCodeUnlock(admin: SupabaseClient, orgId: string, invitationId: string): Promise<string | null> {
  const { data } = await admin
    .from("application_unlock_codes")
    .select("used_at")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .not("used_at", "is", null)
    .order("used_at", { ascending: false })
    .limit(1);
  return ((data ?? []) as Array<{ used_at: string }>)[0]?.used_at ?? null;
}
