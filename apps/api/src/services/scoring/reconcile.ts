/** Samsara reconciliation for one transaction — the fueling-time odometer truth, recovered fueling time,
 * tank-rise volume signals and the location check. Extracted verbatim from scoreTransaction's core pass so
 * the orchestrator stays under the file-size budget; behavior is unchanged. */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isSystematicStationOffset,
  LOCATION_DISTANCE_MISMATCH_MILES,
  type TxnView,
  type VehicleView,
} from "@fuelguard/shared";
import type { Env } from "../../env.js";
import { reconcileWithSamsara, SamsaraUnavailableError } from "../samsaraRecon.js";
import { n } from "./loaders.js";
import type { FtxnRow, ScoreOpts } from "./loaders.js";

/** The reconciliation-derived values consumed by the rules pass and written back to the transaction row. */
export interface ReconResult {
  crossSourceOdometer: number | null;
  crossSourceOdometerAt: string | null;
  crossSourceOdometerSource: string | null;
  samsaraLocationMatched: boolean | null;
  locationConfidence: string | null;
  stationLat: number | null;
  stationLng: number | null;
  nearestStationMiles: number | null;
  locationEvidence: Record<string, unknown> | null;
  reconAt: string | null;
  tankFillShortGal: number | null;
  tankObservedRiseGal: number | null;
  tankPctBefore: number | null;
  tankPctAfter: number | null;
  observedState: string | null;
  observedCity: string | null;
  observedAddress: string | null;
  observedLat: number | null;
  observedLng: number | null;
  fuelingTimeBasis: string | null;
}

type SamsaraRecon = Awaited<ReturnType<typeof reconcileWithSamsara>>;

function emptyReconciliation(): ReconResult {
  return {
    crossSourceOdometer: null,
    crossSourceOdometerAt: null,
    crossSourceOdometerSource: null,
    samsaraLocationMatched: null,
    locationConfidence: null,
    stationLat: null,
    stationLng: null,
    nearestStationMiles: null,
    locationEvidence: null,
    reconAt: null,
    tankFillShortGal: null,
    tankObservedRiseGal: null,
    tankPctBefore: null,
    tankPctAfter: null,
    observedState: null,
    observedCity: null,
    observedAddress: null,
    observedLat: null,
    observedLng: null,
    fuelingTimeBasis: null,
  };
}

function storedReconciliation(r: FtxnRow): ReconResult {
  return {
    crossSourceOdometer: n(r.samsara_odometer),
    crossSourceOdometerAt: r.samsara_odometer_at ?? null,
    crossSourceOdometerSource: r.samsara_odometer_source ?? null,
    samsaraLocationMatched: r.samsara_location_matched ?? null,
    locationConfidence: r.samsara_location_confidence ?? null,
    stationLat: n(r.station_lat),
    stationLng: n(r.station_lng),
    nearestStationMiles: n(r.samsara_nearest_station_miles),
    locationEvidence: null,
    reconAt: r.samsara_recon_at ?? null,
    tankFillShortGal: n(r.samsara_tank_short_gal),
    tankObservedRiseGal: n(r.samsara_tank_observed_gal),
    tankPctBefore: n(r.samsara_fuel_pct_before),
    tankPctAfter: n(r.samsara_fuel_pct_after),
    observedState: r.samsara_observed_state ?? null,
    observedCity: r.samsara_observed_city ?? null,
    observedAddress: r.samsara_observed_address ?? null,
    observedLat: n(r.samsara_observed_lat),
    observedLng: n(r.samsara_observed_lng),
    fuelingTimeBasis: r.fueling_time_basis ?? null,
  };
}

async function liveReconciliation(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  r: FtxnRow,
  txn: TxnView,
  vehicle: VehicleView,
  samsaraVehicleId: string | null,
  opts: ScoreOpts,
): Promise<SamsaraRecon> {
  if (opts.reconHealth) opts.reconHealth.attempts++;
  try {
    return await reconcileWithSamsara(
      admin,
      env,
      orgId,
      {
        vehicleId: txn.vehicleId,
        samsaraVehicleId,
        fueledAt: txn.fueledAt,
        city: r.city,
        state: r.state,
        locationName: r.location_text,
        preciseTime: txn.fueledAtPrecision === "instant",
        gallons: txn.gallons,
        tankCapacityGal: vehicle.tankCapacityGal || null,
      },
      undefined,
      undefined,
      {
        token: opts.ctx?.samsaraToken,
        prefetchedRaw: opts.prefetchedRaw,
        geocodeCacheOnly: opts.geocodeCacheOnly,
      },
    );
  } catch (e) {
    if (e instanceof SamsaraUnavailableError) {
      if (opts.reconHealth) opts.reconHealth.failures++;
      return null;
    }
    throw e;
  }
}

function applyLiveReconciliation(
  result: ReconResult,
  recon: NonNullable<SamsaraRecon>,
  txn: TxnView,
  r: FtxnRow,
): void {
  Object.assign(result, {
    crossSourceOdometer: recon.crossSourceOdometer,
    crossSourceOdometerAt: recon.crossSourceOdometerAt,
    crossSourceOdometerSource: recon.crossSourceOdometerSource,
    samsaraLocationMatched: recon.locationMatched,
    locationConfidence: recon.locationConfidence,
    nearestStationMiles: recon.nearestStationMiles,
    stationLat: recon.stationLat,
    stationLng: recon.stationLng,
    locationEvidence: recon.locationEvidence,
    reconAt: recon.matchedAt,
    tankFillShortGal: recon.tankFillShortGal,
    tankObservedRiseGal: recon.tankObservedRiseGal,
    tankPctBefore: recon.tankPctBefore,
    tankPctAfter: recon.tankPctAfter,
    observedState: recon.observedState,
    observedCity: recon.observedCity,
    observedAddress: recon.observedAddress,
    observedLat: recon.observedLat,
    observedLng: recon.observedLng,
    fuelingTimeBasis: recon.fuelingTimeBasis,
  });
  const telematicsConfirmed =
    recon.fuelingTimeBasis === "tank_confirmed" ||
    (recon.matchedAt != null && recon.locationMatched === true);
  if (telematicsConfirmed) {
    txn.eventAt = recon.matchedAt;
    txn.timeConfirmed = true;
    txn.fueledAtPrecision = "instant";
  } else if (r.source !== "manual") {
    txn.timeConfirmed = false;
  }
}

async function suppressSystematicStationOffset(
  admin: SupabaseClient,
  orgId: string,
  r: FtxnRow,
  result: ReconResult,
): Promise<void> {
  const distanceSuspect =
    result.nearestStationMiles != null &&
    result.nearestStationMiles > LOCATION_DISTANCE_MISMATCH_MILES;
  if (!(result.samsaraLocationMatched === false || distanceSuspect) || !r.location_text || !r.state)
    return;
  const { data: stationRows } = await admin
    .from("fuel_transactions")
    .select("samsara_nearest_station_miles")
    .eq("org_id", orgId)
    .eq("location_text", r.location_text)
    .eq("state", r.state)
    .not("samsara_nearest_station_miles", "is", null)
    .order("fueled_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(20);
  const dists = ((stationRows ?? []) as { samsara_nearest_station_miles: number | string }[])
    .map((x) => Number(x.samsara_nearest_station_miles))
    .filter((x) => Number.isFinite(x));
  if (result.nearestStationMiles != null) dists.push(result.nearestStationMiles);
  if (!isSystematicStationOffset(dists)) return;
  result.samsaraLocationMatched = null;
  result.locationConfidence = "unknown";
  result.locationEvidence = {
    dataQuality: "station_coordinate_suspect",
    note: `Across recent fills the truck stayed a consistent ~${result.nearestStationMiles ?? "?"} mi from this station's stored coordinate — the pin appears wrong, so this is a data-quality issue, not a location mismatch.`,
  };
}

/**
 * Resolve the Samsara reconciliation for this fill. On the rebuild path (opts.skipRecon) it trusts the
 * values the last live reconciliation wrote to the row; otherwise it calls the live reconciler. It also
 * applies the telematics-recovered instant to `txn` IN MEMORY (eventAt / timeConfirmed / precision) so
 * time-based rules run against the real pump time without ever rewriting the stored fueled_at.
 */
export async function resolveReconciliation(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  r: FtxnRow,
  txn: TxnView,
  vehicle: VehicleView,
  samsaraVehicleId: string | null,
  opts: ScoreOpts,
): Promise<ReconResult> {
  const result = txn.vehicleId && opts.skipRecon ? storedReconciliation(r) : emptyReconciliation();
  if (txn.vehicleId && opts.skipRecon) {
    // Stored reconciliation values are trusted during rebuilds; fueled_at remains the business date.
  } else if (txn.vehicleId && !opts.reconUnavailable) {
    const recon = await liveReconciliation(
      admin,
      env,
      orgId,
      r,
      txn,
      vehicle,
      samsaraVehicleId,
      opts,
    );
    if (recon) applyLiveReconciliation(result, recon, txn, r);
  }

  await suppressSystematicStationOffset(admin, orgId, r, result);
  return result;
}
