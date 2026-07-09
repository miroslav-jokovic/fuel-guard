import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseSamsaraSamples,
  type OdometerSource,
  minSampleDistanceMiles,
  type LocationConfidence,
  parseFuelPercents,
  findFuelingEvent,
  resolveTankFuel,
  resolveOdometer,
  resolveLocation,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { makeSamsaraFetcher, type SamsaraFetcher } from "../lib/samsara.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { geocodeStation, type Coords } from "./geocode.js";

/** Injectable geocoder so tests can run without a network provider. */
export type StationGeocoder = (station: { name: string | null; city: string | null; state: string | null }) => Promise<Coords | null>;

/**
 * Raised when the Samsara telematics FETCH itself failed (network / 4xx / 5xx after retries) — as opposed
 * to a truck simply having no coverage (which returns null). Callers use this to tell a systemic outage
 * (bad token / missing scope / invalid parameter) apart from "no data", so a bulk re-sync can abort loudly
 * instead of silently marking every fill blind (the class of bug that produced 0% telematics coverage).
 */
export class SamsaraUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(cause instanceof Error ? `Samsara fetch failed: ${cause.message}` : "Samsara fetch failed", { cause });
    this.name = "SamsaraUnavailableError";
  }
}

/** Extra reconcile inputs used by bulk backfill: a hoisted org token and a pre-fetched (per-vehicle) raw
 *  stats response so many fills of one truck reuse a SINGLE Samsara fetch. */
export interface ReconExtra {
  /** Org Samsara token loaded once by the caller, to avoid a per-fill token lookup. `null` = not configured. */
  token?: string | null;
  /** Raw stats response already fetched over a window that COVERS this fill's window. When set, reconcile
   *  skips its own fetch and slices these samples to this fill's window (see sliceVehicleToWindow). */
  prefetchedRaw?: unknown;
  /** Bulk backfill: use only CACHED geocodes, never the live 1-req/sec Nominatim call (which serializes all
   *  concurrent workers). Recon falls back to state-level matching for uncached stations. */
  geocodeCacheOnly?: boolean;
}

/** Slice a raw vehicle stats object's gps + fuelPercents arrays to [startMs, endMs]. Used when samples were
 *  pre-fetched over a WIDER per-vehicle window: the matching functions reason over the whole array (state
 *  presence, best tank-rise), so we must reduce to exactly this fill's window to reproduce a per-fill fetch. */
function sliceVehicleToWindow(vehicle: unknown, startMs: number, endMs: number): unknown {
  const v = vehicle as { gps?: { time?: string }[]; fuelPercents?: { time?: string }[]; [k: string]: unknown };
  const inWin = (t?: string) => {
    if (!t) return false;
    const ms = Date.parse(t);
    return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
  };
  return { ...v, gps: (v.gps ?? []).filter((p) => inWin(p.time)), fuelPercents: (v.fuelPercents ?? []).filter((p) => inWin(p.time)) };
}

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
  extra?: ReconExtra,
): Promise<ReconResult | null> {
  if (!input.samsaraVehicleId) return null;
  const usingPrefetch = extra?.prefetchedRaw !== undefined;

  // This fill's fetch/slice window: the whole fueling DAY (±18h ≈ 36h, or ±30h for date-only rows) around
  // the reported time. We ask a robust "was the truck in the EFS state anywhere that day?" rather than
  // trusting a single (often wrong) EFS minute.
  const center = new Date(input.fueledAt).getTime();
  const winMs = (input.preciseTime ? 18 : 30) * 3_600_000;
  const startMs = center - winMs;
  const endMs = center + winMs;
  const start = new Date(startMs).toISOString();
  const end = new Date(endMs).toISOString();

  let raw: unknown;
  if (usingPrefetch) {
    // Backfill already fetched this vehicle's window once; reuse it (no per-fill Samsara call).
    raw = extra!.prefetchedRaw;
  } else {
    // Prefer a caller-hoisted token (bulk runs load it once); else look it up. fetcherOverride = tests.
    const token = fetcherOverride ? "test" : extra?.token !== undefined ? extra.token : await loadSamsaraToken(admin, env, orgId);
    if (!token) return null;
    const fetcher = fetcherOverride ?? makeSamsaraFetcher(env, token);
    try {
      raw = await fetcher(input.samsaraVehicleId, start, end);
    } catch (e) {
      // A FETCH failure (network / 4xx / 5xx after retries) is NOT the same as "no telematics data".
      // Throw a typed error so the caller can distinguish a systemic Samsara outage (bad token/scope/param —
      // e.g. the gpsOdometerMeters decoration bug) from a truck that simply has no coverage, and abort a
      // bulk re-sync loudly instead of silently stamping thousands of rows as "blind".
      throw new SamsaraUnavailableError(e);
    }
  }
  const vehicleFull = (raw as { data?: unknown[] })?.data?.[0];
  if (!vehicleFull) return null;

  // Pre-fetched samples span a WIDER per-vehicle window; slice back to THIS fill's window so the matching
  // functions (state presence, best tank-rise) see exactly what a per-fill fetch would — behavior-identical.
  const vehicle = usingPrefetch ? sliceVehicleToWindow(vehicleFull, startMs, endMs) : vehicleFull;

  const samples = parseSamsaraSamples(vehicle as Parameters<typeof parseSamsaraSamples>[0]);
  const vehicleRaw = vehicle as Parameters<typeof parseFuelPercents>[0];

  // Geocode the station once (cached) and measure how close the truck's GPS came to it that day — the
  // most precise location signal. Best-effort: null when geocoding is off/unresolvable, and we fall
  // back to the state-level presence check.
  const geocode: StationGeocoder = geocodeOverride ?? ((s) => geocodeStation(admin, env, s, { cacheOnly: extra?.geocodeCacheOnly }));
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
  /** How the fueling instant was determined (confidence ladder). */
  const basisFor = (hasStopTime: boolean): ReconResult["fuelingTimeBasis"] =>
    fuelEvent ? "tank_confirmed" : input.preciseTime ? (hasStopTime ? "stop_estimated" : "reported") : hasStopTime ? "stop_estimated" : "date_only";

  // ── S2: location decision (precise + date-only, unified in one module). The tank-rise event's observed
  // position takes precedence for the reported location + mismatch evidence. ──
  const anchorObserved = fuelEvent
    ? { observedState: fuelEvent.observedState, observedCity: fuelEvent.observedCity, observedAddress: fuelEvent.observedAddress, observedLat: fuelEvent.observedLat, observedLng: fuelEvent.observedLng }
    : null;
  const loc = resolveLocation({
    samples,
    preciseTime: input.preciseTime,
    efs: { state: input.state, city: input.city, locationName: input.locationName },
    fueledAt: input.fueledAt,
    proximityMiles,
    nearMiles,
    proxThresholdMiles: proxThreshold,
    minMismatchMiles: env.LOCATION_MISMATCH_MIN_MILES,
    anchorObserved,
  });

  // ── S1: the fill anchor. The tank-rise instant (report-time-independent) wins; else the matched stop. ──
  const at = fuelEvent?.at ?? loc.stopMatchedAt;

  // ── S3: odometer at the anchor. Trust gate kept identical to the prior per-branch logic (PM decision a):
  // read the odometer only when anchored by a tank rise, an at-station in-city stop, or GPS-confirmed
  // proximity (precise) / any matched stop or proximity (date-only). ──
  const trusted = input.preciseTime
    ? fuelEvent != null || loc.stopBasis === "in_city" || loc.confidence === "gps_confirmed"
    : fuelEvent != null || loc.stopMatchedAt != null || loc.nearStation;
  const reading = resolveOdometer(samples, at, trusted);

  // ── S4: tank & fuel level at the anchor. The tank-space check needs the level at the TRUE fill moment,
  // so pctBefore is gated on the same trusted physical anchor as the odometer (a tank rise, an in-city
  // stop, or GPS-confirmed proximity). We pass the real anchor `at` (NOT a noon/date-only fallback) so an
  // unanchored fill yields no before-level and can't false-fire tank_space_exceeded. ──
  const tank = resolveTankFuel(fuelReadings, at, input.gallons, input.tankCapacityGal, fuelEvent?.pctAfter ?? null, trusted);

  return {
    crossSourceOdometer: reading?.miles ?? null,
    crossSourceOdometerAt: reading?.at ?? null,
    crossSourceOdometerSource: reading?.source ?? null,
    locationMatched: loc.matched,
    locationConfidence: loc.confidence,
    stationLat,
    stationLng,
    locationEvidence: loc.evidence,
    matchedAt: at,
    tankFillShortGal: tank.shortGal,
    tankObservedRiseGal: tank.observedRiseGal,
    tankPctBefore: tank.pctBefore,
    tankPctAfter: tank.pctAfter,
    observedState: loc.observedState,
    observedCity: loc.observedCity,
    observedAddress: loc.observedAddress,
    observedLat: loc.observedLat,
    observedLng: loc.observedLng,
    fuelingTimeBasis: basisFor(at != null),
  };
}

