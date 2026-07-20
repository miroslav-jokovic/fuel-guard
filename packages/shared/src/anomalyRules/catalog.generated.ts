// ────────────────────────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT BY HAND.
// Source of truth: catalog.yaml · Regenerate: `pnpm gen:rules` · CI fails on drift.
// ────────────────────────────────────────────────────────────────────────────────────────────

export const RULE_IDS = [
  // Tier 1 — odometer integrity
  "odometer_missing",
  "odometer_regression",
  "odometer_stale",
  "odometer_implausible_jump",
  "odometer_daily_cap",
  "odometer_mismatch",
  "odometer_entry_suspect",
  "expected_odometer_band",
  // Tier 2 — volume vs capacity
  "exceeds_tank_capacity",
  "tank_space_exceeded",
  "implausible_topoff",
  "cumulative_overfuel",
  // Tier 3 — efficiency
  "mpg_deviation",
  "mpg_sustained_decline",
  // Tier 4 — behavioral
  "rapid_repeat_fueling",
  "off_hours_fueling",
  "unattributed_transaction",
  "cost_outlier",
  "card_multi_vehicle",
  "location_mismatch",
  "tank_fill_short",
  // Tier A — reefer (trailer refrigeration) fuel integrity (reefer/ULSR events only)
  "reefer_exceeds_capacity",
  "reefer_overfuel_rate",
  "reefer_fuel_diversion",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export type SignalAxis = "odometer" | "consumption" | "volume" | "behavior" | "location" | "reefer";

/** Human-readable label for every rule ID. Used wherever the raw snake_case key would be shown. */
export const RULE_LABELS: Record<RuleId, string> = {
  odometer_missing: "Missing Odometer",
  odometer_regression: "Odometer Regression",
  odometer_stale: "Stale Odometer",
  odometer_implausible_jump: "Implausible Odometer Jump",
  odometer_daily_cap: "Daily Mileage Cap Exceeded",
  odometer_mismatch: "Odometer / Location Mismatch",
  odometer_entry_suspect: "Odometer Entry Needs Review",
  expected_odometer_band: "Outside Expected Odometer Band",
  exceeds_tank_capacity: "Exceeds Tank Capacity",
  tank_space_exceeded: "More Fuel Than Tank Could Hold",
  implausible_topoff: "Implausible Top-Off",
  cumulative_overfuel: "Cumulative Overfueling",
  mpg_deviation: "MPG Deviation",
  mpg_sustained_decline: "Sustained MPG Decline",
  rapid_repeat_fueling: "Rapid Repeat Fueling",
  off_hours_fueling: "Off-Hours Fueling",
  unattributed_transaction: "Unattributed Transaction",
  cost_outlier: "Cost Outlier",
  card_multi_vehicle: "Card Used on Multiple Vehicles",
  location_mismatch: "Location Mismatch",
  tank_fill_short: "Tank Fill Short",
  reefer_exceeds_capacity: "Reefer Fill Exceeds Tank",
  reefer_overfuel_rate: "Reefer Over-Fueling",
  reefer_fuel_diversion: "Reefer Fueled with ULSD",
};

/** Rules the product never raises as anomalies (data-quality facts stay on the transaction). */
export const SUPPRESSED_RULE_IDS: readonly RuleId[] = [
  "odometer_missing",
  "unattributed_transaction",
] as const;

/** Correlation axis + directness-of-theft weight (0–100) per rule for the multi-signal model. */
export const SIGNAL_META: Record<RuleId, { axis: SignalAxis; weight: number }> = {
  odometer_missing: { axis: "odometer", weight: 0 },
  odometer_regression: { axis: "odometer", weight: 55 },
  odometer_stale: { axis: "odometer", weight: 25 },
  odometer_implausible_jump: { axis: "odometer", weight: 35 },
  odometer_daily_cap: { axis: "odometer", weight: 30 },
  odometer_mismatch: { axis: "odometer", weight: 45 },
  odometer_entry_suspect: { axis: "odometer", weight: 0 },
  expected_odometer_band: { axis: "consumption", weight: 40 },
  exceeds_tank_capacity: { axis: "volume", weight: 85 },
  tank_space_exceeded: { axis: "volume", weight: 90 },
  implausible_topoff: { axis: "consumption", weight: 50 },
  cumulative_overfuel: { axis: "consumption", weight: 75 },
  mpg_deviation: { axis: "consumption", weight: 30 },
  mpg_sustained_decline: { axis: "consumption", weight: 20 },
  rapid_repeat_fueling: { axis: "behavior", weight: 40 },
  off_hours_fueling: { axis: "behavior", weight: 20 },
  unattributed_transaction: { axis: "behavior", weight: 0 },
  cost_outlier: { axis: "behavior", weight: 15 },
  card_multi_vehicle: { axis: "behavior", weight: 60 },
  location_mismatch: { axis: "location", weight: 50 },
  tank_fill_short: { axis: "volume", weight: 60 },
  reefer_exceeds_capacity: { axis: "reefer", weight: 90 },
  reefer_overfuel_rate: { axis: "reefer", weight: 75 },
  reefer_fuel_diversion: { axis: "reefer", weight: 60 },
};
