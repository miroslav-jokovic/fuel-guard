import { z } from "zod";
import { FUEL_TYPES, VEHICLE_STATUSES, DRIVER_STATUSES, MPG_FUEL_TYPES } from "./constants.js";
import type { FuelType, VehicleStatus, DriverStatus } from "./constants.js";

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
  })
  // Diesel/gasoline vehicles must have a positive tank capacity (the engine uses it for fill-up checks).
  // Baseline MPG is optional here — the VehiclesPage surfaces missing MPG as a "setup needed" warning.
  .refine((d) => !MPG_FUEL_TYPES.includes(d.fuel_type) || d.tank_capacity_gal > 0, {
    message: "Tank capacity must be greater than 0 for fuel vehicles",
    path: ["tank_capacity_gal"],
  });

export type VehicleInput = z.infer<typeof vehicleInputSchema>;

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
