import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseSamsaraSamples,
  matchFuelingMoment,
  parseFuelPercents,
  tankPercentNear,
  reconcileTankFill,
} from "@fleetguard/shared";
import type { Env } from "../env.js";
import { makeSamsaraFetcher, type SamsaraFetcher } from "../lib/samsara.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";

export interface ReconInput {
  vehicleId: string | null;
  samsaraVehicleId: string | null;
  fueledAt: string; // EFS date-anchored instant
  city: string | null;
  state: string | null;
  locationName: string | null;
  /** Billed gallons + tank capacity, for the advisory tank-fill check. */
  gallons: number | null;
  tankCapacityGal: number | null;
}

export interface ReconResult {
  /** Samsara odometer at the fueling moment (miles) → the ±5 reference. */
  crossSourceOdometer: number | null;
  /** Was the truck actually in the EFS city when the card was used? null = couldn't determine. */
  locationMatched: boolean | null;
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
  const match = matchFuelingMoment(samples, {
    city: input.city,
    state: input.state,
    stationName: input.locationName,
  });

  // No match means Samsara never placed the truck in the EFS city that day → location mismatch.
  if (!match) {
    return {
      crossSourceOdometer: null,
      locationMatched: false,
      matchedAt: null,
      tankFillShortGal: null,
      tankObservedRiseGal: null,
    };
  }

  // Advisory tank-fill check: tank level just before the stop vs the post-fill peak shortly after.
  const tank = computeTankFill(
    vehicle as Parameters<typeof parseFuelPercents>[0],
    match.matchedAt,
    input.gallons,
    input.tankCapacityGal,
  );

  return {
    crossSourceOdometer: match.samsaraOdometerMiles,
    locationMatched: true,
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
