import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseSamsaraSamples,
  matchFuelingMoment,
  matchFuelingStop,
  odometerAtTimeSourced,
  type OdometerSource,
  minSampleDistanceMiles,
  resolveLocationConfidence,
  type LocationConfidence,
  parseFuelPercents,
  tankPercentNear,
  reconcileTankFill,
  findFuelingEvent,
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
  /**
   * Samsara odometer AT THE FUELING MOMENT (miles) → the ±tolerance reference. Only populated when the
   * reading is anchored to the physical fill (tank-rise event, an at-station in-city stop, or GPS-confirmed
   * proximity). When we can't confirm the fill moment we return null rather than a nearest-in-time stop's
   * odometer (the EFS clock is unreliable) — so a comparison is only made when it's truly at fueling time.
   */
  crossSourceOdometer: number | null;
  /** ISO time the odometer reading was taken (the physical-fill anchor). null when no trusted reading. */
  crossSourceOdometerAt: string | null;
  /** Where the odometer came from: 'obd' (ECU), 'gps' (Samsara GPS odometer), or 'reconstructed'
   *  (nearest reading + driven distance). null when no trusted reading. */
  crossSourceOdometerSource: OdometerSource | null;
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
  /** Tank level (%) just before the fill — for the physical tank-space check. null = not measurable. */
  tankPctBefore: number | null;
  /** Tank level (%) just after the fill (from the tank-rise event), for the audit view. */
  tankPctAfter: number | null;
  /** Where the truck actually was at the fueling stop (Samsara), for the audit view + evidence. */
  observedState: string | null;
  observedCity: string | null;
  observedAddress: string | null;
  observedLat: number | null;
  observedLng: number | null;
  /**
   * How the fueling INSTANT (matchedAt) was determined, strongest→weakest:
   *  tank_confirmed  – a fuel-% rise ≈ the billed gallons pinned the exact moment (report-time-independent)
   *  stop_estimated  – no usable rise → the in-state stop nearest the reported time
   *  reported        – no telematics stop → the EFS reported time as-is
   *  date_only       – EFS had no time and no rise → the noon sentinel
   */
  fuelingTimeBasis: "tank_confirmed" | "stop_estimated" | "reported" | "date_only";
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

  // Fetch the whole fueling DAY (±18h ≈ 36h) around the reported time. Timed EFS rows are now TRUE UTC
  // (station-local wall time converted at parse; ±1h worst case for split-timezone states), but we still
  // pull a wide window and ask a robust question — "was the truck in the EFS state anywhere that day?" —
  // rather than trusting a single minute. Date-only rows (noon sentinel) stay ±30h.
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
  const stationLat = stationCoords?.lat ?? null;
  const stationLng = stationCoords?.lng ?? null;
  // Only an EXACT (site-precision) geocode can confirm a fill, and only within a tight radius (~0.5 mi ≈
  // the truck was in the station's lot). A city-centroid geocode is too coarse to confirm, so we ignore
  // it for proximity and fall back to the state-presence check.
  const siteCoords = stationCoords?.precision === "site" ? stationCoords : null;
  const proximityMiles = siteCoords ? minSampleDistanceMiles(samples, siteCoords.lat, siteCoords.lng) : null;
  const proxThreshold = env.SITE_PROX_MILES;
  // Distance to the station's coordinates at ANY precision (site OR city centroid). Too coarse to CONFIRM
  // a fill, but if the truck came within a generous radius we use it to VETO a false location mismatch.
  const nearMiles = stationCoords ? minSampleDistanceMiles(samples, stationCoords.lat, stationCoords.lng) : null;
  const mismatchVeto = { nearMiles, minMismatchMiles: env.LOCATION_MISMATCH_MIN_MILES };

  // Tank-rise fueling event — the report-time-INDEPENDENT anchor. When present it pins the exact fueling
  // instant, the odometer at that instant, and the truck's observed location (docs/10 §14).
  const fuelReadings = parseFuelPercents(vehicleRaw);
  const fuelEvent = findFuelingEvent(samples, fuelReadings, {
    state: input.state,
    city: input.city,
    gallons: input.gallons,
    tankCapacityGal: input.tankCapacityGal,
    reportedAtIso: input.fueledAt,
  });
  /** Observed location: prefer the tank-rise stop; else the location-match stop's address; else nulls. */
  const observedFor = (stop: { observedState?: string | null; observedCity?: string | null; observedAddress?: string | null }) =>
    fuelEvent
      ? { observedState: fuelEvent.observedState, observedCity: fuelEvent.observedCity, observedAddress: fuelEvent.observedAddress, observedLat: fuelEvent.observedLat, observedLng: fuelEvent.observedLng }
      : { observedState: stop.observedState ?? null, observedCity: stop.observedCity ?? null, observedAddress: stop.observedAddress ?? null, observedLat: null, observedLng: null };
  /** How the fueling instant was determined (confidence ladder). */
  const basisFor = (hasStopTime: boolean): ReconResult["fuelingTimeBasis"] =>
    fuelEvent ? "tank_confirmed" : input.preciseTime ? (hasStopTime ? "stop_estimated" : "reported") : hasStopTime ? "stop_estimated" : "date_only";

  // ── Precise path: timezone-PROOF presence check over the whole day, corroborated by GPS proximity to
  // the geocoded station. Location matches when the truck came near the station OR was in the EFS state
  // that day; a mismatch is raised only when we have solid coverage and neither holds. ──
  if (input.preciseTime) {
    const stop = matchFuelingStop(samples, { state: input.state, city: input.city }, input.fueledAt, { stoppedMph: 5 });
    const { confidence, matched } = resolveLocationConfidence(stop, proximityMiles, proxThreshold, mismatchVeto);
    // Fueling INSTANT for time-of-day / interval rules: tank-rise event wins (report-time-independent); else
    // the nearest matched stop. (Unchanged — location/time recovery is separate from odometer trust.)
    const at = fuelEvent?.at ?? stop.matchedAt;
    // Odometer must be read at the PHYSICAL fill, not a nearest-in-time stop off the (unreliable) EFS clock.
    // Trust it only when anchored by the tank rise, an at-station (in-city) stop, or GPS-confirmed proximity.
    // Then read the odometer AT that anchor (OBD/GPS, or reconstructed from driven distance when no reading
    // is stamped near the moment). Otherwise leave it null — a wrong-time odometer made every truck mismatch.
    const odoReliable = fuelEvent != null || stop.basis === "in_city" || confidence === "gps_confirmed";
    const reading = at && odoReliable ? odometerAtTimeSourced(samples, at, { maxInterpGapMin: 30, maxReconstructGapMin: 180 }) : null;
    const odo = reading?.miles ?? null;
    const odoAt = reading ? at : null;
    const odoSource = reading?.source ?? null;
    const obs = observedFor(stop);
    const tank = computeTankFill(vehicleRaw, at ?? input.fueledAt, input.gallons, input.tankCapacityGal);
    return {
      crossSourceOdometer: odo,
      crossSourceOdometerAt: odoAt,
      crossSourceOdometerSource: odoSource,
      locationMatched: matched,
      locationConfidence: confidence,
      stationLat,
      stationLng,
      locationEvidence:
        confidence === "mismatch"
          ? {
              efsCity: input.city,
              efsState: input.state,
              samsaraState: obs.observedState,
              samsaraCity: obs.observedCity,
              samsaraAddress: obs.observedAddress,
              nearestMilesToStation: proximityMiles,
              note: `Samsara shows the truck was never in ${input.state ?? "the EFS state"} at any point across the fueling day${proximityMiles != null ? ` and came no closer than ${proximityMiles} mi to the station` : ""} — the card was used where the truck was not.`,
            }
          : null,
      matchedAt: at,
      tankFillShortGal: tank.shortGal,
      tankObservedRiseGal: tank.observedRiseGal,
      tankPctBefore: tank.pctBefore,
      tankPctAfter: fuelEvent?.pctAfter ?? tank.pctAfter,
      ...obs,
      fuelingTimeBasis: basisFor(at != null),
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
  // Odometer + instant: tank-rise event wins; else the stopped-in-city sample (both are physically at the
  // fill). Read the odometer AT that anchor (OBD/GPS or reconstructed). Date-only never flags a location
  // mismatch — it only confirms via proximity.
  const at = fuelEvent?.at ?? match?.matchedAt ?? null;
  const odoReliable = fuelEvent != null || match != null || nearStation;
  const reading = at && odoReliable ? odometerAtTimeSourced(samples, at, { maxInterpGapMin: 30, maxReconstructGapMin: 180 }) : null;
  const odo = reading?.miles ?? null;
  const odoAt = reading ? at : null;
  const odoSource = reading?.source ?? null;
  const obs = observedFor({});
  const tank = computeTankFill(vehicleRaw, at ?? input.fueledAt, input.gallons, input.tankCapacityGal);
  return {
    crossSourceOdometer: odo,
    crossSourceOdometerAt: odoAt,
    crossSourceOdometerSource: odoSource,
    locationMatched: nearStation ? true : null,
    locationConfidence: nearStation ? "gps_confirmed" : "unknown",
    stationLat,
    stationLng,
    locationEvidence: null,
    matchedAt: at,
    tankFillShortGal: tank.shortGal,
    tankObservedRiseGal: tank.observedRiseGal,
    tankPctBefore: tank.pctBefore,
    tankPctAfter: fuelEvent?.pctAfter ?? tank.pctAfter,
    ...obs,
    fuelingTimeBasis: basisFor(at != null),
  };
}

/**
 * Tank-fill reconciliation around the matched fueling moment: level just before the truck stopped vs
 * the highest reading in the few hours after (the post-fill plateau). Coarse sensor → advisory only.
 */
interface TankFillResult {
  /** Tank level (%) just before the fill — the reliable reading for the physical tank-space check. */
  pctBefore: number | null;
  /** Tank level (%) just after the fill (post-fill plateau peak). */
  pctAfter: number | null;
  shortGal: number | null;
  observedRiseGal: number | null;
}

function computeTankFill(
  vehicle: Parameters<typeof parseFuelPercents>[0],
  matchedAt: string,
  gallons: number | null,
  tankCapacityGal: number | null,
): TankFillResult {
  const readings = parseFuelPercents(vehicle);
  if (readings.length === 0) return { pctBefore: null, pctAfter: null, shortGal: null, observedRiseGal: null };

  const before = tankPercentNear(readings, matchedAt, "before", 120);
  const pctBefore = before?.percent ?? null;
  // Post-fill level = the peak reading within 3h after the stop (fueling takes time to register).
  const t = new Date(matchedAt).getTime();
  const afterReadings = readings.filter((r) => {
    const rt = new Date(r.time).getTime();
    return rt >= t && rt - t <= 3 * 3_600_000;
  });
  const pctAfter = afterReadings.length ? Math.max(...afterReadings.map((r) => r.percent)) : null;

  const recon = reconcileTankFill({ gallonsBilled: gallons, pctBefore, pctAfter, tankCapacityGal });
  return { pctBefore, pctAfter, shortGal: recon?.shortGal ?? null, observedRiseGal: recon?.observedRiseGal ?? null };
}
