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
  /** Provenance of tank_capacity_gal: 'manual' = human-entered, 'auto' = self-healed from the
   *  sensor-measured capacity (WP-CAP decideCapacityAutoFix; every correction audit-logged). */
  tank_capacity_source?: "auto" | "manual" | null;
  /** CARGO tank capacity for straight trucks/bobtails (H-C2) — distinct from tank_capacity_gal (FUEL). */
  cargo_capacity_gal?: number | null;
  cargo_compartments?: Array<{ index: number; capacityGal: number }> | null;
  created_at: string;
  updated_at: string;
}

// ── Trailer (reefer) ────────────────────────────────────────────────────────────

/**
 * Trailer equipment type (migration `0100`, surfaced by D-H4).
 *
 * The column and its `'tanker'` value have existed since 0100 and were dead in the application — no
 * TypeScript declared it, no query selected it, no form set it. That absence is why the hazmat engine
 * had to assume a cargo tank: there was no way to ask what the trailer actually was.
 */
export const TRAILER_TYPES = ["dry_van", "reefer", "flatbed", "tanker", "hopper", "other"] as const;
export type TrailerType = (typeof TRAILER_TYPES)[number];

export const TRAILER_TYPE_LABELS: Record<TrailerType, string> = {
  dry_van: "Dry van",
  reefer: "Reefer",
  flatbed: "Flatbed",
  tanker: "Tanker",
  hopper: "Hopper",
  other: "Other",
};

/** The two carrier contexts the hazmat engine distinguishes (§171.8 bulk vs non-bulk). */
export type HaulVehicleKind = "cargo_tank" | "van_or_flatbed";

export interface VehicleKindResolution {
  kind: HaulVehicleKind;
  /** False when the answer is a fallback rather than a fact — the caller must say so out loud. */
  confident: boolean;
  because: string;
  /**
   * What a fresh product line on this equipment should default its packaging to (H-P1). Distinct
   * from `kind` because a HOPPER is `van_or_flatbed` for the engine's tank-specific rules (tank
   * state, §172.542/544 wording, the N/X endorsement) yet IS bulk packaging under §171.8 — its
   * lines must default bulk or the 1,001-lb Table 2 threshold gets applied to a bulk load, which
   * under-placards. Editable per line; this is only the starting answer.
   */
  defaultLinePackaging: "bulk" | "non_bulk";
}

/**
 * What kind of carrier is this equipment, for placarding purposes.
 *
 * WHY THE UNKNOWN CASE ANSWERS `cargo_tank`. The two mistakes are not symmetric. Calling a van a tank
 * is over-restrictive — every line becomes bulk, ID panels are demanded, DANGEROUS is withheld, and the
 * driver needs an N/X endorsement — which blocks a load that should have cleared. Calling a tank a van
 * applies the 1,001 lb Table 2 threshold to bulk packaging, which can UNDER-placard. Under-placarding
 * is the failure this engine exists to prevent (D2), so the unknown case takes the restrictive answer.
 *
 * The difference from the hard-code it replaces is not the value; it is that this one is flagged and
 * fixable. Set the trailer's type and the assumption goes away.
 */
export function resolveVehicleKind(input: {
  trailerType?: string | null;
  /** Cargo-tank data (capacity/compartments) only ever exists for tank equipment — evidence. */
  hasCargoTankProfile?: boolean;
}): VehicleKindResolution {
  const type = input.trailerType?.trim().toLowerCase();
  if (type === "tanker") {
    return {
      kind: "cargo_tank",
      confident: true,
      because: "the trailer is marked as a tanker",
      defaultLinePackaging: "bulk",
    };
  }
  if (type === "hopper") {
    // A hopper is NOT a cargo tank (no tank state, no §172.542 wording, no N/X endorsement), but it
    // IS bulk packaging under §171.8 (>882 lb solids capacity) — lines default bulk so the Table 2
    // 1,001-lb exception is never applied to a bulk load (H-P1; the old mapping under-classified).
    return {
      kind: "van_or_flatbed",
      confident: true,
      because: "the trailer is marked as a hopper — bulk packaging (§171.8), not a cargo tank",
      defaultLinePackaging: "bulk",
    };
  }
  if (type && (TRAILER_TYPES as readonly string[]).includes(type)) {
    return {
      kind: "van_or_flatbed",
      confident: true,
      because: `the trailer is marked as ${TRAILER_TYPE_LABELS[type as TrailerType].toLowerCase()}`,
      defaultLinePackaging: "non_bulk",
    };
  }
  if (input.hasCargoTankProfile) {
    return {
      kind: "cargo_tank",
      confident: true,
      because: "this equipment has cargo-tank capacity on file",
      defaultLinePackaging: "bulk",
    };
  }
  return {
    kind: "cargo_tank",
    confident: false,
    because: "the equipment type is not set — assuming a cargo tank, the conservative reading",
    defaultLinePackaging: "bulk",
  };
}

export const trailerInputSchema = z.object({
  unit_number: z.string().trim().min(1, "Unit number is required").max(50),
  make: optionalText,
  model: optionalText,
  year: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.coerce.number().int().min(1900).max(2100).optional(),
  ),
  plate: optionalText,
  /** Equipment type (0100). Drives the hazmat carrier context — `tanker` means bulk. */
  trailer_type: z.enum(TRAILER_TYPES).nullish(),
  /**
   * Cargo-tank capacity + compartment plan (H-C2 / D-H3): moved here from the dropped
   * `hazmat_cargo_tank_profiles` table — a tank is a trailer, not a parallel entity. CARGO capacity;
   * `reefer_tank_capacity_gal` below is the reefer's FUEL tank and is unrelated.
   */
  cargo_capacity_gal: z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.coerce.number().nonnegative().nullable().default(null),
  ),
  cargo_compartments: z
    .array(z.object({ index: z.number().int(), capacityGal: z.number().nonnegative() }))
    .default([]),
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
  trailer_type: TrailerType | null;
  /** Cargo-tank capacity in gallons (H-C2) — null = unknown → engine conservative path. */
  cargo_capacity_gal: number | null;
  /** Cargo-tank compartment plan [{index, capacityGal}] (H-C2). Empty = single tank / not a tank. */
  cargo_compartments: Array<{ index: number; capacityGal: number }>;
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
  samsara_username: string | null; // Samsara alpha login (e.g. "aaron"), shown as Driver ID
  current_hos_status: string | null; // live HOS duty status (Samsara clocks)
  current_hos_vehicle: string | null; // current truck unit
  current_hos_at: string | null;
  current_location: string | null; // current "City, ST" from the truck's GPS snapshot (0112)
  app_username: string | null; // company-issued driver-app login (0116; password lives in Supabase Auth)
  app_access_enabled: boolean | null; // active/disabled flag for the app login (0098)
  created_at: string;
  updated_at: string;
}
