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
export const createDriverLoginSchema = z.object({
  /** Optional explicit username; defaults to the driver's Samsara alpha code, then their name. */
  username: z.string().trim().toLowerCase().regex(DRIVER_USERNAME_RE).optional(),
});
export type CreateDriverLoginRequest = z.infer<typeof createDriverLoginSchema>;

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
  password: z.string().min(8).max(128),
});
export type DriverLoginRequest = z.infer<typeof driverLoginRequestSchema>;

export const driverLoginResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
});
export type DriverLoginResponse = z.infer<typeof driverLoginResponseSchema>;
