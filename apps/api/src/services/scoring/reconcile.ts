/** Samsara reconciliation for one transaction — the fueling-time odometer truth, recovered fueling time,
 * tank-rise volume signals and the location check. Extracted verbatim from scoreTransaction's core pass so
 * the orchestrator stays under the file-size budget; behavior is unchanged. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSystematicStationOffset, type TxnView, type VehicleView } from "@fuelguard/shared";
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
  // ── Samsara reconciliation: the fueling-time odometer truth + recovered fueling time + location check ──
  let crossSourceOdometer: number | null = null;
  let crossSourceOdometerAt: string | null = null;
  let crossSourceOdometerSource: string | null = null;
  let samsaraLocationMatched: boolean | null = null;
  let locationConfidence: string | null = null;
  let stationLat: number | null = null;
  let stationLng: number | null = null;
  let nearestStationMiles: number | null = null;
  let locationEvidence: Record<string, unknown> | null = null;
  let reconAt: string | null = null;
  let tankFillShortGal: number | null = null;
  let tankObservedRiseGal: number | null = null;
  let tankPctBefore: number | null = null;
  let tankPctAfter: number | null = null;
  let observedState: string | null = null;
  let observedCity: string | null = null;
  let observedAddress: string | null = null;
  let observedLat: number | null = null;
  let observedLng: number | null = null;
  let fuelingTimeBasis: string | null = null;
  // The EFS fueling time is "precise" when it carries a real time-of-day (timed report / manual),
  // not the date-only noon sentinel. Only then can we compare Samsara's position at the exact minute.
  const preciseTime = txn.fueledAtPrecision === "instant";
  if (txn.vehicleId && opts.skipRecon) {
    // Rebuild path: trust the values the last live reconciliation already wrote to the row. The
    // stored fueled_at stays the EFS business date; the telematics-recovered instant lives in
    // samsara_recon_at and is applied IN MEMORY ONLY so time-based rules can run.
    crossSourceOdometer = n(r.samsara_odometer);
    crossSourceOdometerAt = r.samsara_odometer_at ?? null;
    crossSourceOdometerSource = r.samsara_odometer_source ?? null;
    samsaraLocationMatched = r.samsara_location_matched ?? null;
    locationConfidence = r.samsara_location_confidence ?? null;
    nearestStationMiles = n(r.samsara_nearest_station_miles);
    stationLat = n(r.station_lat);
    stationLng = n(r.station_lng);
    tankFillShortGal = n(r.samsara_tank_short_gal);
    tankObservedRiseGal = n(r.samsara_tank_observed_gal);
    tankPctBefore = n(r.samsara_fuel_pct_before);
    tankPctAfter = n(r.samsara_fuel_pct_after);
    observedState = r.samsara_observed_state ?? null;
    observedCity = r.samsara_observed_city ?? null;
    observedAddress = r.samsara_observed_address ?? null;
    observedLat = n(r.samsara_observed_lat);
    observedLng = n(r.samsara_observed_lng);
    fuelingTimeBasis = r.fueling_time_basis ?? null;
    reconAt = r.samsara_recon_at ?? null;
    // eventAt / timeConfirmed / precision were already derived from these same stored columns in
    // toTxnView, so the telematics-recovered instant is applied for rules without touching fueled_at.
  } else if (txn.vehicleId && !opts.reconUnavailable) {
    if (opts.reconHealth) opts.reconHealth.attempts++;
    // eslint-disable-next-line no-useless-assignment -- reset to null in catch on Samsara outage; keeps recon defined for the if-block
    let recon: Awaited<ReturnType<typeof reconcileWithSamsara>> = null;
    try {
      recon = await reconcileWithSamsara(
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
          preciseTime,
          gallons: txn.gallons,
          // Compute the observed rise / shortfall against the FULL tank capacity — this is the raw signal the
          // per-truck reliability learner uses (observed/billed ratio). Whether a shortfall is actually
          // FLAGGED is gated in ruleTankFillShort on the learned `tankSensorReliable` flag, so a dual-tank
          // truck (ratio ≈ 0.5 / erratic) never produces a false short.
          tankCapacityGal: vehicle.tankCapacityGal || null,
        },
        undefined,
        undefined,
        { token: opts.ctx?.samsaraToken, prefetchedRaw: opts.prefetchedRaw, geocodeCacheOnly: opts.geocodeCacheOnly },
      );
    } catch (e) {
      // Distinguish a Samsara FETCH outage from "no data". On an outage, leave the row unreconciled
      // (samsara_recon_at stays null so it retries later) and record it for the backfill abort guard.
      // Any other (unexpected) error still surfaces.
      if (e instanceof SamsaraUnavailableError) {
        if (opts.reconHealth) opts.reconHealth.failures++;
        recon = null;
      } else {
        throw e;
      }
    }
    if (recon) {
      crossSourceOdometer = recon.crossSourceOdometer;
      crossSourceOdometerAt = recon.crossSourceOdometerAt;
      crossSourceOdometerSource = recon.crossSourceOdometerSource;
      samsaraLocationMatched = recon.locationMatched;
      locationConfidence = recon.locationConfidence;
      nearestStationMiles = recon.nearestStationMiles;
      stationLat = recon.stationLat;
      stationLng = recon.stationLng;
      locationEvidence = recon.locationEvidence;
      reconAt = recon.matchedAt;
      tankFillShortGal = recon.tankFillShortGal;
      tankObservedRiseGal = recon.tankObservedRiseGal;
      tankPctBefore = recon.tankPctBefore;
      tankPctAfter = recon.tankPctAfter;
      observedState = recon.observedState;
      observedCity = recon.observedCity;
      observedAddress = recon.observedAddress;
      observedLat = recon.observedLat;
      observedLng = recon.observedLng;
      fuelingTimeBasis = recon.fuelingTimeBasis;
      // A tank-rise-confirmed instant is trustworthy even on a location mismatch; otherwise require a
      // corroborated stop (matched location + recovered time).
      const telematicsConfirmed =
        recon.fuelingTimeBasis === "tank_confirmed" || (recon.matchedAt != null && recon.locationMatched === true);
      if (telematicsConfirmed) {
        // Telematics corroborated the physical stop → use its instant for time-of-day / inter-fill rules.
        // This corrects EFS authorization/settlement timestamps that differ from the real pump time, and
        // recovers a time for date-only rows. The stored fueled_at keeps the EFS business date (rewriting
        // it moved spend onto neighboring dates and reordered the MPG chain — migration 0026); eventAt is
        // carried separately, in memory only.
        txn.eventAt = recon.matchedAt;
        txn.timeConfirmed = true;
        txn.fueledAtPrecision = "instant";
      } else if (r.source !== "manual") {
        // A posted EFS time we could NOT corroborate (unmapped stop / no coverage / mismatch) — don't
        // trust it for time-based rules; it may be an auth/settlement time. Off-hours + inter-fill rules
        // are suppressed for this fill rather than fired off a possibly-wrong clock.
        txn.timeConfirmed = false;
      }
    }
  }

  // Phase 4 (docs/12 §E): suppress a would-be location mismatch that is actually a WRONG STATION PIN. If the
  // truck came a CONSISTENT non-zero distance from this station across its recent fills, the stored coordinate
  // is off (city-centroid / bad geocode), not theft — downgrade to unknown (data-quality) so the mismatch rule
  // stays silent. A genuine "card used where the truck wasn't" varies trip to trip. Never RAISES a mismatch.
  if (samsaraLocationMatched === false && r.location_text && r.state) {
    const { data: stationRows } = await admin
      .from("fuel_transactions")
      .select("samsara_nearest_station_miles")
      .eq("org_id", orgId)
      .eq("location_text", r.location_text)
      .eq("state", r.state)
      .not("samsara_nearest_station_miles", "is", null)
      .order("fueled_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }) // deterministic sample at the limit boundary (R-2)
      .limit(20);
    const dists = ((stationRows ?? []) as { samsara_nearest_station_miles: number | string }[])
      .map((x) => Number(x.samsara_nearest_station_miles))
      .filter((x) => Number.isFinite(x));
    if (nearestStationMiles != null) dists.push(nearestStationMiles);
    if (isSystematicStationOffset(dists)) {
      samsaraLocationMatched = null;
      locationConfidence = "unknown";
      locationEvidence = {
        dataQuality: "station_coordinate_suspect",
        note: `Across recent fills the truck stayed a consistent ~${nearestStationMiles ?? "?"} mi from this station's stored coordinate — the pin appears wrong, so this is a data-quality issue, not a location mismatch.`,
      };
    }
  }

  return {
    crossSourceOdometer,
    crossSourceOdometerAt,
    crossSourceOdometerSource,
    samsaraLocationMatched,
    locationConfidence,
    stationLat,
    stationLng,
    nearestStationMiles,
    locationEvidence,
    reconAt,
    tankFillShortGal,
    tankObservedRiseGal,
    tankPctBefore,
    tankPctAfter,
    observedState,
    observedCity,
    observedAddress,
    observedLat,
    observedLng,
    fuelingTimeBasis,
  };
}
