/**
 * Samsara `/fleet/vehicles/stats/history` pages → the classifier's inputs, per Samsara vehicle id
 * (IE2). Pure and defensive: a sample with no parseable time or value is dropped, never zeroed.
 */

import type { CounterReading } from "./counters.js";
import type { EngineFlip, MotionFix } from "./timeline.js";

type Raw = { id?: string | number; [k: string]: unknown };

function byVehicle<T>(data: unknown[] | undefined, key: string, read: (x: Record<string, unknown>) => T | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const v of (data ?? []) as Raw[]) {
    if (v?.id == null) continue;
    const id = String(v.id);
    const list = out.get(id) ?? [];
    for (const x of (Array.isArray(v[key]) ? v[key] : []) as Record<string, unknown>[]) {
      const r = x && typeof x === "object" ? read(x) : null;
      if (r) list.push(r);
    }
    out.set(id, list);
  }
  return out;
}

const timeOf = (x: Record<string, unknown>) => (typeof x.time === "string" ? Date.parse(x.time) : NaN);

/** `engineStates`: Off → off; On and Idle → running (Samsara's On/Idle split is its motion call). */
export function parseEngineFlips(data: unknown[] | undefined): Map<string, EngineFlip[]> {
  return byVehicle(data, "engineStates", (x) => {
    const t = timeOf(x);
    if (!Number.isFinite(t) || (x.value !== "Off" && x.value !== "On" && x.value !== "Idle")) return null;
    return { t, on: x.value !== "Off" };
  });
}

/** `gps`: speed is required (it is the motion signal); position and place when present. */
export function parseMotionFixes(data: unknown[] | undefined): Map<string, MotionFix[]> {
  return byVehicle(data, "gps", (x) => {
    const t = timeOf(x);
    const mph = x.speedMilesPerHour;
    if (!Number.isFinite(t) || typeof mph !== "number" || !Number.isFinite(mph)) return null;
    const lat = x.latitude;
    const lng = x.longitude;
    const geo = x.reverseGeo as { formattedLocation?: unknown } | undefined;
    return {
      t,
      mph,
      ...(typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}),
      place: typeof geo?.formattedLocation === "string" ? geo.formattedLocation : null,
    };
  });
}

/** A numeric stat series (`fuelConsumedMilliliters`, `obdEngineSeconds`, `ambientAirTemperatureMilliC`). */
export function parseCounter(data: unknown[] | undefined, stat: string): Map<string, CounterReading[]> {
  return byVehicle(data, stat, (x) => {
    const t = timeOf(x);
    const value = x.value;
    if (!Number.isFinite(t) || typeof value !== "number" || !Number.isFinite(value)) return null;
    return { t, value };
  });
}
