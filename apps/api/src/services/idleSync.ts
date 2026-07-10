import type { SupabaseClient } from "@supabase/supabase-js";
import { parseIdlingEvents, classifyIdleEvent, learnComfortBand, type IdleThresholds } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { makeSamsaraIdlingEventFetcher } from "../lib/samsara.js";
import { NoSamsaraTokenError } from "./samsaraVehicleSync.js";

export interface IdleSyncResult {
  fetched: number;
  upserted: number;
}

const UPSERT_CHUNK = 500;

/**
 * Pull Samsara idling events over the trailing window, attribute each to our vehicle + driver, classify it
 * (productive / justified / discretionary / brief), and upsert into idle_events. Idempotent on
 * (org_id, samsara_event_id). Driver comes from the event's `operator.id` (Samsara driver id) → our driver by
 * samsara_driver_id; unattributed when Samsara had no driver assigned.
 */
export async function syncIdleEvents(admin: SupabaseClient, env: Env, orgId: string, opts: { sinceDays?: number; thresholds?: IdleThresholds } = {}): Promise<IdleSyncResult> {
  const token = await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();

  const days = opts.sinceDays ?? 30;
  const endIso = new Date().toISOString();
  const startIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const raw = await makeSamsaraIdlingEventFetcher(env, token)(startIso, endIso);
  const events = parseIdlingEvents(raw);
  if (events.length === 0) return { fetched: 0, upserted: 0 };

  // Configured thresholds (settable comfort band, min duration, $ rates) — fall back to defaults when unset.
  const { data: settings } = await admin.from("idle_settings").select("*").eq("org_id", orgId).maybeSingle();
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
    admin.from("vehicles").select("id, samsara_vehicle_id").eq("org_id", orgId).not("samsara_vehicle_id", "is", null),
    admin.from("drivers").select("id, samsara_driver_id").eq("org_id", orgId).not("samsara_driver_id", "is", null),
  ]);
  const vehBySamsara = new Map(((vs ?? []) as { id: string; samsara_vehicle_id: string }[]).map((v) => [v.samsara_vehicle_id, v.id]));
  const drvBySamsara = new Map(((ds ?? []) as { id: string; samsara_driver_id: string }[]).map((d) => [d.samsara_driver_id, d.id]));

  const rows = events.map((e) => ({
    org_id: orgId,
    samsara_event_id: e.eventUuid,
    vehicle_id: e.assetId ? vehBySamsara.get(e.assetId) ?? null : null,
    driver_id: e.operatorId ? drvBySamsara.get(e.operatorId) ?? null : null,
    started_at: e.startTime,
    duration_sec: e.durationSec,
    pto_active: e.ptoActive,
    air_temp_f: e.airTempF,
    fuel_gal: e.fuelGal,
    cost_usd: e.costUsd,
    lat: e.lat,
    lng: e.lng,
    geofence_types: e.geofenceTypes,
    classification: classifyIdleEvent({ durationSec: e.durationSec, ptoActive: e.ptoActive, airTempF: e.airTempF }, thresholds),
  }));

  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await admin.from("idle_events").upsert(chunk, { onConflict: "org_id,samsara_event_id" });
    if (error) throw new Error(error.message);
    upserted += chunk.length;
  }

  // Learn the data-driven comfort band from the idle-vs-temperature pattern and store it as a SUGGESTION
  // (never auto-applied — an admin adopts it). Upsert touches only the suggestion columns.
  const band = learnComfortBand(events.filter((e) => e.airTempF != null).map((e) => ({ tempF: e.airTempF as number, hours: e.durationSec / 3600 })));
  if (band) {
    await admin.from("idle_settings").upsert({ org_id: orgId, suggested_low_f: band.lowF, suggested_high_f: band.highF, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
  }

  return { fetched: events.length, upserted };
}
