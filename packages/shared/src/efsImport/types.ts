/** EFS parsing — shared types + product/tank constants (split from efsImport.ts). */
import type { FuelType } from "../constants.js";

export type ReportKind = "transaction" | "reject" | "unknown";

/** Product (Item) codes that count as propulsion fuel → become fuel transactions. */
export const FUEL_PRODUCT_CODES: Record<string, FuelType> = {
  ULSD: "diesel", // ultra-low-sulfur diesel
  ULSR: "diesel", // reefer/off-road diesel
  DSL: "diesel",
  BIO: "diesel",
  UNL: "gasoline",
  UNLD: "gasoline",
  RUL: "gasoline", // regular unleaded
  MUL: "gasoline", // mid unleaded
  PUL: "gasoline", // premium unleaded
};

export type RawRow = Record<string, string | number | null | undefined>;

/** Which physical tank a fuel line filled: the tractor's propulsion tank or a reefer (trailer) tank. */
export type TankType = "tractor" | "reefer";

/**
 * EFS item codes billed as REEFER (trailer refrigeration / off-road) fuel — dyed, tax-exempt diesel.
 * Kept separate from tractor fuel so reefer gallons don't inflate the tractor's tank-capacity /
 * over-fuel / MPG checks. (Silvicom's exports use ULSR; extend here if a merchant uses RFR/REEF.)
 */
export const REEFER_ITEM_CODES = new Set(["ULSR", "RFR", "REEF", "RFER"]);

/** Classify a fuel line's tank from its EFS Item code. Unknown/tractor codes → 'tractor'. */
export function tankTypeForItem(item: string | null | undefined): TankType {
  return item && REEFER_ITEM_CODES.has(item.trim().toUpperCase()) ? "reefer" : "tractor";
}

/** Whether a fueling timestamp carries a real time-of-day ("instant") or only a date ("date"). */
export type EfsTimePrecision = "instant" | "date";

export interface ParsedFuelLine {
  external_ref: string;
  unit: string | null;
  driver_name: string | null;
  card_ref: string | null;
  /** EFS Driver Control ID — a stable per-driver identifier printed on the report. Reliable card/driver
   *  identity even when EFS masks the card to the last 4 (so same-last-4 drivers aren't conflated). */
  control_id: string | null;
  fueled_at: string; // ISO instant (true UTC when a POS time + station tz were available)
  /** The EFS business date (station-local, YYYY-MM-DD) — stable across timezones; keys dedupe. */
  tran_date: string;
  /** "instant" when a real POS time-of-day was present; "date" for date-only rows (noon sentinel). */
  fueled_at_precision: EfsTimePrecision;
  odometer: number | null;
  gallons: number;
  price_per_gal: number | null;
  total_cost: number | null;
  fuel_type: FuelType;
  /** tractor propulsion tank vs reefer (trailer) tank — reefer lines are scored separately. */
  tank_type: TankType;
  item: string;
  location_text: string | null;
  city: string | null;
  state: string | null;
}

export interface SkippedRow {
  row_number: number;
  reason: string;
  item?: string;
}

export interface ParsedDeclined {
  external_ref: string;
  declined_at: string;
  card_ref: string | null;
  invoice: string | null;
  location_id: string | null;
  unit: string | null;
  driver_ext_id: string | null;
  driver_name: string | null;
  location_text: string | null;
  city: string | null;
  state: string | null;
  error_code: string | null;
  error_description: string | null;
  policy: string | null;
  policy_name: string | null;
}
