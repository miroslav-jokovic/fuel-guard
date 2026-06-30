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
  source: string;
  computed_mpg: number | null;
  has_anomaly: boolean;
  max_severity: AnomalySeverity | null;
  ai_risk_level: AnomalySeverity | null;
  created_at: string;
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
