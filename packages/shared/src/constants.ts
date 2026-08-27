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
};

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
