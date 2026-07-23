import { USER_ROLES, type UserRole } from "./constants.js";

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
 * An empty or absent allowlist means no domain restriction — all emails are allowed.
 * Enforced at BOTH invite creation and invite acceptance (audit M2).
 */
export function isEmailDomainAllowed(email: string, allowedDomains: readonly string[] | null | undefined): boolean {
  if (!allowedDomains || allowedDomains.length === 0) return true;
  const domain = emailDomain(email);
  if (!domain) return false;
  return allowedDomains.some((d) => d.trim().toLowerCase() === domain);
}

// ── Section-scoped capabilities ───────────────────────────────────────────────
// The product areas the sidebar + routes are organized into. `admin` = org settings / user management.
export const APP_SECTIONS = ["fuel", "dispatch", "safety", "fleet", "admin"] as const;
export type AppSection = (typeof APP_SECTIONS)[number];
export type SectionAccess = "none" | "view" | "manage";

/**
 * Role → per-section access. THE single source of truth for what each role can see/do, consumed by the web
 * nav, the API's requireRole guards (via rolesThatManage/rolesThatCanView), and mirrored by the SQL section
 * helpers in the RLS migration — all three must stay in lockstep.
 *
 * Department roles: `dispatcher` manages Dispatch (reads Fuel + Fleet); `safety_manager` manages Safety +
 * Fleet (reads Fuel). `driver` is "none" here — the Dashboard + their own Fuel Log are ungated nav items,
 * not section-scoped surfaces.
 */
const SECTION_ACCESS: Record<UserRole, Record<AppSection, SectionAccess>> = {
  admin: { fuel: "manage", dispatch: "manage", safety: "manage", fleet: "manage", admin: "manage" },
  fleet_manager: { fuel: "manage", dispatch: "manage", safety: "manage", fleet: "manage", admin: "none" },
  dispatcher: { fuel: "view", dispatch: "manage", safety: "none", fleet: "view", admin: "none" },
  safety_manager: { fuel: "view", dispatch: "none", safety: "manage", fleet: "manage", admin: "none" },
  auditor: { fuel: "view", dispatch: "view", safety: "view", fleet: "view", admin: "none" },
  driver: { fuel: "none", dispatch: "none", safety: "none", fleet: "none", admin: "none" },
};

export const sectionAccess = (role: UserRole | null | undefined, section: AppSection): SectionAccess =>
  role ? SECTION_ACCESS[role][section] : "none";

/** Can this role open/read the section at all (view or manage)? */
export const canViewSection = (role: UserRole | null | undefined, section: AppSection): boolean =>
  sectionAccess(role, section) !== "none";

/** Can this role write/act within the section (resolve alerts, edit plans, manage vehicles, …)? */
export const canManageSection = (role: UserRole | null | undefined, section: AppSection): boolean =>
  sectionAccess(role, section) === "manage";

/** Roles allowed to MANAGE a section — spread into API requireRole(...) and mirrored in SQL. */
export const rolesThatManage = (section: AppSection): UserRole[] =>
  USER_ROLES.filter((r) => SECTION_ACCESS[r][section] === "manage");

/** Roles allowed to VIEW a section (view or manage) — for read-only route guards. */
export const rolesThatCanView = (section: AppSection): UserRole[] =>
  USER_ROLES.filter((r) => SECTION_ACCESS[r][section] !== "none");

// ── Role capability helpers (single source of truth for UI + API gating) ──────
export const isAdmin = (role: UserRole | null | undefined): boolean => role === "admin";

export const canManageFleet = (role: UserRole | null | undefined): boolean =>
  role === "admin" || role === "fleet_manager";

/** Resolving anomalies is a Safety-section action, so safety_manager qualifies too. */
export const canResolveAnomalies = (role: UserRole | null | undefined): boolean =>
  canManageSection(role, "safety");

export const isReadOnly = (role: UserRole | null | undefined): boolean => role === "auditor";

export const claimsToContext = (c: AuthClaims): AuthContext => ({
  userId: c.sub,
  email: c.email ?? null,
  orgId: c.org_id ?? null,
  role: c.user_role ?? null,
});
