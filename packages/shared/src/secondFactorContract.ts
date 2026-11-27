import { z } from "zod";
import { maskEmail } from "./applicationUnlockCodeContract.js";
import { APP_NAME, isRosterIssuedRole, type UserRole } from "./constants.js";

/**
 * Two-step sign-in for the office app, revision 2 (INSTALLED-APP-PLAN IA-S1; the owner's ruling of 2026-11-27,
 * Q-IA20, which replaced the authenticator-app version of 2026-11-15).
 *
 * THE RULE, once — the API enforces it and the app explains it:
 *   · every OFFICE role is asked — everybody except the roster-issued ones (`isRosterIssuedRole`: drivers, who
 *     sign in to the driver app with a company-issued password). Nothing to set up, so nobody is exempt and there
 *     is no notice period: everyone already has the one thing it needs, their sign-in email address;
 *   · the step is a 6-digit code EMAILED to that address;
 *   · a DEVICE that gave its code is not asked again for `TWO_STEP_DAYS`, across sign-outs and the 12-hour idle
 *     sign-out — "after 1 week", in the owner's words. The device is the app's own key (`DEVICE_KEY_HEADER`, 0620).
 *     Past the week the next request is refused, even in the middle of a session, and the app asks for a new code.
 *
 * Why email is not a lower floor than the authenticator app was for THIS product: whoever reads the mailbox can
 * already take the account through the password reset (0363). The code still does what a second step is for —
 * a stolen password alone no longer opens a session.
 */

/** "After 1 week" (Q-IA20). */
export const TWO_STEP_DAYS = 7;
export const TWO_STEP_CODE_LENGTH = 6;
/** A code's life. Long enough for a slow mail server, short enough that a code left in an inbox is soon dead. */
export const TWO_STEP_CODE_MINUTES = 10;
/** Wrong entries before a code is dead (a million codes, five guesses: one chance in 200,000 per email). */
export const TWO_STEP_MAX_ATTEMPTS = 5;
/** Codes one person may be sent in an hour — anti-mailbomb, counted in the table (0662). */
export const TWO_STEP_MAX_PER_HOUR = 5;
/** A reload of the code page inside this window mails nothing new. */
export const TWO_STEP_RESEND_SECONDS = 60;

/**
 * The name an authenticator app shows for the entry the QR code adds — the `issuer` of `mfa.enroll`. Only the
 * platform console uses an authenticator app now (`apps/admin`, untouched by Q-IA20).
 */
export const AUTHENTICATOR_ISSUER = APP_NAME;

/** The API's refusal when a token needs the second step and its device has not given it. */
export const SECOND_FACTOR_REQUIRED = "second_factor_required";

/** Is this role asked for the code at all? */
export const twoStepRequired = (role: UserRole | string | null | undefined): boolean => !!role && !isRosterIssuedRole(role);

/** Until when a device that gave its code at `verifiedAt` is trusted; null for never/unreadable. */
export function twoStepTrustedUntil(verifiedAt: string | null | undefined): Date | null {
  if (!verifiedAt) return null;
  const at = Date.parse(verifiedAt);
  return Number.isFinite(at) ? new Date(at + TWO_STEP_DAYS * 86_400_000) : null;
}

export const twoStepSatisfied = (verifiedAt: string | null | undefined, now: Date): boolean =>
  (twoStepTrustedUntil(verifiedAt)?.getTime() ?? 0) > now.getTime();

/**
 * `GET /api/me/second-factor` — what the second step asks of the caller, on this device.
 *   required       this person is asked for codes at all
 *   satisfied      this device gave one within the week (or it is not required)
 *   email_hint     where the code goes, masked
 *   trusted_until  when this device will be asked again; null when it has not given a code
 */
export const secondFactorStatusSchema = z.object({
  required: z.boolean(),
  satisfied: z.boolean(),
  email_hint: z.string().nullable(),
  trusted_until: z.string().nullable(),
});
export type SecondFactorStatus = z.infer<typeof secondFactorStatusSchema>;

export function secondFactorStatus(
  facts: { role: UserRole | string | null; twoStepAt: string | null },
  email: string | null,
  now: Date,
): SecondFactorStatus {
  const required = twoStepRequired(facts.role);
  const until = twoStepTrustedUntil(facts.twoStepAt);
  return {
    required,
    satisfied: !required || twoStepSatisfied(facts.twoStepAt, now),
    // The applicant unlock code's mask, reused: "a•••@silvicom.com" — enough to know which inbox.
    email_hint: email ? maskEmail(email) : null,
    trusted_until: until ? until.toISOString() : null,
  };
}

/** `POST /api/me/second-factor/code`: a new code went out, or one went out moments ago and still stands. */
export const twoStepSendSchema = z.object({
  outcome: z.enum(["sent", "recent"]),
  expires_at: z.string(),
});
export type TwoStepSend = z.infer<typeof twoStepSendSchema>;

/** `POST /api/me/second-factor/verify` body. Spaces a person types or pastes are forgiven, nothing else. */
export const twoStepVerifyBodySchema = z.object({
  code: z
    .string()
    .transform((s) => s.replace(/\s+/g, ""))
    .pipe(z.string().regex(new RegExp(`^\\d{${TWO_STEP_CODE_LENGTH}}$`), "Enter the 6-digit code from the email.")),
});
