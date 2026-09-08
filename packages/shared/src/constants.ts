/** Application-wide constants shared between web and api. */
export const APP_NAME = "Silvicom 360";

/** User roles within an organization (mirrors the `user_role` Postgres enum).
 *  `dispatcher` + `safety_manager` are department roles: scoped write access to one product area (see the
 *  section-capability matrix in auth.ts), read-only elsewhere. */
export const USER_ROLES = [
  "admin",
  "fleet_manager",
  "driver",
  "auditor",
  "dispatcher",
  "safety_manager",
  "recruiter",
  "accountant",
  "technician",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Human labels for the role pickers (invite + user management). */
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  fleet_manager: "Fleet manager",
  driver: "Driver",
  auditor: "Auditor (read-only)",
  dispatcher: "Dispatcher",
  safety_manager: "Safety manager",
  recruiter: "Recruiter",
  accountant: "Accountant",
  technician: "Technician (shop)",
};

/**
 * The roles whose MEMBERSHIP is issued and destroyed by the ROSTER, never by the Users page (DC10,
 * DRIVER-CREDENTIALS-PLAN.md, ruling 2026-09-08).
 *
 * ── WHY THIS EXISTS, WRITTEN THE DAY IT COST SOMETHING ─────────────────────────────────────────
 * A driver-app login is not an invited colleague. `createDriverLogin` mints the auth user, the
 * `driver` membership and the `drivers.user_id` link as ONE act, and `revokeDriverLogin` destroys
 * the three together — the plan says it plainly: "the synthetic-email user carries ONLY a `driver`
 * membership". That membership is not a permission the office grants; it is the credential itself,
 * because `custom_access_token_hook` reads `memberships` and NOTHING else to mint `org_id`. Delete
 * the row and the driver still authenticates, still holds a valid password, and lands forever on
 * "Account almost ready" — while the Drivers page goes on reporting that they have app access,
 * because `drivers.user_id` is untouched.
 *
 * That is not hypothetical. On 2026-08-31 01:27 UTC a `member.removed` on this org's Users page took
 * `aaron@drivers.fuelguard.app` out of `memberships`; the roster kept the link, "Reset password" on
 * 2026-09-07 could not help (it only calls `updateUserById`), and the driver was locked out for
 * eight days with every surface claiming he was fine. The Users page listed a driver login next to
 * the office staff, with a Remove item in its kebab and a select-all bulk remove above it — one
 * click from doing the same to every driver in the fleet at once.
 *
 * ── WHAT THE PRODUCT ALREADY DECIDED, AND WHY THIS IS ITS HOME ────────────────────────────────
 * Nothing here is a new rule. DC9 already ruled that a driver login is not invited by email, the
 * Users page already SAYS so in a banner pointing at the Drivers page, and D-PERM8 already locks
 * `driver` out of the permission matrix because a section granted to one does nothing. Each of those
 * spelled the literal `"driver"` in its own file. This is the one home they now read from, so the
 * next surface that has to know cannot get a fourth answer — and so the DATABASE's guarantee
 * (migration 0329) and the API's refusal are demonstrably the same rule rather than two that agree.
 *
 * It lives here, beside `USER_ROLES` and the `USER_ROLE_LABELS` the pickers render, because it
 * partitions the role VOCABULARY and needs nothing from the section matrix — auth.ts would only have
 * been the home for it if this were a question about permissions, which is precisely the mistake
 * that produced the incident.
 *
 * Derived by SUBTRACTION, the same shape as `EDITABLE_ROLES` in auth.ts: a role added to the product
 * is an office role by default, and putting it here has to be a decision somebody makes on purpose.
 */
export const ROSTER_ISSUED_ROLES = ["driver"] as const satisfies readonly UserRole[];

/** Everyone the Users page is FOR: invited by email, listed, re-roled and removed there. */
export const OFFICE_ROLES: UserRole[] = USER_ROLES.filter(
  (r) => !(ROSTER_ISSUED_ROLES as readonly string[]).includes(r),
);

/** True for a membership the roster owns — the Users page must neither offer it nor touch it. */
export const isRosterIssuedRole = (role: string | null | undefined): boolean =>
  (ROSTER_ISSUED_ROLES as readonly string[]).includes(role ?? "");

/** Fuel types (mirrors the `fuel_type` Postgres enum). */
export const FUEL_TYPES = ["diesel", "gasoline", "def", "electric", "other"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

/** Fuel types that participate in MPG / tank-capacity rules (audit H1). */
export const MPG_FUEL_TYPES: readonly FuelType[] = ["diesel", "gasoline"];

/** Idle-reduction equipment on a truck (free text in DB; constrained here for the UI). Refines has_apu. */
export const APU_TYPES = [
  "diesel_apu",
  "battery_hvac",
  "fuel_heater",
  "shore_power",
  "none",
] as const;
export type ApuType = (typeof APU_TYPES)[number];

/** Human labels for the idle-reduction equipment dropdown (plain language for the Vehicles page). */
export const APU_TYPE_LABELS: Record<ApuType, string> = {
  diesel_apu: "Diesel APU",
  battery_hvac: "Battery HVAC",
  fuel_heater: "Fuel-fired heater (heat only)",
  shore_power: "Shore power",
  none: "None",
};

/** Vehicle lifecycle status (mirrors the `vehicle_status` Postgres enum). */
export const VEHICLE_STATUSES = ["active", "maintenance", "retired"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

/**
 * Driver status (free text in DB; constrained here for the UI).
 *
 * Deliberately NOT a Postgres enum (master-data decision #8) — `drivers.status` stays `text` so the
 * ~100 telematics-synced rows never needed a backfill, and this list is the canonical vocabulary the
 * roster UI and API agree on. NOTE: `auth_driver_id()` (0083) resolves only `status = 'active'`, so
 * a driver on leave or terminated keeps their roster record but stops resolving in the driver app.
 */
/**
 * Where somebody stands with the carrier. `applicant` (HIRING-PLAN.md D-HIRE5) is not an employment
 * status at all — it is the state before there is any employment, and it exists here because
 * `driver_employment_history` and `driver_authorizations` both reference `drivers`, so an applicant
 * IS a drivers row. `drivers.status` is plain text with no enum and no CHECK, so this costs a
 * constant rather than a migration.
 *
 * Two protections fall out and both are wanted: `auth_driver_id()` (0083) resolves only `active`
 * rows, so an applicant can never reach the driver app; and `complianceOverview` selects
 * `["active", "on_leave"]` by INCLUSION, so an applicant never appears in a §391.51 queue for a file
 * that does not exist yet. Every OTHER status filter had to be checked by hand, because an exclusion
 * list (`status !== "inactive"`) silently admits a status added later — which is exactly what
 * happened to FleetReadiness.
 */
export const DRIVER_STATUSES = ["applicant", "active", "inactive", "on_leave", "terminated"] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const DRIVER_STATUS_LABELS: Record<DriverStatus, string> = {
  applicant: "Applicant",
  active: "Active",
  inactive: "Inactive",
  on_leave: "On leave",
  terminated: "Terminated",
};

/**
 * The statuses that mean "we employ, or employed, this person". The roster, headcounts and every
 * fleet surface read this rather than excluding `applicant` by name, so the next status added is a
 * decision somebody makes here instead of a leak somebody finds later.
 */
export const EMPLOYED_DRIVER_STATUSES = DRIVER_STATUSES.filter((s) => s !== "applicant");

export const isApplicantStatus = (status: string | null | undefined): boolean =>
  status === "applicant";

/** Anomaly severities (mirrors the `anomaly_severity` Postgres enum). */
export const ANOMALY_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type AnomalySeverity = (typeof ANOMALY_SEVERITIES)[number];

/** Anomaly workflow statuses (mirrors the `anomaly_status` Postgres enum). */
export const ANOMALY_STATUSES = [
  "open",
  "investigating",
  "resolved",
  "dismissed",
  "superseded",
] as const;
export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number];

/**
 * Ground-truth OUTCOME a reviewer records when closing a case — the label the whole accuracy
 * program is built on. Distinct from workflow `status`: status is "where is this in the queue",
 * disposition is "was the flag right".
 *  - confirmed        → a real theft/misuse issue (TRUE positive)
 *  - false_positive   → the flag was wrong: bad data, a telematics gap, a parsing artifact (FALSE positive)
 *  - benign_explained → the fact was real but the behavior was legitimate (not wrongdoing; not a true issue)
 *  - inconclusive     → couldn't be determined → EXCLUDED from precision (no ground truth)
 */
export const ANOMALY_DISPOSITIONS = [
  "confirmed",
  "false_positive",
  "benign_explained",
  "inconclusive",
] as const;
export type AnomalyDisposition = (typeof ANOMALY_DISPOSITIONS)[number];

/** Human labels for dispositions (UI + reports). */
export const DISPOSITION_LABELS: Record<AnomalyDisposition, string> = {
  confirmed: "Confirmed issue",
  false_positive: "False alarm",
  benign_explained: "Legitimate, explained",
  inconclusive: "Inconclusive",
};

/**
 * Verdict a reviewer gives an audited "clear" transaction in the recall sampling program. A random
 * sample of un-flagged (covered) fills is reviewed; a "missed" verdict is a FALSE NEGATIVE — theft the
 * engine didn't catch — which is what lets recall be measured rather than guessed.
 *  - clean  → correctly not flagged (no issue)
 *  - missed → should have been flagged (a miss / false negative)
 */
export const AUDIT_VERDICTS = ["clean", "missed"] as const;
export type AuditVerdict = (typeof AUDIT_VERDICTS)[number];

export const AUDIT_VERDICT_LABELS: Record<AuditVerdict, string> = {
  clean: "Clean — correctly cleared",
  missed: "Missed — should have flagged",
};
