import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseIdlingEvents,
  classifyIdleEvent,
  learnComfortBand,
  learnIdleBurn,
  estimateIdleGallons,
  matchAssignmentAt,
  type IdleThresholds,
  type AssignmentInterval,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { makeSamsaraIdlingEventFetcher } from "../lib/samsara.js";
import { makeOpenMeteoFetcher } from "../lib/openMeteo.js";
import { backfillTemperatures } from "./weatherBackfill.js";
import { NoSamsaraTokenError } from "./samsaraVehicleSync.js";

export interface IdleSyncResult {
  fetched: number;
  upserted: number;
}

const UPSERT_CHUNK = 500;

/** The fleet's recent actual EFS price/gal (mean of the last N priced fills), for a real idle-cost estimate.
 *  Falls back to the configured/default rate when there's no price history. */
async function recentEfsPricePerGal(
  admin: SupabaseClient,
  orgId: string,
  fallback: number,
): Promise<number> {
  const { data } = await admin
    .from("fuel_transactions")
    .select("price_per_gal")
    .eq("org_id", orgId)
    .not("price_per_gal", "is", null)
    .gt("price_per_gal", 0)
    .order("fueled_at", { ascending: false })
    .limit(500);
  const prices = ((data ?? []) as { price_per_gal: number | string }[])
    .map((r) => Number(r.price_per_gal))
    .filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length === 0) return fallback;
  return prices.reduce((s, p) => s + p, 0) / prices.length;
}

/**
 * Pull Samsara idling events over the trailing window, attribute each to our vehicle + driver, classify it
 * (productive / justified / discretionary / brief), and upsert into idle_events. Idempotent on
 * (org_id, samsara_event_id). Driver comes from the event's `operator.id` (Samsara driver id) → our driver by
 * samsara_driver_id; unattributed when Samsara had no driver assigned.
 */
export async function syncIdleEvents(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: {
    sinceDays?: number;
    thresholds?: IdleThresholds;
    idlingFetcher?: (startIso: string, endIso: string) => Promise<{ data: unknown[] }>;
  } = {},
): Promise<IdleSyncResult> {
  const token = opts.idlingFetcher ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();

  const days = opts.sinceDays ?? 30;
  const endIso = new Date().toISOString();
  const startIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const fetchIdling = opts.idlingFetcher ?? makeSamsaraIdlingEventFetcher(env, token);
  const raw = await fetchIdling(startIso, endIso);
  const events = parseIdlingEvents(raw);
  if (events.length === 0) return { fetched: 0, upserted: 0 };

  // Configured thresholds (settable comfort band, min duration, $ rates) — fall back to defaults when unset.
  const { data: settings } = await admin
    .from("idle_settings")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  const thresholds: IdleThresholds = {
    ...opts.thresholds,
    ...(settings
      ? {
          minIdleSec: Number(settings.min_idle_minutes) * 60,
          climateLowF: Number(settings.comfort_low_f),
          climateHighF: Number(settings.comfort_high_f),
          idleGalPerHour: Number(settings.idle_gal_per_hour),
          fuelPricePerGal: Number(settings.fuel_price_per_gal),
        }
      : {}),
  };

  const [{ data: vs }, { data: ds }] = await Promise.all([
    admin
      .from("vehicles")
      .select("id, samsara_vehicle_id, has_apu")
      .eq("org_id", orgId)
      .not("samsara_vehicle_id", "is", null),
    admin
      .from("drivers")
      .select("id, samsara_driver_id")
      .eq("org_id", orgId)
      .not("samsara_driver_id", "is", null),
  ]);
  const vehBySamsara = new Map(
    ((vs ?? []) as { id: string; samsara_vehicle_id: string; has_apu: boolean | null }[]).map(
      (v) => [v.samsara_vehicle_id, { id: v.id, hasApu: v.has_apu }],
    ),
  );
  const drvBySamsara = new Map(
    ((ds ?? []) as { id: string; samsara_driver_id: string }[]).map((d) => [
      d.samsara_driver_id,
      d.id,
    ]),
  );

  // CP4: time-ranged driver-vehicle assignments (persisted by the vehicle sync), for attributing idle events
  // that Samsara left without an operator to the driver who had the truck at that time.
  const { data: assignRows } = await admin
    .from("driver_vehicle_assignments")
    .select("vehicle_samsara_id, driver_samsara_id, start_at, end_at")
    .eq("org_id", orgId);
  const intervals: AssignmentInterval[] = (
    (assignRows ?? []) as {
      vehicle_samsara_id: string;
      driver_samsara_id: string;
      start_at: string;
      end_at: string | null;
    }[]
  ).map((r) => ({
    vehicleSamsaraId: r.vehicle_samsara_id,
    driverSamsaraId: r.driver_samsara_id,
    startMs: Date.parse(r.start_at),
    endMs: r.end_at ? Date.parse(r.end_at) : null,
  }));

  // Idle $ uses OUR model, not Samsara's fuelCost (unverified currency/units — audit A1.4): cost = gallons ×
  // the fleet's ACTUAL EFS price/gal. Gallons = Samsara's measured value when present, else duration × the
  // configured idle burn rate (0.8 gal/hr). The EFS price is the recent fleet average; fall back to the
  // configured rate, then the default.
  const galPerHour = thresholds.idleGalPerHour ?? 0.8;
  const fuelPrice = await recentEfsPricePerGal(admin, orgId, thresholds.fuelPricePerGal ?? 4.0);
  // CP3: learn a per-truck idle burn rate from this batch's MEASURED events (fall back to a fleet rate, then the
  // configured default). Unmeasured events then get a truck-specific, temperature-adjusted gallons estimate
  // instead of a flat 0.8 gal/hr — so cost and gallons are both more precise and mutually consistent.
  const learnedBurn = learnIdleBurn(
    events.map((e) => ({
      vehicleId: (e.assetId ? vehBySamsara.get(e.assetId)?.id : null) ?? null,
      durationSec: e.durationSec,
      fuelGal: e.fuelGal,
    })),
  );

  // CP2: backfill ambient temperature for events Samsara didn't report one for, so the weather excuse is fair.
  // Best-effort + cached (weather_cache); on failure the event stays temperature-less → classified 'undetermined'.
  let backfilledTemp = new Map<string, number>();
  if (env.WEATHER_BACKFILL_ENABLED) {
    try {
      const need = events
        .filter((e) => e.airTempF == null && e.lat != null && e.lng != null)
        .map((e) => ({ eventUuid: e.eventUuid, lat: e.lat, lng: e.lng, startTime: e.startTime }));
      if (need.length)
        backfilledTemp = await backfillTemperatures(admin, need, makeOpenMeteoFetcher(env));
    } catch {
      /* best-effort — never block the sync on weather */
    }
  }

  const rows = events.map((e) => {
    const veh = e.assetId ? vehBySamsara.get(e.assetId) : undefined;
    // Resolve temperature: Samsara's reading if present, else the CP2 backfill, else none (→ undetermined).
    const backfill = e.airTempF == null ? (backfilledTemp.get(e.eventUuid) ?? null) : null;
    const airTempF = e.airTempF ?? backfill;
    const airTempSource = e.airTempF != null ? "samsara" : backfill != null ? "backfill" : "none";
    // CP3: resolved gallons — measured if Samsara reported it, else the learned per-truck / temperature estimate.
    const est = estimateIdleGallons(
      { vehicleId: veh?.id ?? null, durationSec: e.durationSec, fuelGal: e.fuelGal, airTempF },
      {
        learned: learnedBurn,
        defaultGalPerHour: galPerHour,
        climateLowF: thresholds.climateLowF,
        climateHighF: thresholds.climateHighF,
      },
    );
    // CP4: attribute to Samsara's operator when present; else infer the driver assigned to this truck at the idle
    // time ('inferred' vs 'direct' for transparency). Unattributed only when neither source resolves a driver.
    const directDriver = e.operatorId ? (drvBySamsara.get(e.operatorId) ?? null) : null;
    let driverId = directDriver;
    let driverSource: "direct" | "inferred" | "none" = directDriver != null ? "direct" : "none";
    if (driverId == null && e.assetId) {
      const dsam = matchAssignmentAt(intervals, e.assetId, Date.parse(e.startTime));
      const inferred = dsam ? (drvBySamsara.get(dsam) ?? null) : null;
      if (inferred) {
        driverId = inferred;
        driverSource = "inferred";
      }
    }
    return {
      org_id: orgId,
      samsara_event_id: e.eventUuid,
      vehicle_id: veh?.id ?? null,
      driver_id: driverId,
      driver_source: driverSource,
      started_at: e.startTime,
      duration_sec: e.durationSec,
      pto_active: e.ptoActive,
      air_temp_f: airTempF,
      air_temp_source: airTempSource,
      fuel_gal: e.fuelGal,
      idle_gal: est.gallons,
      cost_usd: Math.round(est.gallons * fuelPrice * 100) / 100,
      lat: e.lat,
      lng: e.lng,
      geofence_types: e.geofenceTypes,
      // has_apu makes the classification capability-fair: an APU truck's extreme-temp main-engine idle stays
      // discretionary (should've used the APU), not justified (audit A1.3).
      classification: classifyIdleEvent(
        {
          durationSec: e.durationSec,
          ptoActive: e.ptoActive,
          airTempF,
          hasApu: veh?.hasApu ?? null,
        },
        thresholds,
      ),
    };
  });

  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await admin
      .from("idle_events")
      .upsert(chunk, { onConflict: "org_id,samsara_event_id" });
    if (error) throw new Error(error.message);
    upserted += chunk.length;
  }

  // Learn the data-driven comfort band from the idle-vs-temperature pattern and store it as a SUGGESTION
  // (never auto-applied — an admin adopts it). Only SCORED idle (≥ the min duration) counts — feeding brief
  // sub-threshold stops would skew the histogram (audit A1.6). Upsert touches only the suggestion columns.
  const minIdleSec = thresholds.minIdleSec ?? 300;
  const band = learnComfortBand(
    events
      .filter((e) => e.airTempF != null && e.durationSec >= minIdleSec)
      .map((e) => ({ tempF: e.airTempF as number, hours: e.durationSec / 3600 })),
  );
  if (band) {
    await admin.from("idle_settings").upsert(
      {
        org_id: orgId,
        suggested_low_f: band.lowF,
        suggested_high_f: band.highF,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id" },
    );
  }

  return { fetched: events.length, upserted };
}
