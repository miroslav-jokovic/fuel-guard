import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseSamsaraSamples,
  matchFuelingMoment,
  matchFuelingStop,
  minSampleDistanceMiles,
  resolveLocationConfidence,
  type LocationConfidence,
  parseFuelPercents,
  tankPercentNear,
  reconcileTankFill,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { makeSamsaraFetcher, type SamsaraFetcher } from "../lib/samsara.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { geocodeStation, type Coords } from "./geocode.js";

/** Injectable geocoder so tests can run without a network provider. */
export type StationGeocoder = (station: { name: string | null; city: string | null; state: string | null }) => Promise<Coords | null>;

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
  /** Confidence tier: gps_confirmed | in_state | mismatch | unknown. */
  locationConfidence: LocationConfidence | null;
  /** Geocoded station coordinates we measured proximity against (null if not geocoded). */
  stationLat: number | null;
  stationLng: number | null;
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
  geocodeOverride?: StationGeocoder,
): Promise<ReconResult | null> {
  if (!input.samsaraVehicleId) return null;
  const token = fetcherOverride ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) return null;

  // Fetch the whole fueling DAY (±18h ≈ 36h) around the reported time. We no longer trust the report's
  // time-of-day/timezone, so we pull a wide window and ask a robust question — "was the truck in the EFS
  // state anywhere that day?" — rather than trusting a narrow guessed minute. Date-only stays ±30h.
  const center = new Date(input.fueledAt).getTime();
  const winMs = (input.preciseTime ? 18 : 30) * 3_600_000;
  const start = new Date(center - winMs).toISOString();
  const end = new Date(center + winMs).toISOString();

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

  // Geocode the station once (cached) and measure how close the truck's GPS came to it that day — the
  // most precise location signal. Best-effort: null when geocoding is off/unresolvable, and we fall
  // back to the state-level presence check.
  const geocode: StationGeocoder = geocodeOverride ?? ((s) => geocodeStation(admin, env, s));
  const stationCoords = await geocode({ name: input.locationName, city: input.city, state: input.state }).catch(() => null);
  const proximityMiles = stationCoords ? minSampleDistanceMiles(samples, stationCoords.lat, stationCoords.lng) : null;
  const proxThreshold = env.GEOCODE_PROX_MILES;
  const stationLat = stationCoords?.lat ?? null;
  const stationLng = stationCoords?.lng ?? null;

  // ── Precise path: timezone-PROOF presence check over the whole day, corroborated by GPS proximity to
  // the geocoded station. Location matches when the truck came near the station OR was in the EFS state
  // that day; a mismatch is raised only when we have solid coverage and neither holds. ──
  if (input.preciseTime) {
    const stop = matchFuelingStop(samples, { state: input.state, city: input.city }, input.fueledAt, { stoppedMph: 5 });
    const { confidence, matched } = resolveLocationConfidence(stop, proximityMiles, proxThreshold);
    if (stop.odometerMiles == null && matched == null) {
      // No usable GPS coverage that day → can't verify anything (unknown, no flag).
      return { crossSourceOdometer: null, locationMatched: null, locationConfidence: "unknown", stationLat, stationLng, locationEvidence: null, matchedAt: null, tankFillShortGal: null, tankObservedRiseGal: null };
    }
    const at = stop.matchedAt ?? input.fueledAt;
    const tank = computeTankFill(vehicleRaw, at, input.gallons, input.tankCapacityGal);
    return {
      crossSourceOdometer: stop.odometerMiles,
      locationMatched: matched,
      locationConfidence: confidence,
      stationLat,
      stationLng,
      locationEvidence:
        confidence === "mismatch"
          ? {
              efsCity: input.city,
              efsState: input.state,
              samsaraState: stop.observedState,
              samsaraCity: stop.observedCity,
              samsaraAddress: stop.observedAddress,
              nearestMilesToStation: proximityMiles,
              note: `Samsara shows the truck was never in ${input.state ?? "the EFS state"} at any point across the fueling day${proximityMiles != null ? ` and came no closer than ${proximityMiles} mi to the station` : ""} — the card was used where the truck was not.`,
            }
          : null,
      matchedAt: stop.matchedAt,
      tankFillShortGal: tank?.shortGal ?? null,
      tankObservedRiseGal: tank?.observedRiseGal ?? null,
    };
  }

  // ── Date-only fallback: no exact time. We never raise a location mismatch, but GPS proximity can still
  // positively CONFIRM the fill (verified). Recover the odometer from the best stopped-in-city sample. ──
  const nearStation = proximityMiles != null && proximityMiles <= proxThreshold;
  const match = matchFuelingMoment(samples, {
    city: input.city,
    state: input.state,
    stationName: input.locationName,
  });
  if (!match) {
    return {
      crossSourceOdometer: null,
      locationMatched: nearStation ? true : null,
      locationConfidence: nearStation ? "gps_confirmed" : "unknown",
      stationLat,
      stationLng,
      locationEvidence: null,
      matchedAt: null,
      tankFillShortGal: null,
      tankObservedRiseGal: null,
    };
  }
  const tank = computeTankFill(vehicleRaw, match.matchedAt, input.gallons, input.tankCapacityGal);
  return {
    crossSourceOdometer: match.samsaraOdometerMiles,
    locationMatched: nearStation ? true : null, // date-only: confirm only via proximity, never flag
    locationConfidence: nearStation ? "gps_confirmed" : "unknown",
    stationLat,
    stationLng,
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
