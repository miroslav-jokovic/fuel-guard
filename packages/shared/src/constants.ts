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
