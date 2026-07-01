import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseSamsaraSamples,
  matchFuelingMoment,
  sampleNearestTime,
  compareLocationState,
  stateFromAddress,
  cityFromAddress,
  parseFuelPercents,
  tankPercentNear,
  reconcileTankFill,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { makeSamsaraFetcher, type SamsaraFetcher } from "../lib/samsara.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";

export interface ReconInput {
  vehicleId: string | null;
  samsaraVehicleId: string | null;
  fueledAt: string; // fueling instant (exact when preciseTime, else EFS date anchored at noon)
  city: string | null;
  state: string | null;
  locationName: string | null;
  /** True when fueledAt carries a real time-of-day (timed EFS report / manual) vs date-only. */
  preciseTime: boolean;
  /** Billed gallons + tank capacity, for the advisory tank-fill check. */
  gallons: number | null;
  tankCapacityGal: number | null;
}

export interface ReconResult {
  /** Samsara odometer at the fueling moment (miles) → the ±5 reference. */
  crossSourceOdometer: number | null;
  /** Truck in the SAME state as the EFS station at the fueling time? false = mismatch, null = unknown. */
  locationMatched: boolean | null;
  /** Evidence behind a location decision (EFS vs Samsara city/state). */
  locationEvidence: Record<string, unknown> | null;
  /** Telematics-recovered fueling time (fixes EFS date-only) — null if unmatched. */
  matchedAt: string | null;
  /** Gallons billed minus observed tank rise (advisory). null = not measurable. */
  tankFillShortGal: number | null;
  /** Observed tank rise across the fueling moment, gallons. null = not measurable. */
  tankObservedRiseGal: number | null;
}

/**
 * Reconcile an EFS fuel transaction against Samsara (docs/10): pull the truck's GPS+odometer for the
 * day, find the stopped sample at the EFS station's city, and return the Samsara odometer (for the ±5
 * check), whether the truck was actually there, and the recovered fueling time. Best-effort: returns
 * null when Samsara isn't configured / mapped / reachable (the deterministic rules still run).
 */
export async function reconcileWithSamsara(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  input: ReconInput,
  fetcherOverride?: SamsaraFetcher,
): Promise<ReconResult | null> {
  if (!input.samsaraVehicleId) return null;
  const token = fetcherOverride ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) return null;

  // Day window around the EFS date (which is anchored at noon), with a buffer for tz/lag.
  const t = new Date(input.fueledAt).getTime();
  const start = new Date(t - 30 * 3_600_000).toISOString();
  const end = new Date(t + 30 * 3_600_000).toISOString();

  const fetcher = fetcherOverride ?? makeSamsaraFetcher(env, token);
  let raw: unknown;
  try {
    raw = await fetcher(input.samsaraVehicleId, start, end);
  } catch {
    return null;
  }
  const vehicle = (raw as { data?: unknown[] })?.data?.[0];
  if (!vehicle) return null;

  const samples = parseSamsaraSamples(vehicle as Parameters<typeof parseSamsaraSamples>[0]);
  const vehicleRaw = vehicle as Parameters<typeof parseFuelPercents>[0];

  // ── Precise path: exact fueling time → nearest GPS sample → state comparison + exact odometer ──
  if (input.preciseTime) {
    const s = sampleNearestTime(samples, input.fueledAt, 15);
    if (!s) {
      // No telematics near the fueling minute → can't verify anything (unknown, no flag).
      return { crossSourceOdometer: null, locationMatched: null, locationEvidence: null, matchedAt: null, tankFillShortGal: null, tankObservedRiseGal: null };
    }
    const matched = compareLocationState(input.state, s.address); // true / false / null
    const tank = computeTankFill(vehicleRaw, input.fueledAt, input.gallons, input.tankCapacityGal);
    return {
      crossSourceOdometer: s.odometerMiles,
      locationMatched: matched,
      locationEvidence:
        matched === false
          ? {
              efsCity: input.city,
              efsState: input.state,
              samsaraState: stateFromAddress(s.address),
              samsaraCity: cityFromAddress(s.address),
              samsaraAddress: s.address,
              atTime: s.time,
            }
          : null,
      matchedAt: s.time,
      tankFillShortGal: tank?.shortGal ?? null,
      tankObservedRiseGal: tank?.observedRiseGal ?? null,
    };
  }

  // ── Date-only fallback: no exact time, so location can't be verified (never flag). Recover the
  // odometer from the best stopped-in-city sample if we can; leave location UNKNOWN. ──
  const match = matchFuelingMoment(samples, {
    city: input.city,
    state: input.state,
    stationName: input.locationName,
  });
  if (!match) {
    return { crossSourceOdometer: null, locationMatched: null, locationEvidence: null, matchedAt: null, tankFillShortGal: null, tankObservedRiseGal: null };
  }
  const tank = computeTankFill(vehicleRaw, match.matchedAt, input.gallons, input.tankCapacityGal);
  return {
    crossSourceOdometer: match.samsaraOdometerMiles,
    locationMatched: null, // date-only: not confident enough to flag location
    locationEvidence: null,
    matchedAt: match.matchedAt,
    tankFillShortGal: tank?.shortGal ?? null,
    tankObservedRiseGal: tank?.observedRiseGal ?? null,
  };
}

/**
 * Tank-fill reconciliation around the matched fueling moment: level just before the truck stopped vs
 * the highest reading in the few hours after (the post-fill plateau). Coarse sensor → advisory only.
 */
function computeTankFill(
  vehicle: Parameters<typeof parseFuelPercents>[0],
  matchedAt: string,
  gallons: number | null,
  tankCapacityGal: number | null,
) {
  const readings = parseFuelPercents(vehicle);
  if (readings.length === 0) return null;

  const before = tankPercentNear(readings, matchedAt, "before", 120);
  // Post-fill level = the peak reading within 3h after the stop (fueling takes time to register).
  const t = new Date(matchedAt).getTime();
  const afterReadings = readings.filter((r) => {
    const rt = new Date(r.time).getTime();
    return rt >= t && rt - t <= 3 * 3_600_000;
  });
  const pctAfter = afterReadings.length ? Math.max(...afterReadings.map((r) => r.percent)) : null;

  return reconcileTankFill({
    gallonsBilled: gallons,
    pctBefore: before?.percent ?? null,
    pctAfter,
    tankCapacityGal,
  });
}
