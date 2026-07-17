import { z } from "zod";
import type { FuelType, AnomalySeverity } from "./constants.js";

const optionalText = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().trim().min(1).optional(),
);
const optionalNumber = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().optional(),
);

/**
 * Manual fill-up entry. `id` is generated CLIENT-SIDE (UUID v4) and reused as the storage path
 * prefix (audit H8/M6). org_id, price_per_gal, entered_by, source are added by the caller on insert.
 */
export const fillUpInputSchema = z.object({
  id: z.uuid(),
  vehicle_id: z.uuid("Select a vehicle"),
  driver_id: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.uuid().optional()),
  fueled_at: z.string().min(1, "Fuel time is required"),
  odometer: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.coerce.number().nonnegative().optional(),
  ),
  gallons: z.coerce.number().positive("Gallons must be greater than 0"),
  total_cost: optionalNumber.pipe(z.number().nonnegative().optional()),
  location_text: optionalText,
});

export type FillUpInput = z.infer<typeof fillUpInputSchema>;

export interface FuelTransaction {
  id: string;
  org_id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  fueled_at: string;
  odometer: number | null;
  gallons: number;
  price_per_gal: number | null;
  total_cost: number | null;
  location_text: string | null;
  /** Station state (2-letter) — used to render fueling times in the station's local timezone. */
  state?: string | null;
  source: string;
  computed_mpg: number | null;
  has_anomaly: boolean;
  max_severity: AnomalySeverity | null;
  ai_risk_level: AnomalySeverity | null;
  samsara_location_confidence?: string | null;
  /** tractor propulsion tank vs reefer (trailer) tank. Default 'tractor'. */
  tank_type?: "tractor" | "reefer";
  /** When telematics corroborated this fill (null = uncorroborated). Powers coverage %. */
  samsara_recon_at?: string | null;
  created_at: string;
}

/** A transaction's at-a-glance verification status — so a normal fill reads as "clear/verified", not as
 *  a suspect. Only HIGH/CRITICAL anomalies are true "alerts"; low/medium are "review". */
export type TxnStatus = "alert" | "review" | "verified" | "clear";

export interface TxnStatusInfo {
  status: TxnStatus;
  label: string;
  /** Whether Samsara positively confirmed the fueling location (proximity or in-state). */
  locationConfirmed: boolean;
}

export function fuelTxnStatus(
  t: Pick<FuelTransaction, "has_anomaly" | "max_severity" | "samsara_location_confidence">,
): TxnStatusInfo {
  const conf = t.samsara_location_confidence ?? null;
  const locationConfirmed = conf === "gps_confirmed" || conf === "in_state";
  if (t.has_anomaly && (t.max_severity === "high" || t.max_severity === "critical")) {
    return { status: "alert", label: "Alert", locationConfirmed };
  }
  if (t.has_anomaly && (t.max_severity === "medium" || t.max_severity === "low")) {
    return { status: "review", label: "Review", locationConfirmed };
  }
  if (locationConfirmed) return { status: "verified", label: "Verified", locationConfirmed };
  return { status: "clear", label: "Clear", locationConfirmed };
}

/**
 * Derived price per gallon. `gallons` + `total_cost` are authoritative; price is computed (audit L3),
 * rounded to 3 decimals. Returns null when it can't be computed.
 */
export function derivePricePerGal(
  gallons: number,
  totalCost: number | null | undefined,
): number | null {
  if (totalCost == null || gallons <= 0) return null;
  return Math.round((totalCost / gallons) * 1000) / 1000;
}

export interface FillUpWarnings {
  /** No odometer entered — every downstream calc depends on it (amber nudge). */
  odometerMissing: boolean;
  /** Odometer is below the vehicle's last known reading (red). */
  odometerBelowLast: boolean;
  /** Gallons exceed the tank — fuel can't fit; a theft signal that must be hard-confirmed (red). */
  exceedsCapacity: boolean;
}

/** Compute entry-time warnings from the vehicle's current data (audit M10). Pure + testable. */
export function computeFillUpWarnings(args: {
  gallons: number;
  odometer: number | null | undefined;
  tankCapacityGal: number;
  lastOdometer: number | null | undefined;
  fuelType: FuelType;
}): FillUpWarnings {
  return {
    odometerMissing: args.odometer == null,
    odometerBelowLast:
      args.odometer != null && args.lastOdometer != null && args.odometer < args.lastOdometer,
    exceedsCapacity: args.tankCapacityGal > 0 && args.gallons > args.tankCapacityGal,
  };
}
