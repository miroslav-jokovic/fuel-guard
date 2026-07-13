/** Application-wide constants shared between web and api. */
export const APP_NAME = "FuelGuard";

/** User roles within an organization (mirrors the `user_role` Postgres enum). */
export const USER_ROLES = ["admin", "fleet_manager", "driver", "auditor"] as const;
export type UserRole = (typeof USER_ROLES)[number];

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

/** Driver status (free text in DB; constrained here for the UI). */
export const DRIVER_STATUSES = ["active", "inactive"] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

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
