/** Anomaly rule identifiers, labels, and suppression list. */

export const RULE_IDS = [
  // Tier 1 — odometer integrity
  "odometer_missing",
  "odometer_regression",
  "odometer_stale",
  "odometer_implausible_jump", // instant-precision only (uses elapsed hours)
  "odometer_daily_cap", // date-precision (EFS) fallback (miles/day cap)
  "odometer_mismatch", // cross-source ±tolerance reconciliation (the driver-accuracy check)
  "odometer_entry_suspect", // cross-source diff so large it's a data-entry typo / OBD glitch, not theft
  "expected_odometer_band", // single-source: miles vs fuel-implied miles
  // Tier 2 — volume vs capacity
  "exceeds_tank_capacity",
  "tank_space_exceeded", // billed gallons > empty space in the tank before fueling (can't fit in THIS truck)
  "implausible_topoff",
  "cumulative_overfuel", // rolling-window gallons vs miles-burnable + a tank
  // Tier 3 — efficiency
  "mpg_deviation",
  "mpg_sustained_decline",
  // Tier 4 — behavioral
  "rapid_repeat_fueling", // instant-precision only
  "off_hours_fueling", // instant-precision only
  "unattributed_transaction",
  "cost_outlier",
  "card_multi_vehicle", // one card fueling multiple vehicles in a window
  "location_mismatch", // telematics shows the truck was NOT at the fueling location
  "tank_fill_short", // telematics tank rose less than billed gallons (advisory; coarse sensor)
  // Tier A — reefer (trailer refrigeration) fuel integrity (reefer/ULSR events only)
  "reefer_exceeds_capacity", // one ULSR purchase > reefer tank capacity — can't fit in the reefer
  "reefer_overfuel_rate", // rolling-window reefer gallons > a reefer could burn + a tank
  "reefer_fuel_diversion", // reefer-hauling truck buys ULSD but ~no reefer (ULSR) fuel → reefer fueled off ULSD
] as const;

export type RuleId = (typeof RULE_IDS)[number];

/**
 * Data-quality flags, NOT theft/misuse signals. These describe gaps in the source data (a fill that
 * couldn't be matched to a vehicle/driver, or a blank odometer) rather than suspicious behavior.
 * Flagging them as anomalies drowns the real signals, so by product decision they never raise an
 * anomaly. The underlying facts stay visible on the transaction itself (e.g. "Unattributed" in the
 * fuel log). Re-enable a rule by removing it here.
 */
export const SUPPRESSED_RULE_IDS: readonly RuleId[] = [
  "unattributed_transaction",
  "odometer_missing",
] as const;

/** Human-readable label for every rule ID. Used wherever the raw snake_case key would be shown. */
export const RULE_LABELS: Record<RuleId, string> = {
  odometer_missing:           "Missing Odometer",
  odometer_regression:        "Odometer Regression",
  odometer_stale:             "Stale Odometer",
  odometer_implausible_jump:  "Implausible Odometer Jump",
  odometer_daily_cap:         "Daily Mileage Cap Exceeded",
  odometer_mismatch:          "Odometer / Location Mismatch",
  odometer_entry_suspect:     "Odometer Entry Needs Review",
  expected_odometer_band:     "Outside Expected Odometer Band",
  exceeds_tank_capacity:      "Exceeds Tank Capacity",
  tank_space_exceeded:        "More Fuel Than Tank Could Hold",
  implausible_topoff:         "Implausible Top-Off",
  cumulative_overfuel:        "Cumulative Overfueling",
  mpg_deviation:              "MPG Deviation",
  mpg_sustained_decline:      "Sustained MPG Decline",
  rapid_repeat_fueling:       "Rapid Repeat Fueling",
  off_hours_fueling:          "Off-Hours Fueling",
  unattributed_transaction:   "Unattributed Transaction",
  cost_outlier:               "Cost Outlier",
  card_multi_vehicle:         "Card Used on Multiple Vehicles",
  location_mismatch:          "Location Mismatch",
  tank_fill_short:            "Tank Fill Short",
  reefer_exceeds_capacity:    "Reefer Fill Exceeds Tank",
  reefer_overfuel_rate:       "Reefer Over-Fueling",
  reefer_fuel_diversion:      "Reefer Fueled with ULSD",
};

/** Returns the human-friendly label for a rule ID, with a sensible fallback for unknown IDs. */
export function formatRuleId(ruleId: string): string {
  if (ruleId === "theft_case") return "Theft Risk";
  return (RULE_LABELS as Record<string, string>)[ruleId]
    ?? ruleId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}


