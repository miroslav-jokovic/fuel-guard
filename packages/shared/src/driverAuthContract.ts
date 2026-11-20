import { z } from "zod";

/**
 * Company-issued driver credentials (Samsara model — docs/plans/drivers-app/DRIVER-CREDENTIALS-PLAN.md).
 * The org creates each driver's username + generated password and controls the whole lifecycle; there
 * is no self-registration and no recovery email. Under the hood each credential is a normal Supabase
 * Auth user whose email is a SYNTHETIC, non-deliverable address derived from the username, so the
 * existing JWT-claims hook, RLS driver scopes, and session machinery are untouched.
 */

/** Non-deliverable domain for synthetic driver logins. Nothing is ever emailed to it. */
export const SYNTHETIC_DRIVER_EMAIL_DOMAIN = "drivers.fuelguard.app";

export const DRIVER_USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Lowercase + trim; the canonical form stored on drivers.app_username and used for lookups. */
export function normalizeDriverUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidDriverUsername(u: string): boolean {
  return DRIVER_USERNAME_RE.test(u);
}

/** The synthetic auth email backing a username. Deterministic — one username, one auth identity. */
export function toSyntheticDriverEmail(username: string): string {
  return `${normalizeDriverUsername(username)}@${SYNTHETIC_DRIVER_EMAIL_DOMAIN}`;
}

/** Derive a username candidate from a full name ("Aaron B. Cole" → "aaron.cole"). May need dedup. */
export function usernameFromName(fullName: string): string {
  const parts = fullName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const raw = parts.length >= 2 ? `${parts[0]}.${parts[parts.length - 1]}` : (parts[0] ?? "");
  return raw.slice(0, 32);
}

/** App-access state shown on the Drivers page, derived from the two stored facts. */
export type DriverAppAccess = "none" | "active" | "disabled";
export function driverAppAccess(
  userId: string | null,
  appAccessEnabled: boolean | null,
): DriverAppAccess {
  if (!userId) return "none";
  return appAccessEnabled ? "active" : "disabled";
}

// ── admin lifecycle (roster endpoints, admin/fleet_manager) ───────────────────
/**
 * The shortest driver password: 8 characters, the length the fleet already sets for drivers in
 * Samsara (owner, 2026-11-20). A driver copies it off paper onto a phone, and the 12 this replaced
 * (the office floor, D-PWR7) was more than the job needed. 8 is also NIST SP 800-63B's floor for a
 * chosen password, and guessing is held off by the driver-login throttle (DC5), not by length. It
 * governs the admin-chosen password, the generated one (`generateDriverPassword`) and the login
 * exchange alike, so the three cannot drift apart again. Supabase Auth's project-wide
 * `password_min_length` must be at or below it, or GoTrue refuses the password at create/reset with
 * `weak_password`; the office surfaces keep their own 12 through `PASSWORD_MIN_LENGTH`.
 */
export const DRIVER_PASSWORD_MIN_LENGTH = 8;
export const DRIVER_PASSWORD_MAX_LENGTH = 128;

/** Admin-chosen password, DRIVER_PASSWORD_MIN_LENGTH–128 chars. Optional — when omitted the server
 *  generates one. Either way it is returned once and never stored by us. */
export const customPasswordSchema = z
  .string()
  .min(DRIVER_PASSWORD_MIN_LENGTH)
  .max(DRIVER_PASSWORD_MAX_LENGTH);

/** Why an admin-typed driver password cannot be used, in words for the Drivers page — or null. */
export function driverPasswordProblem(value: string): string | null {
  if (value.length < DRIVER_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${DRIVER_PASSWORD_MIN_LENGTH} characters.`;
  }
  if (value.length > DRIVER_PASSWORD_MAX_LENGTH) {
    return `Password must be ${DRIVER_PASSWORD_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}

export const createDriverLoginSchema = z.object({
  /** Optional explicit username; defaults to the driver's Samsara alpha code, then their name. */
  username: z.string().trim().toLowerCase().regex(DRIVER_USERNAME_RE).optional(),
  password: customPasswordSchema.optional(),
});
export type CreateDriverLoginRequest = z.infer<typeof createDriverLoginSchema>;

export const resetDriverPasswordSchema = z.object({
  password: customPasswordSchema.optional(),
});
export type ResetDriverPasswordRequest = z.infer<typeof resetDriverPasswordSchema>;

/** Create/reset response — the ONLY place the password ever appears; it is not stored anywhere. */
export const driverCredentialIssuedSchema = z.object({
  username: z.string(),
  password: z.string(),
});
export type DriverCredentialIssued = z.infer<typeof driverCredentialIssuedSchema>;

// ── the login exchange (public endpoint the driver app calls) ─────────────────
export const driverLoginRequestSchema = z.object({
  /** The issued username; a value containing "@" is treated as a legacy email login (cutover). */
  username: z.string().trim().min(3).max(120),
  password: z.string().min(DRIVER_PASSWORD_MIN_LENGTH).max(DRIVER_PASSWORD_MAX_LENGTH),
});
export type DriverLoginRequest = z.infer<typeof driverLoginRequestSchema>;

export const driverLoginResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
});
export type DriverLoginResponse = z.infer<typeof driverLoginResponseSchema>;
