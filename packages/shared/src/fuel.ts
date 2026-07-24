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
 * Tender used for a MANUAL fill that was NOT bought on an EFS card (EFS-card / imported fills already carry
 * their card attribution). Stored on fuel_transactions.payment_method; null for EFS-card fills.
 */
export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "efs_check", label: "EFS check" },
  { value: "personal_card", label: "Personal card" },
  { value: "fleet_card", label: "Fleet card (non-EFS)" },
  { value: "fuel_voucher", label: "Fuel voucher" },
  { value: "other", label: "Other" },
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];
const PAYMENT_METHOD_VALUES = PAYMENT_METHODS.map((p) => p.value) as [PaymentMethod, ...PaymentMethod[]];

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
  // Optional: only manual, non-EFS-card fills carry a tender type.
  payment_method: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(PAYMENT_METHOD_VALUES).optional()),
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
  /** Tender for a manual non-EFS-card fill (see PAYMENT_METHODS); null for EFS-card / imported fills. */
  payment_method?: string | null;
  /** Fuel-card reference (EFS card number / manual card tag), when present. */
  card_ref?: string | null;
  computed_mpg: number | null;
  /** Miles driven since the previous fill for this vehicle (odometer delta, OBD-preferred; positive-only,
   *  calibration-aware). Null when there is no prior fill or the odometer is missing/regressing. */
  miles_since_last?: number | null;
  has_anomaly: boolean;
  max_severity: AnomalySeverity | null;
  /** WP2 "why" surface — the correlation outcome persisted on every scored fill, INCLUDING clear ones,
   *  so a fired-but-sub-threshold signal is visible instead of silently discarded. */
  case_level?: "clear" | "review" | "alert" | null;
  case_score?: number | null;
  case_signals?: { ruleId: string; axis: string; weight: number; severity: string; message: string }[] | null;
  /** WP6 — why detection was LIMITED on this fill: gating inputs + rules ineligible to fire. */
  case_gates?: { tankSensor: string; odoSource: string | null; fillSize: string; ineligible: string[] } | null;
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

/**
 * A card_ref reliably identifies ONE physical card only when it isn't masked or a bare last-4. Truncated
 * EFS reports (a masked PAN like "****1234", or a last-4 only) can share the same value across DIFFERENT
 * cards, so card-IDENTITY rules (one card on multiple trucks) must NOT run on them — they'd conflate
 * distinct cards into false alerts. Full numbers and real fleet card numbers (5+ unmasked chars) are reliable.
 */
export function isReliableCardRef(cardRef: string | null | undefined): boolean {
  if (!cardRef) return false;
  const c = cardRef.trim();
  if (c.length < 5) return false; // a bare last-4 (or shorter) can't distinguish cards
  if (/[*x\u2022]/i.test(c)) return false; // masked PAN — only the last few digits are real
  return true;
}
