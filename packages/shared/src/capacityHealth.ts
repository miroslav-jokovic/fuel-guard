/**
 * WP5 — tank-capacity setup health. `exceeds_tank_capacity` (weight 85, alert-alone) is SILENTLY DEAD
 * for any fuel vehicle whose tank_capacity_gal is unset/0 — the guard `cap > 0` simply never fires and
 * nothing said so. This surfaces the gap as a data-quality item (Coverage page + digest) instead of
 * letting "no alerts" masquerade as "nothing wrong". Pure.
 */
import { MPG_FUEL_TYPES } from "./constants.js";

export interface CapacityVehicleRow {
  id: string;
  unit_number: string;
  fuel_type: string;
  tank_capacity_gal: number | string | null;
  status?: string | null;
}

export interface CapacityHealth {
  /** Active fuel (diesel/gasoline) vehicles — the ones the capacity rules apply to. */
  fuelVehicles: number;
  /** Fuel vehicles with no usable capacity (null/0) — capacity + tank-space rules dead for them. */
  missing: { id: string; unit: string }[];
  /** Share of fuel vehicles WITH a usable capacity, 0–100. */
  setPct: number;
}

export function computeCapacityHealth(vehicles: CapacityVehicleRow[]): CapacityHealth {
  const fuel = vehicles.filter(
    (v) => (v.status ?? "active") !== "retired" && (MPG_FUEL_TYPES as readonly string[]).includes(v.fuel_type),
  );
  const missing = fuel
    .filter((v) => !(Number(v.tank_capacity_gal) > 0))
    .map((v) => ({ id: v.id, unit: v.unit_number }))
    .sort((a, b) => a.unit.localeCompare(b.unit));
  const withCap = fuel.length - missing.length;
  return { fuelVehicles: fuel.length, missing, setPct: fuel.length ? Math.round((withCap / fuel.length) * 1000) / 10 : 100 };
}
