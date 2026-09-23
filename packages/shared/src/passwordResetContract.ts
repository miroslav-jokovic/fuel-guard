import { z } from "zod";

/**
 * An office user's password: the rule for choosing one, and the public reset surface.
 *
 * docs/plans/permissions/PASSWORD-RESET-PLAN.md. ONE home for the password rule so the invitation
 * page, the reset page and the API cannot drift — before this file the invitation page said 8, the
 * contract said 8 and the local GoTrue config said 6, three numbers for one fact.
 *
 * ── D-PWR7 — The rule is NIST SP 800-63B's shape: length, not composition ──────────────────────
 * Twelve characters minimum and no "one upper, one digit, one symbol" requirement: composition rules
 * push people to `Password1!`, and 800-63B §5.1.1.2 says not to impose them. The maximum is 72
 * because bcrypt — what GoTrue stores — reads only the first 72 bytes; a longer password would be
 * silently truncated, and saying so up front is better than accepting characters that do nothing.
 * The project's own GoTrue policy (leaked-password check, when switched on) may refuse more, and
 * says so in its own message, which the API passes through.
 *
 * Drivers are not covered. Their passwords are company-issued and generated (DRIVER-CREDENTIALS-PLAN
 * DC3), and nothing here reaches a driver login.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 72;

/** How long an emailed reset link works. Short, because a reset is urgent and a link is a credential. */
export const PASSWORD_RESET_TTL_MINUTES = 60;

export const newPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/**
 * Why this password cannot be used, in words for the person typing it — or null when it can.
 *
 * Pure, and run on BOTH sides: the page shows the sentence before anything is sent, and the API
 * refuses the same things with the same sentence, so a hand-made request meets the same rule.
 * `confirm` is optional because the API receives one password, not two.
 */
export function passwordProblem(password: string, email: string | null, confirm?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (/^(.)\1*$/.test(password)) return "Don't use one character repeated.";
  const address = (email ?? "").trim().toLowerCase();
  const local = address.split("@")[0] ?? "";
  const lowered = password.toLowerCase();
  if (address && (lowered === address || (local.length >= 4 && lowered.includes(local)))) {
    return "Don't use your email address in your password.";
  }
  if (confirm !== undefined && password !== confirm) return "Passwords do not match.";
  return null;
}

/**
 * The three public calls. The token travels in the BODY, never a path or query string, so it does
 * not land in an access log (the invitation's precedent, `publicInvites.ts`).
 */
export const passwordResetRequestSchema = z.object({
  email: z.email().max(320),
});
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetLookupSchema = z.object({
  token: z.string().min(20).max(200),
});
export type PasswordResetLookupRequest = z.infer<typeof passwordResetLookupSchema>;

export const passwordResetRedeemSchema = z.object({
  token: z.string().min(20).max(200),
  password: newPasswordSchema,
});
export type PasswordResetRedeemRequest = z.infer<typeof passwordResetRedeemSchema>;

/** What `lookup` tells the page: whose password this link sets, and until when. */
export const passwordResetPreviewSchema = z.object({
  email: z.email(),
  expiresAt: z.string(),
});
export type PasswordResetPreview = z.infer<typeof passwordResetPreviewSchema>;

/** The admin's send from the Users page: no body, and the answer never carries the link (D-PWR8). */
export const adminPasswordResetResultSchema = z.object({
  sent: z.literal(true),
  expiresAt: z.string(),
});
export type AdminPasswordResetResult = z.infer<typeof adminPasswordResetResultSchema>;

