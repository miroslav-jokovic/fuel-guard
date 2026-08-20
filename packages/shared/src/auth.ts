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
  /** Seconds since the epoch. Standard JWT claim, verified by `jose` along with the signature. */
  iat?: number;
}

/** The authenticated principal the API attaches to each request after verifying the JWT. */
export interface AuthContext {
  userId: string;
  email: string | null;
  orgId: string | null;
  role: UserRole | null;
  /**
   * When this token was minted, in seconds since the epoch — the basis for step-up re-authentication
   * (`middleware/requireFreshAuth.ts`). It comes off the SAME verified JWT as the rest of this
   * context, so proving freshness costs no extra table, no extra round trip and no new state.
   *
   * OPTIONAL, and absence means "not fresh". A token minted before this field existed, or a test
   * persona that does not set it, is refused by the step-up gate rather than waved through — the
   * whole point of the gate is to be certain, and "we could not tell" is not certainty.
   */
  issuedAt?: number | null;
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
export const APP_SECTIONS = ["fuel", "dispatch", "safety", "hazmat", "fleet", "recruitment", "admin"] as const;
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
 *
 * ── `recruitment`, added 2026-08-19, and why it is a section rather than a corner of Fleet ───────
 * Hiring paperwork has a DIFFERENT audience from the vehicle roster. Gating it on `fleet` — which is
 * what it shipped as — meant a `dispatcher` could read every driver's former employers, their dates
 * and their contact details, because a dispatcher reads Fleet to see who is on which truck.
 * §391.53(a)(1) points the other way: the investigation history belongs to "those who are involved in
 * the hiring decision". A section is the mechanism this codebase already has for saying that, so the
 * matrix says it here once and the nav, the route guards and the RLS policy all read it from here.
 *
 * `dispatcher: none` is therefore a deliberate NARROWING of what shipped, not a default carried over.
 * `auditor: view` is equally deliberate: a DOT audit is precisely the reader who asks for the §391.23
 * investigation file.
 *
 * This costs no SQL. There is no section helper in the database — `0078_role_department_rls.sql`
 * derived each policy from `rolesThatManage(section)` BY HAND, per table, at authoring time. So a new
 * section changes this matrix and its consumers, and touches a migration only when a table's own
 * policy needs to move with it.
 */
const SECTION_ACCESS: Record<UserRole, Record<AppSection, SectionAccess>> = {
  admin: { fuel: "manage", dispatch: "manage", safety: "manage", hazmat: "manage", fleet: "manage", recruitment: "manage", admin: "manage" },
  fleet_manager: { fuel: "manage", dispatch: "manage", safety: "manage", hazmat: "manage", fleet: "manage", recruitment: "manage", admin: "none" },
  dispatcher: { fuel: "view", dispatch: "manage", safety: "none", hazmat: "manage", fleet: "view", recruitment: "none", admin: "none" },
  safety_manager: { fuel: "view", dispatch: "none", safety: "manage", hazmat: "manage", fleet: "manage", recruitment: "manage", admin: "none" },
  auditor: { fuel: "view", dispatch: "view", safety: "view", hazmat: "view", fleet: "view", recruitment: "view", admin: "none" },
  // `fleet: "view"` and not "manage" (RECRUITER-ROLE-SCOPE.md Option B). A recruiter needs to read the
  // roster and open a driver's §391.51 file — routes/compliance.ts gates on rolesThatCanView("fleet")
  // — but `fleet: "manage"` would also hand them vehicles, trailers and terminals through 17 existing
  // policies, which is the very leak the `recruitment` section was introduced to close. The one write
  // they genuinely need, creating and editing the applicant's driver row, is granted by NAME on the
  // roster routes and in 0212's policy rather than by widening the section.
  recruiter: { fuel: "none", dispatch: "none", safety: "none", hazmat: "none", fleet: "view", recruitment: "manage", admin: "none" },
  driver: { fuel: "none", dispatch: "none", safety: "none", hazmat: "none", fleet: "none", recruitment: "none", admin: "none" },
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

/**
 * Who may move a driver through their EMPLOYMENT LIFECYCLE — `status` and `termination_date`.
 *
 * A recruiter creates and edits the applicant's row (`canWriteDriver` on the roster router, 0212's
 * `drivers_write`), and stops there. Terminating somebody is a fleet act, not a hiring one, and it is
 * consequential in a way the rest of the roster edit is not: `resolveDriverUpdate` stamps
 * `termination_date` on the way to `terminated`, which starts the §391.51(c) retention clock, and
 * `auth_driver_id()` (0083) resolves only `active` drivers — so a status edit silently ends somebody's
 * access to the driver app on their next request.
 *
 * Derived from the section matrix rather than hand-listed, so it cannot drift from `fleet: manage`.
 * The reverse direction matters as much as the forward one: a recruiter must not be able to move a
 * terminated driver back to `active` either, which is why this is about the FIELD and not about the
 * value `terminated`.
 */
export const canWriteDriverLifecycle = (role: UserRole | null | undefined): boolean =>
  canManageSection(role, "fleet");

/** Resolving anomalies is a Safety-section action, so safety_manager qualifies too. */
export const canResolveAnomalies = (role: UserRole | null | undefined): boolean =>
  canManageSection(role, "safety");

export const isReadOnly = (role: UserRole | null | undefined): boolean => role === "auditor";

export const claimsToContext = (c: AuthClaims): AuthContext => ({
  userId: c.sub,
  email: c.email ?? null,
  orgId: c.org_id ?? null,
  role: c.user_role ?? null,
  // Carried through verbatim: a number here is only ever one `jose` has already verified the
  // signature over, so nothing downstream has to trust the client about when it signed in.
  issuedAt: typeof c.iat === "number" ? c.iat : null,
});

// ── Restricted qualification records (Phase G, D-DQ15; SPLIT 2026-08-19) ─────
//
// Federal law puts some safety-file records behind controlled access, narrower than the fleet
// section's `canView`. Until 2026-08-19 this was ONE flag over one list, which was fine while the
// two rules happened to name the same roles. The `recruiter` role is what forced them apart, because
// the two rules are addressed to different people:
//
//   §382.401(a) — drug & alcohol testing records live in "a secure location with controlled access".
//                 Says nothing about hiring; it is a custody rule.
//   §391.53(a)(1) — the investigation history (previous-employer inquiries and their responses) goes
//                 to "those who are involved in the hiring decision". That IS the recruiter, by name.
//
// A recruiter who cannot read a previous-employer response cannot do the job §391.23(a)(2) assigns
// them — they can chase the inquiry and never see the answer. So the lists are separate, the
// predicates are separate, and `canReadRestrictedKind` is the one place that joins them.
//
// THE SINGLE SOURCE OF TRUTH for which kinds are restricted and who may read them. Consumed by three
// enforcement layers that must agree: the restrictive RLS policies (0211 — the PostgREST path), the
// API filters in routes/compliance.ts (the service-role path, where RLS cannot help), and the web
// UI's affordance gating. A kind listed in two places is how one layer forgets.

/** §382.401(a) custody. The Clearinghouse kinds are included as prudent practice — they are D&A
 *  program records in substance, though §382.401's enumeration was not verified to name them. */
export const TESTING_RECORD_KINDS = [
  "drug_test",
  "alcohol_test",
  "clearinghouse_full",
  "clearinghouse_limited",
] as const;

/** §391.53(a)(1) investigation history. */
export const INVESTIGATION_HISTORY_KINDS = [
  "previous_employer_inquiry",
  "previous_employer_response",
  /**
   * The FMCSA PSP record (0217). Investigation history rather than a testing record, and the
   * consequence is concrete: `canReadInvestigationHistory` includes the recruiter, so the person who
   * spent the money can open the document. Filing it with the §382.401 records would have left a
   * recruiter able to buy a report they are not permitted to read.
   */
  "psp_report",
] as const;

/** Every kind that is restricted at all, from either rule. Order preserved from before the split so
 *  a reader diffing this file sees a regrouping rather than a change of membership. */
export const RESTRICTED_QUALIFICATION_KINDS = [
  ...TESTING_RECORD_KINDS,
  ...INVESTIGATION_HISTORY_KINDS,
] as const;

const TESTING_KIND_SET: ReadonlySet<string> = new Set(TESTING_RECORD_KINDS);
const INVESTIGATION_KIND_SET: ReadonlySet<string> = new Set(INVESTIGATION_HISTORY_KINDS);
const RESTRICTED_KIND_SET: ReadonlySet<string> = new Set(RESTRICTED_QUALIFICATION_KINDS);

export const isRestrictedQualificationKind = (kind: string): boolean =>
  RESTRICTED_KIND_SET.has(kind);

/** §382.401(a) — unchanged by the split: admin + safety_manager. */
export const canReadTestingRecords = (role: UserRole | null | undefined): boolean =>
  role === "admin" || role === "safety_manager";

/** §391.53(a)(1) — the recruiter is the person the regulation is describing. */
export const canReadInvestigationHistory = (role: UserRole | null | undefined): boolean =>
  role === "admin" || role === "safety_manager" || role === "recruiter";

/**
 * The one predicate every layer should ask. Per KIND, because after the split a role's answer is no
 * longer uniform across the restricted set — a recruiter reads one half and not the other.
 *
 * Unrestricted kinds are readable by anyone who got this far: the fleet/recruitment section guard
 * already decided whether the caller may see the file at all.
 */
export const canReadRestrictedKind = (kind: string, role: UserRole | null | undefined): boolean => {
  if (TESTING_KIND_SET.has(kind)) return canReadTestingRecords(role);
  if (INVESTIGATION_KIND_SET.has(kind)) return canReadInvestigationHistory(role);
  return true;
};

/**
 * BOTH halves — the entitlement a whole-file operation needs.
 *
 * The binder is the case this exists for. `dq_exports.include_restricted` is a single boolean on a
 * ledger row, rendered later by a worker that no longer has the requester in hand, so a partial
 * entitlement cannot be expressed in the artifact. Rather than widen the schema to carry a per-kind
 * grant, a restricted binder keeps the entitlement it has always had: admin + safety_manager. A
 * recruiter reads investigation history in the app and does not export a restricted binder.
 */
export const canReadAllRestricted = (role: UserRole | null | undefined): boolean =>
  canReadTestingRecords(role) && canReadInvestigationHistory(role);

/** The one filter both API read paths apply, now per row rather than per caller. */
export function filterRestrictedRows<T extends { kind: string }>(
  rows: readonly T[],
  role: UserRole | null | undefined,
): T[] {
  return rows.filter((r) => canReadRestrictedKind(r.kind, role));
}
