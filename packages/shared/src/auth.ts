import { USER_ROLES, isApplicantStatus, type UserRole } from "./constants.js";

/**
 * Claims Silvicom 360 reads from a verified Supabase JWT.
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
export const APP_SECTIONS = ["fuel", "dispatch", "safety", "hazmat", "roster", "equipment", "recruitment", "admin", "settings", "accounting", "billing", "maintenance"] as const;
export type AppSection = (typeof APP_SECTIONS)[number];
export type SectionAccess = "none" | "view" | "manage";

/**
 * Role → per-section access. THE single source of truth for what each role can see/do, consumed by the web
 * nav, the API's requireRole guards (via rolesThatManage/rolesThatCanView), and mirrored by the SQL section
 * helpers in the RLS migration — all three must stay in lockstep.
 *
 * Department roles: `dispatcher` manages Dispatch (reads Fuel, Roster + Equipment); `safety_manager`
 * manages Safety + Roster and READS Equipment (reads Fuel). `driver` is "none" here — the Dashboard +
 * their own Fuel Log are ungated nav items, not section-scoped surfaces.
 *
 * ── `fleet` SPLIT into `roster` + `equipment`, 2026-08-30 (D-ROS12, DRIVER-ROSTER-PLAN §6 Q1) ────
 * One word answered two questions — the people and the trucks — and nothing could be said about one
 * without saying it about the other. The forcing case: a `safety_manager` owns the §391.51 driver
 * qualification file and must edit driver rows, but has no business editing a tractor's plate. Under
 * one `fleet` section that is not expressible, so the previous answer was a HAND-WRITTEN helper —
 * `canManageFleet`, `admin || fleet_manager` — sitting beside a matrix that said something else. The
 * helper won in the web and the matrix won in the API, and a safety_manager ended up with `manage` in
 * the database and a read-only screen. A section that cannot express the rule produces a second rule
 * somewhere else; that is the failure this split removes.
 *
 * The two sections are drawn on WHO THE ROW IS ABOUT, not on which page it is edited from:
 *   • `roster`    — drivers, their assignments and their time off. A fact about a person.
 *   • `equipment` — vehicles and trailers. A fact about a machine.
 * `driver_vehicle_assignments` is the deliberate close call and it lands in `roster` (owner ruling,
 * 2026-08-30): the assignment is performed from the Vehicles page, but the truck is the object of
 * the sentence and the driver is the subject. See 0277's header.
 *
 * ── `settings`, added 2026-08-30 (D-ROS13, DRIVER-ROSTER-PLAN R0; owner ruling) ──────────────────
 * The operations console — the Settings directory, Data & sync, and the exports beside them. It is a
 * section for the same reason `roster`/`equipment` are two: `canManageFleet` was being asked to mean
 * "may configure the product", which is not a statement about the fleet at all, and a helper that
 * answers a question no section asks is exactly how the matrix and the web drifted apart.
 *
 * `auditor: view` and not `none`: the audit log card is on this page and a read-only reviewer is its
 * intended reader. `safety_manager: none` even though they now hold `roster: manage` — maintaining
 * the §391.51 file is not a reason to re-sync Samsara or change the org's operating hours.
 *
 * ⚠ Its members are exactly the old `canManageFleet` set (admin + fleet_manager), and deliberately:
 * R0's job was to say what those 50 call sites MEANT, not to re-decide who may do what. Ten of them
 * meant this, and had no way to say it. Each of the other forty was checked against the API gate it
 * actually calls before being pointed at a section.
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
  admin: { fuel: "manage", dispatch: "manage", safety: "manage", hazmat: "manage", roster: "manage", equipment: "manage", recruitment: "manage", admin: "manage", settings: "manage", accounting: "manage", billing: "manage", maintenance: "manage" },
  fleet_manager: { fuel: "manage", dispatch: "manage", safety: "manage", hazmat: "manage", roster: "manage", equipment: "manage", recruitment: "manage", admin: "none", settings: "manage", accounting: "none", billing: "none", maintenance: "manage" },
  dispatcher: { fuel: "view", dispatch: "manage", safety: "none", hazmat: "manage", roster: "view", equipment: "view", recruitment: "none", admin: "none", settings: "none", accounting: "none", billing: "none", maintenance: "none" },
  // `equipment: "view"` is THE point of D-ROS12. A safety manager maintains the §391.51 file, so they
  // must write driver rows (`roster: manage`); a tractor's plate, VIN and registration are the fleet
  // manager's record and were only ever reachable because one section covered both. The database side
  // of this narrowing is 0277 — it drops this role from `vehicles_write` and `trailers_write`.
  safety_manager: { fuel: "view", dispatch: "none", safety: "manage", hazmat: "manage", roster: "manage", equipment: "view", recruitment: "manage", admin: "none", settings: "none", accounting: "none", billing: "none", maintenance: "none" },
  auditor: { fuel: "view", dispatch: "view", safety: "view", hazmat: "view", roster: "view", equipment: "view", recruitment: "view", admin: "none", settings: "view", accounting: "view", billing: "view", maintenance: "view" },
  // `roster: "view"` and not "manage" (RECRUITER-ROLE-SCOPE.md Option B). A recruiter needs to read the
  // roster and open a driver's §391.51 file — routes/compliance.ts gates on rolesThatCanView("roster")
  // — but `roster: "manage"` would hand them the whole roster's writes. The one write they genuinely
  // need, creating and editing the applicant's driver row, is granted by NAME on the roster routes and
  // in 0212's policy rather than by widening the section.
  //
  // `equipment: "none"` is a NARROWING taken with the split (D-ROS12). Under the old `fleet: "view"` a
  // recruiter could read vehicles and trailers, which the RECRUITER-ROLE-SCOPE comment above called
  // the leak it was closing while still leaving it open on the read side. Nobody hiring a driver needs
  // the tractor list.
  recruiter: { fuel: "none", dispatch: "none", safety: "none", hazmat: "none", roster: "view", equipment: "none", recruitment: "manage", admin: "none", settings: "none", accounting: "none", billing: "none", maintenance: "none" },
  driver: { fuel: "none", dispatch: "none", safety: "none", hazmat: "none", roster: "none", equipment: "none", recruitment: "none", admin: "none", settings: "none", accounting: "none", billing: "none", maintenance: "none" },
  // ── `accountant`, added 2026-08-27 (D-SEP7, SEPARATION-PROGRAM-PLAN; the 2026-08-27 owner ruling) ──
  // The money role, and deliberately ONLY the money role — the recruiter lesson (above) applied on
  // day one instead of after a leak: books access does not ride along with fleet or dispatch, and
  // fleet/dispatch access does not ride along with the books. `fuel: view` because fuel spend IS the
  // largest expense line and the accounting surfaces cite it; `maintenance: view` for the repair-spend
  // side of the same ledger (managing the shop is fleet_manager's job, not the bookkeeper's).
  // `fleet_manager` gets NO books access on the same argument in reverse — an org whose ops lead also
  // does the books expresses that as a second membership decision by the admin, not as a default.
  accountant: { fuel: "view", dispatch: "none", safety: "none", hazmat: "none", roster: "none", equipment: "none", recruitment: "none", admin: "none", settings: "none", accounting: "manage", billing: "manage", maintenance: "view" },
  // ── `technician`, added 2026-08-31 (D-AVI11, ANNUAL-INSPECTION-PLAN; the owner's ruling) ────────
  // The shop floor, and deliberately ONLY the shop floor. The person who performs the §396.17
  // annual inspection needs one section and one read; `fleet_manager` — the obvious shortcut, since
  // it already carries `maintenance: manage` — would also hand them fuel, dispatch, safety, hazmat,
  // the whole roster, hiring and the settings console. That is the recruiter mistake and then the
  // accountant lesson; twice is a pattern, and a third would be a decision rather than an accident.
  //
  // `equipment: "view"` and not "manage" on exactly the argument D-ROS12 made for the safety
  // manager: reading which tractor is unit 654 is what an inspection needs, and a tractor's plate,
  // VIN and registration remain the fleet manager's record. `roster: "none"` because an inspector
  // inspects machines — nothing in Appendix A needs a driver's name, licence or medical card.
  // `settings: "none"` on the R0 argument: maintaining equipment is not a reason to re-sync
  // Samsara. No `accounting`/`billing`, on 0266's ruling read in the other direction — managing the
  // shop is not bookkeeping, and bookkeeping does not come with a wrench.
  technician: { fuel: "none", dispatch: "none", safety: "none", hazmat: "none", roster: "none", equipment: "view", recruitment: "none", admin: "none", settings: "none", accounting: "none", billing: "none", maintenance: "manage" },
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
 * Derived from the section matrix rather than hand-listed, so it cannot drift from `roster: manage`.
 * The reverse direction matters as much as the forward one: a recruiter must not be able to move a
 * terminated driver back to `active` either, which is why this is about the FIELD and not about the
 * value `terminated`.
 */
export const canWriteDriverLifecycle = (role: UserRole | null | undefined): boolean =>
  canManageSection(role, "roster");

/**
 * Who may ARCHIVE a driver — hide their row from the roster and the applicant board (migration 0235).
 *
 * ── WHY THIS IS NOT `canWriteDriverLifecycle` ─────────────────────────────────────────────────
 * Archiving is not a lifecycle act. It changes nothing about the person's employment, starts no
 * retention clock and ends no driver-app session; the row, the §391.51 file and every signed
 * instrument are untouched and stay reproducible. What it changes is which of two lists somebody has
 * to read — and the two lists have two different owners.
 *
 * So the rule follows the LIST, not the table: an **applicant** is the recruiter's to tidy away,
 * because the applicant board is the recruiter's surface (`rolesThatManage("recruitment")`). Anyone
 * else on the roster is the roster section's own, because Fleet → Drivers is that section's list. A
 * recruiter archiving a hired driver would be reaching across into somebody else's list; a fleet
 * manager may do both, because `roster: manage` implies the whole roster.
 *
 * ⚠ **The database does not mirror this one, and deliberately.** 0235's `guard_driver_archive_writer`
 * refuses `archived_at` to EVERY JWT-bearing writer, recruiter and admin alike — archiving goes
 * through the API so that it always carries its `driver.archived` audit row. The split below is
 * therefore enforced in exactly one place, which is the opposite of 0213's arrangement and correct
 * for the same reason 0213 is: there, the API and PostgREST were two paths to the same write, and the
 * rule had to exist twice. Here there is only one path, because the other one is closed.
 */
export const canArchiveDriver = (
  role: UserRole | null | undefined,
  driverStatus: string | null | undefined,
): boolean =>
  canManageSection(role, "roster")
  || (isApplicantStatus(driverStatus) && canManageSection(role, "recruitment"));

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
  /**
   * §40.305 return-to-duty documentation (0237). Here rather than with the investigation history on
   * the same reasoning the Clearinghouse kinds are: it states that a driver had a drug or alcohol
   * programme violation and what a substance abuse professional concluded about it, which is a
   * §382.401(a) record in substance whatever the paragraph enumerates.
   *
   * ⚠ The consequence is deliberate and is felt by the recruiter: they can see THAT a hire is
   * blocked (the flag on the driver is not a testing record) and they cannot read the document that
   * unblocks it. That is the right division — §40.25(j) is a decision for the people §382.401(a)
   * lets hold the file.
   */
  "return_to_duty",
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

// ── Per-org overrides of the matrix (D-PERM1, EDITABLE-PERMISSIONS-PLAN.md) ───

/**
 * The roles an organisation may edit. Seven of the nine, and the two exclusions are RULINGS rather
 * than oversights (D-PERM7/D-PERM8, owner 2026-09-02):
 *
 *  · `admin` holds `manage` everywhere, permanently. Something has to be able to restore a matrix
 *    that has been edited into a corner, and an admin who can revoke their own access is an org
 *    locking itself out with no support path.
 *  · `driver` is locked at `none`. `router/index.ts` redirects `role === "driver"` to the app before
 *    any section check runs, so a section granted to a driver would be a permission that visibly
 *    does nothing — the worst kind, because it reads as a product that lies.
 *
 * Derived by SUBTRACTION from `USER_ROLES` rather than hand-listed, so a role added to the product
 * is editable by default and its exclusion has to be an explicit decision made here.
 */
export const UNEDITABLE_ROLES = ["admin", "driver"] as const satisfies readonly UserRole[];
export const EDITABLE_ROLES: UserRole[] = USER_ROLES.filter(
  (r) => !(UNEDITABLE_ROLES as readonly string[]).includes(r),
);

/**
 * The sections an organisation may edit — every one except `admin`.
 *
 * `admin` carries user management, so granting it to another role is a privilege-escalation path
 * the product does not have today, and an editable matrix must not invent one (D-PERM7). An org that
 * wants a second administrator promotes a member to the `admin` ROLE on the Users page, which is
 * audited and already exists.
 */
export const UNEDITABLE_SECTIONS = ["admin"] as const satisfies readonly AppSection[];
export const EDITABLE_SECTIONS: AppSection[] = APP_SECTIONS.filter(
  (s) => !(UNEDITABLE_SECTIONS as readonly string[]).includes(s),
);

export const isEditableRole = (role: string): role is UserRole =>
  (EDITABLE_ROLES as string[]).includes(role);
export const isEditableSection = (section: string): section is AppSection =>
  (EDITABLE_SECTIONS as string[]).includes(section);

/**
 * One org's overrides, keyed `role` → `section` → access. SPARSE (D-PERM4): a pair with no entry is
 * not denied, it is UNCHANGED, and its answer is the shipped default in `SECTION_ACCESS`.
 *
 * The sparseness is the whole design. A complete matrix would have to be stored somewhere, which
 * means the database needing its own copy of the defaults, which means codegen and a drift gate to
 * keep the copy equal to this file. Every consumer already holds the defaults: the API and the web
 * hold `SECTION_ACCESS` at compile time, and SQL holds them as the `auth_role() = ANY (ARRAY[…])`
 * list already written into each policy — lists `lint:section-policies` has checked against this
 * matrix since 0260.
 */
export type SectionOverrides = Partial<Record<UserRole, Partial<Record<AppSection, SectionAccess>>>>;

/**
 * The access a role actually has, given an org's overrides. THE function every consumer asks; the
 * bare `sectionAccess` above answers only "what does this role ship with".
 *
 * An override for an uneditable role or section is IGNORED rather than honoured. It cannot be
 * written — the CHECK constraints in 0290 refuse it and the endpoint refuses it first — so reaching
 * this branch means a row exists that should not, and the two locks must hold anyway. A resolver
 * that trusted its input would turn a bad row into an escalation.
 */
export const effectiveSectionAccess = (
  role: UserRole | null | undefined,
  section: AppSection,
  overrides: SectionOverrides | null | undefined,
): SectionAccess => {
  const shipped = sectionAccess(role, section);
  if (!role || !overrides) return shipped;
  if (!isEditableRole(role) || !isEditableSection(section)) return shipped;
  return overrides[role]?.[section] ?? shipped;
};
