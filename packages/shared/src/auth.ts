import type { UserRole } from "./constants.js";

/**
 * Claims FuelGuard reads from a verified Supabase JWT.
 * `org_id` + `user_role` are injected by the Custom Access Token hook (migration 0006).
 * Absent org_id ⇒ the user has no membership yet (audit B3) ⇒ "account pending" state.
 */
export interface AuthClaims {
  sub: string; // Supabase user id
  email?: string;
  org_id?: string;
  user_role?: UserRole;
}

/** The authenticated principal the API attaches to each request after verifying the JWT. */
export interface AuthContext {
  userId: string;
  email: string | null;
  orgId: string | null;
  role: UserRole | null;
}

/** Lower-cased domain part of an email, or null if malformed. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

/**
 * True iff the email's domain is in the org's allowlist (case-insensitive).
 * Enforced at BOTH invite creation and invite acceptance (audit M2).
 */
export function isEmailDomainAllowed(email: string, allowedDomains: readonly string[]): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  return allowedDomains.some((d) => d.trim().toLowerCase() === domain);
}

// ── Role capability helpers (single source of truth for UI + API gating) ──────
export const isAdmin = (role: UserRole | null | undefined): boolean => role === "admin";

export const canManageFleet = (role: UserRole | null | undefined): boolean =>
  role === "admin" || role === "fleet_manager";

export const canResolveAnomalies = canManageFleet;

export const isReadOnly = (role: UserRole | null | undefined): boolean => role === "auditor";

export const claimsToContext = (c: AuthClaims): AuthContext => ({
  userId: c.sub,
  email: c.email ?? null,
  orgId: c.org_id ?? null,
  role: c.user_role ?? null,
});
