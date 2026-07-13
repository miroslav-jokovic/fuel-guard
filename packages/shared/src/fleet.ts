import { z } from "zod";
import {
  FUEL_TYPES,
  VEHICLE_STATUSES,
  DRIVER_STATUSES,
  MPG_FUEL_TYPES,
  APU_TYPES,
} from "./constants.js";
import type { FuelType, VehicleStatus, DriverStatus, ApuType } from "./constants.js";

// ── Vehicle ───────────────────────────────────────────────────────────────────

/** Empty strings from form inputs become undefined so optional fields validate cleanly. */
const optionalText = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().trim().min(1).optional(),
);

export const vehicleInputSchema = z
  .object({
    unit_number: z.string().trim().min(1, "Unit number is required").max(50),
    make: optionalText,
    model: optionalText,
    year: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.coerce.number().int().min(1900).max(2100).optional(),
    ),
    plate: optionalText,
    vin: optionalText,
    fuel_type: z.enum(FUEL_TYPES),
    tank_capacity_gal: z.coerce.number().nonnegative("Tank capacity must be ≥ 0"),
    baseline_mpg: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.coerce.number().positive().optional(),
    ),
    current_odometer: z.coerce.number().nonnegative().default(0),
    status: z.enum(VEHICLE_STATUSES).default("active"),
    assigned_driver_id: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.uuid().optional(),
    ),
    samsara_vehicle_id: optionalText, // maps this vehicle to its Samsara telematics id
    // Does the truck have an APU / optimized-idle option (auxiliary power unit, battery HVAC, shore power)?
    // MANUAL source of truth for the idle "avoidable" logic — telematics can't reliably detect an APU (it's a
    // separate engine off the J1939 bus), so an admin sets it. Tri-state: null = unknown/unset. Always present
    // (never omitted) so selecting "Unknown" explicitly clears the stored value.
    has_apu: z.preprocess(
      (v) => (v === "" || v == null ? null : v === "true" || v === true ? true : false),
      z.boolean().nullable().default(null),
    ),
    // Richer idle-reduction equipment (refines has_apu). Free text in DB, enum here. null = unknown/unset.
    apu_type: z.preprocess(
      (v) => (v === "" || v == null ? null : v),
      z.enum(APU_TYPES).nullable().default(null),
    ),
    // OEM optimized idle (e.g. Freightliner Cascadia): the engine auto start/stops for cab climate/battery.
    // DISTINCT from an APU — the engine cycling here is the OEM feature working, not driver waste. Tri-state:
    // null = unknown/unset. Kept separate so the idle score can treat it fairly (not as avoidable waste).
    has_optimized_idle: z.preprocess(
      (v) => (v === "" || v == null ? null : v === "true" || v === true ? true : false),
      z.boolean().nullable().default(null),
    ),
  })
  // Diesel/gasoline vehicles must have a positive tank capacity (the engine uses it for fill-up checks).
  // Baseline MPG is optional here — the VehiclesPage surfaces missing MPG as a "setup needed" warning.
  .refine((d) => !MPG_FUEL_TYPES.includes(d.fuel_type) || d.tank_capacity_gal > 0, {
    message: "Tank capacity must be greater than 0 for fuel vehicles",
    path: ["tank_capacity_gal"],
  });

export type VehicleInput = z.infer<typeof vehicleInputSchema>;

/**
 * Derive has_apu (ENGINE-OFF capable at rest) from the idle-reduction equipment type, so the two can never
 * contradict. Any real device (diesel APU / battery HVAC / fuel heater / shore power) -> true; "none" -> false;
 * null/undefined (unknown/unset) -> null. Single source that maps equipment -> the avoidable-idle flag.
 */
export function deriveHasApu(apuType: ApuType | null | undefined): boolean | null {
  if (apuType == null) return null;
  return apuType !== "none";
}

export interface Vehicle {
  id: string;
  org_id: string;
  unit_number: string;
  make: string | null;
  model: string | null;
  year: number | null;
  plate: string | null;
  vin: string | null;
  fuel_type: FuelType;
  tank_capacity_gal: number;
  baseline_mpg: number | null;
  current_odometer: number;
  status: VehicleStatus;
  assigned_driver_id: string | null;
  samsara_vehicle_id: string | null;
  samsara_fuel_percent: number | null;
  samsara_fuel_at: string | null;
  /** Manual source of truth: is the truck ENGINE-OFF capable at rest (real APU / battery HVAC / shore power)? null = unknown/unset. */
  has_apu?: boolean | null;
  /** Idle-reduction equipment detail (refines has_apu). null = unknown/unset. */
  apu_type?: ApuType | null;
  /** Manual source of truth: does the truck have OEM optimized idle (e.g. Freightliner Cascadia)? Distinct from has_apu. null = unknown/unset. */
  has_optimized_idle?: boolean | null;
  /** Learned from engine-state park sessions (cross-check vs has_apu). */
  idle_capability?: "apu" | "ecu_optimized" | "continuous_only" | "unknown" | null;
  /** Learned/overridden odometer calibration (dash − Samsara), applied before the mismatch check. */
  odometer_offset?: number;
  odometer_offset_source?: "auto" | "manual";
  created_at: string;
  updated_at: string;
}

// ── Trailer (reefer) ────────────────────────────────────────────────────────────

export const trailerInputSchema = z.object({
  unit_number: z.string().trim().min(1, "Unit number is required").max(50),
  make: optionalText,
  model: optionalText,
  year: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.coerce.number().int().min(1900).max(2100).optional(),
  ),
  plate: optionalText,
  /** Whether this trailer is a reefer (refrigerated). Only reefers drive the reefer fuel checks. */
  is_reefer: z.coerce.boolean().default(false),
  /** Reefer (refrigeration) tank capacity in gallons. Standard reefer tank ≈ 50 gal. */
  reefer_tank_capacity_gal: z.coerce.number().nonnegative().default(50),
  status: z.enum(VEHICLE_STATUSES).default("active"),
  /** Manual tractor pairing fallback when Samsara assignments aren't available. */
  assigned_vehicle_id: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.uuid().optional(),
  ),
  samsara_asset_id: optionalText,
});

export type TrailerInput = z.infer<typeof trailerInputSchema>;

export interface Trailer {
  id: string;
  org_id: string;
  unit_number: string;
  make: string | null;
  model: string | null;
  year: number | null;
  plate: string | null;
  is_reefer: boolean;
  reefer_tank_capacity_gal: number;
  status: VehicleStatus;
  assigned_vehicle_id: string | null;
  samsara_asset_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── Driver ────────────────────────────────────────────────────────────────────

export const driverInputSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(120),
  employee_id: optionalText,
  phone: optionalText,
  status: z.enum(DRIVER_STATUSES).default("active"),
  samsara_driver_id: optionalText, // maps this driver to its Samsara telematics id
});

export type DriverInput = z.infer<typeof driverInputSchema>;

export interface Driver {
  id: string;
  org_id: string;
  user_id: string | null;
  full_name: string;
  employee_id: string | null;
  phone: string | null;
  status: DriverStatus;
  samsara_driver_id: string | null;
  created_at: string;
  updated_at: string;
}
