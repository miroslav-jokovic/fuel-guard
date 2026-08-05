/**
 * WP5 + WP-CAP — tank-capacity setup health. Two data-quality gaps are surfaced here (Coverage page +
 * digest) instead of silently degrading detection:
 *  1. MISSING — `exceeds_tank_capacity` (weight 85, alert-alone) is SILENTLY DEAD for any fuel vehicle
 *     with no usable capacity source (entered 0/unset AND no sensor-measured capacity). The guard
 *     `cap > 0` simply never fires and nothing said so.
 *  2. DIVERGENT — the entered capacity disagrees with the sensor-MEASURED capacity by more than
 *     CAPACITY_DIVERGENCE_PCT. Detection keeps running on the sensor value (physics wins — no detection
 *     gap), but the entered record is wrong and should be fixed so the resolver can return to
 *     high-confidence tight tolerances. Pure.
 */
import { MPG_FUEL_TYPES } from "./constants.js";
import { CAPACITY_DIVERGENCE_PCT } from "./anomalyRules/capacityResolve.js";

export interface CapacityVehicleRow {
  id: string;
  unit_number: string;
  fuel_type: string;
  tank_capacity_gal: number | string | null;
  /** Sensor-measured capacity (vehicles.sensor_capacity_gal), when learned. */
  sensor_capacity_gal?: number | string | null;
  status?: string | null;
}

export interface CapacityDivergence {
  id: string;
  unit: string;
  enteredGal: number;
  sensorGal: number;
  /** |sensor − entered| / entered, percent (rounded to 1 decimal). */
  diffPct: number;
}

export interface CapacityHealth {
  /** Active fuel (diesel/gasoline) vehicles — the ones the capacity rules apply to. */
  fuelVehicles: number;
  /** Fuel vehicles with NO usable capacity source (entered unset/0 and nothing sensor-measured) —
   *  capacity + tank-space rules dead for them. */
  missing: { id: string; unit: string }[];
  /** Fuel vehicles whose entered capacity contradicts the sensor-measured capacity (> divergence
   *  threshold). Alerts run on the sensor value; the entered record needs fixing. */
  divergent: CapacityDivergence[];
  /** Share of fuel vehicles WITH a usable capacity, 0–100. */
  setPct: number;
}

export function computeCapacityHealth(vehicles: CapacityVehicleRow[]): CapacityHealth {
  const fuel = vehicles.filter(
    (v) =>
      (v.status ?? "active") !== "retired" &&
      (MPG_FUEL_TYPES as readonly string[]).includes(v.fuel_type),
  );
  // A sensor-measured capacity is a usable source (WP-CAP): a truck with entered 0 but a learned sensor
  // capacity is NOT missing — its capacity rules run off physics.
  const missing = fuel
    .filter((v) => !(Number(v.tank_capacity_gal) > 0) && !(Number(v.sensor_capacity_gal) > 0))
    .map((v) => ({ id: v.id, unit: v.unit_number }))
    .sort((a, b) => a.unit.localeCompare(b.unit));
  const divergent = fuel
    .filter((v) => Number(v.tank_capacity_gal) > 0 && Number(v.sensor_capacity_gal) > 0)
    .map((v) => {
      const entered = Number(v.tank_capacity_gal);
      const sensor = Number(v.sensor_capacity_gal);
      return {
        id: v.id,
        unit: v.unit_number,
        enteredGal: entered,
        sensorGal: sensor,
        diffPct: Math.round((Math.abs(sensor - entered) / entered) * 1000) / 10,
      };
    })
    .filter((d) => d.diffPct > CAPACITY_DIVERGENCE_PCT)
    .sort((a, b) => b.diffPct - a.diffPct || a.unit.localeCompare(b.unit));
  const withCap = fuel.length - missing.length;
  return {
    fuelVehicles: fuel.length,
    missing,
    divergent,
    setPct: fuel.length ? Math.round((withCap / fuel.length) * 1000) / 10 : 100,
  };
}
