/**
 * Idle fuel-burn model (CP3). Samsara measures fuel on SOME idle events; for the rest we must estimate gallons.
 * A flat rate is crude — US DOE puts main-engine idle at 0.6-1.5 gal/hr, driven mostly by A/C / accessory load.
 * So we (a) learn each truck's own rate from its MEASURED events, (b) fall back to a fleet rate, then a default,
 * and (c) nudge the estimate up in extreme weather (cab heat/cool running). Pure + testable.
 */

const MIN_RATE = 0.4; // below this is implausible for a Class-8 main engine at idle
const MAX_RATE = 2.0; // above this too — clamp learned/adjusted rates into the DOE-plausible band
const DEFAULT_RATE = 0.8;

export interface IdleBurnSample {
  vehicleId: string | null;
  durationSec: number;
  /** Measured fuel for the event (null = not measured; ignored for learning). */
  fuelGal: number | null;
}

export interface LearnedBurn {
  /** Per-vehicle gal/hr, only for trucks with enough measured evidence. */
  perVehicle: Record<string, number>;
  /** Fleet-wide gal/hr from all measured events, or null when there are none. */
  fleet: number | null;
}

const clampRate = (r: number) => Math.min(MAX_RATE, Math.max(MIN_RATE, r));

/** Learn idle gal/hr from MEASURED events: per truck (needs enough events + hours to be stable) + a fleet rate.
 *  Rate = total measured gallons / total idle hours, clamped to the plausible band. */
export function learnIdleBurn(
  samples: IdleBurnSample[],
  opts: { minEventsPerVehicle?: number; minHoursPerVehicle?: number } = {},
): LearnedBurn {
  const minEvents = opts.minEventsPerVehicle ?? 3;
  const minHours = opts.minHoursPerVehicle ?? 2;
  const byVeh = new Map<string, { gal: number; hours: number; n: number }>();
  let fleetGal = 0;
  let fleetHours = 0;
  for (const s of samples) {
    if (s.fuelGal == null || !(s.fuelGal >= 0) || !(s.durationSec > 0)) continue;
    const hours = s.durationSec / 3600;
    fleetGal += s.fuelGal;
    fleetHours += hours;
    if (s.vehicleId != null) {
      const cur = byVeh.get(s.vehicleId) ?? { gal: 0, hours: 0, n: 0 };
      cur.gal += s.fuelGal;
      cur.hours += hours;
      cur.n += 1;
      byVeh.set(s.vehicleId, cur);
    }
  }
  const perVehicle: Record<string, number> = {};
  for (const [id, v] of byVeh) {
    if (v.n >= minEvents && v.hours >= minHours) {
      perVehicle[id] = Math.round(clampRate(v.gal / v.hours) * 100) / 100;
    }
  }
  const fleet = fleetHours > 0 ? Math.round(clampRate(fleetGal / fleetHours) * 100) / 100 : null;
  return { perVehicle, fleet };
}

export interface IdleGalInput {
  vehicleId: string | null;
  durationSec: number;
  fuelGal: number | null;
  airTempF: number | null;
}
export interface IdleBurnConfig {
  learned: LearnedBurn;
  defaultGalPerHour?: number;
  climateLowF?: number;
  climateHighF?: number;
  /** Multiplier applied to the estimated rate in extreme weather (A/C or heat load). */
  extremeMultiplier?: number;
}
export type IdleGalSource = "measured" | "per_truck" | "fleet" | "default";

/** Resolve gallons for one idle event: measured when present, else the best learned rate, temperature-adjusted. */
export function estimateIdleGallons(
  e: IdleGalInput,
  cfg: IdleBurnConfig,
): { gallons: number; ratePerHour: number | null; source: IdleGalSource } {
  if (e.fuelGal != null) return { gallons: e.fuelGal, ratePerHour: null, source: "measured" };
  let rate = cfg.defaultGalPerHour ?? DEFAULT_RATE;
  let source: IdleGalSource = "default";
  if (e.vehicleId != null && cfg.learned.perVehicle[e.vehicleId] != null) {
    rate = cfg.learned.perVehicle[e.vehicleId]!;
    source = "per_truck";
  } else if (cfg.learned.fleet != null) {
    rate = cfg.learned.fleet;
    source = "fleet";
  }
  const low = cfg.climateLowF ?? 20;
  const high = cfg.climateHighF ?? 85;
  const extreme = e.airTempF != null && (e.airTempF < low || e.airTempF > high);
  const eff = clampRate(rate * (extreme ? (cfg.extremeMultiplier ?? 1.4) : 1));
  const gallons = Math.round((e.durationSec / 3600) * eff * 1000) / 1000;
  return { gallons, ratePerHour: Math.round(eff * 100) / 100, source };
}
