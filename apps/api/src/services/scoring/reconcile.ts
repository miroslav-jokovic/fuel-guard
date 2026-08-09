/** Samsara reconciliation for one transaction — evidence-preserving live refresh + recovered fueling context. */
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

export type ReconStatus = "success" | "no_data" | "failed" | "skipped";

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
  /** Last time a live reconciliation was attempted; null for legacy/unreconciled rows. */
  reconCheckedAt: string | null;
  /** Outcome of the last reconciliation attempt. */
  reconStatus: ReconStatus | null;
  /** Only populated for a failed live attempt. */
  reconError: string | null;
  /** Monotonic evidence revision; rebuilds preserve it, successful live refreshes increment it. */
  reconEvidenceVersion: number;
}

type SamsaraRecon = Awaited<ReturnType<typeof reconcileWithSamsara>>;
type LiveReconResult = {
  recon: SamsaraRecon;
  status: ReconStatus;
  error: string | null;
};

const BASIS_RANK: Record<string, number> = {
  date_only: 1,
  reported: 2,
  stop_estimated: 3,
  tank_confirmed: 4,
};

/** Higher rank means stronger fueling-time evidence. Unknown/null is the weakest value. */
export function reconBasisRank(basis: string | null | undefined): number {
  return basis == null ? 0 : BASIS_RANK[basis] ?? 0;
}

function emptyReconciliation(status: ReconStatus | null = null): ReconResult {
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
    reconCheckedAt: null,
    reconStatus: status,
    reconError: null,
    reconEvidenceVersion: 1,
  };
}

function storedReconciliation(r: FtxnRow): ReconResult {
  const hasStoredEvidence = r.samsara_recon_at != null || r.samsara_odometer != null || r.samsara_tank_observed_gal != null;
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
    reconCheckedAt: r.samsara_recon_checked_at ?? null,
    reconStatus: (r.samsara_recon_status as ReconStatus | null) ?? (hasStoredEvidence ? "success" : null),
    reconError: r.samsara_recon_error ?? null,
    reconEvidenceVersion: n(r.samsara_recon_evidence_version) ?? 1,
  };
}

function resultFromLive(recon: NonNullable<SamsaraRecon>): ReconResult {
  return {
    crossSourceOdometer: recon.crossSourceOdometer,
    crossSourceOdometerAt: recon.crossSourceOdometerAt,
    crossSourceOdometerSource: recon.crossSourceOdometerSource,
    samsaraLocationMatched: recon.locationMatched,
    locationConfidence: recon.locationConfidence,
    stationLat: recon.stationLat,
    stationLng: recon.stationLng,
    nearestStationMiles: recon.nearestStationMiles,
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
    reconCheckedAt: null,
    reconStatus: "success",
    reconError: null,
    reconEvidenceVersion: 1,
  };
}

/**
 * Merge a successful live result with stored evidence. A weaker live result cannot replace stronger stored
 * fueling evidence. Missing fields are always filled from stored evidence; a non-null live value at an equal
 * or stronger basis may replace the stored value. This is pure so the precedence contract is testable.
 */
export function mergeReconciliation(stored: ReconResult, live: ReconResult): ReconResult {
  const storedRank = reconBasisRank(stored.fuelingTimeBasis);
  const liveRank = reconBasisRank(live.fuelingTimeBasis);
  const preserveStored = stored.reconAt != null && storedRank > liveRank;
  if (preserveStored) {
    return {
      ...stored,
      // A newly resolved station pin can fill a legacy gap without replacing stronger fueling evidence.
      stationLat: stored.stationLat ?? live.stationLat,
      stationLng: stored.stationLng ?? live.stationLng,
      reconStatus: "success",
      reconError: null,
      reconEvidenceVersion: stored.reconEvidenceVersion + 1,
    };
  }
  return {
    ...stored,
    ...live,
    crossSourceOdometer: live.crossSourceOdometer ?? stored.crossSourceOdometer,
    crossSourceOdometerAt: live.crossSourceOdometerAt ?? stored.crossSourceOdometerAt,
    crossSourceOdometerSource: live.crossSourceOdometerSource ?? stored.crossSourceOdometerSource,
    samsaraLocationMatched: live.samsaraLocationMatched ?? stored.samsaraLocationMatched,
    locationConfidence: live.locationConfidence ?? stored.locationConfidence,
    stationLat: live.stationLat ?? stored.stationLat,
    stationLng: live.stationLng ?? stored.stationLng,
    nearestStationMiles: live.nearestStationMiles ?? stored.nearestStationMiles,
    locationEvidence: live.locationEvidence ?? stored.locationEvidence,
    reconAt: live.reconAt ?? stored.reconAt,
    tankFillShortGal: live.tankFillShortGal ?? stored.tankFillShortGal,
    tankObservedRiseGal: live.tankObservedRiseGal ?? stored.tankObservedRiseGal,
    tankPctBefore: live.tankPctBefore ?? stored.tankPctBefore,
    tankPctAfter: live.tankPctAfter ?? stored.tankPctAfter,
    observedState: live.observedState ?? stored.observedState,
    observedCity: live.observedCity ?? stored.observedCity,
    observedAddress: live.observedAddress ?? stored.observedAddress,
    observedLat: live.observedLat ?? stored.observedLat,
    observedLng: live.observedLng ?? stored.observedLng,
    fuelingTimeBasis: live.fuelingTimeBasis ?? stored.fuelingTimeBasis,
    reconStatus: "success",
    reconError: null,
    reconEvidenceVersion: stored.reconAt == null ? 1 : stored.reconEvidenceVersion + 1,
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
): Promise<LiveReconResult> {
  if (opts.reconHealth) opts.reconHealth.attempts++;
  try {
    const recon = await reconcileWithSamsara(
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
    return recon ? { recon, status: "success", error: null } : { recon: null, status: "no_data", error: null };
  } catch (e) {
    if (e instanceof SamsaraUnavailableError) {
      if (opts.reconHealth) opts.reconHealth.failures++;
      return { recon: null, status: "failed", error: e.message };
    }
    throw e;
  }
}

export function applyReconciledContext(result: ReconResult, txn: TxnView, r: FtxnRow): void {
  // Live geocoding is part of this fill's rule context immediately; do not wait for a later rebuild.
  txn.stationLat = result.stationLat;
  txn.stationLng = result.stationLng;
  const telematicsConfirmed =
    result.fuelingTimeBasis === "tank_confirmed" ||
    (result.reconAt != null && result.samsaraLocationMatched === true);
  if (telematicsConfirmed) {
    txn.eventAt = result.reconAt;
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
  const distanceSuspect = result.nearestStationMiles != null && result.nearestStationMiles > LOCATION_DISTANCE_MISMATCH_MILES;
  if (!(result.samsaraLocationMatched === false || distanceSuspect) || !r.location_text || !r.state) return;
  const { data: stationRows, error } = await admin
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
  if (error) throw new Error(`[scoring] station-offset lookup failed: ${error.message}`);
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

/** Resolve live or stored evidence without allowing a failed refresh to erase a prior successful result. */
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
  const stored = txn.vehicleId ? storedReconciliation(r) : emptyReconciliation("skipped");
  let result = stored;

  if (txn.vehicleId && opts.skipRecon) {
    // Rules-only rebuild: stored reconciliation is authoritative and metadata is preserved.
  } else if (txn.vehicleId && opts.reconUnavailable) {
    result = {
      ...stored,
      reconCheckedAt: new Date().toISOString(),
      reconStatus: "failed",
      reconError: "Grouped Samsara reconciliation failed before this fill could be refreshed.",
    };
  } else if (txn.vehicleId) {
    const live = await liveReconciliation(admin, env, orgId, r, txn, vehicle, samsaraVehicleId, opts);
    result = {
      ...stored,
      reconCheckedAt: new Date().toISOString(),
      reconStatus: live.status,
      reconError: live.error,
    };
    if (live.recon) {
      result = mergeReconciliation(stored, resultFromLive(live.recon));
      result.reconCheckedAt = new Date().toISOString();
    }
    // If live returned no data or failed, result intentionally retains all stored evidence.
    applyReconciledContext(result, txn, r);
  }

  await suppressSystematicStationOffset(admin, orgId, r, result);
  return result;
}
