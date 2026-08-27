import type { SupabaseClient } from "@supabase/supabase-js";
import { summarizeIdleTelemetry, type IdleTelemetrySeries } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { loadSamsaraToken } from "../samsara/lib/samsaraToken.js";
import {
  makeSamsaraVehicleTelemetryFetcher,
  type SamsaraNumericStatEvent,
  type VehicleTelemetryFetcher,
} from "../samsara/lib/samsara.js";
import { NoSamsaraTokenError } from "../samsara/index.js";
import { IDLE_SOURCE_WINDOW_DAYS } from "./idleWindow.js";

export interface IdleTelemetrySyncResult {
  vehicles: number;
  vehiclesWithTelemetry: number;
  windowsWritten: number;
  samples: {
    battery: number;
    rpm: number;
    engineLoad: number;
    ecuSpeed: number;
  };
}

const EVIDENCE_VERSION = "vehicle-stats-v1" as const;

function parseNumericEvents(events: readonly SamsaraNumericStatEvent[] | undefined): { t: number; value: number }[] {
  return (events ?? [])
    .map((event) => ({ t: Date.parse(event.time ?? ""), value: event.value ?? Number.NaN }))
    .filter((event) => Number.isFinite(event.t) && Number.isFinite(event.value));
}

function requireDatabaseSuccess(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`Idle telemetry ${operation} failed: ${error.message}`);
}

export async function syncIdleTelemetry(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: { sinceDays?: number; telemetryFetcher?: VehicleTelemetryFetcher } = {},
): Promise<IdleTelemetrySyncResult> {
  const token = await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();
  const { data: vehicleRows } = await admin
    .from("vehicles")
    .select("id, samsara_vehicle_id")
    .eq("org_id", orgId)
    .not("samsara_vehicle_id", "is", null);
  const vehicles = (vehicleRows ?? []) as { id: string; samsara_vehicle_id: string }[];
  if (vehicles.length === 0) {
    return { vehicles: 0, vehiclesWithTelemetry: 0, windowsWritten: 0, samples: { battery: 0, rpm: 0, engineLoad: 0, ecuSpeed: 0 } };
  }

  const days = opts.sinceDays ?? IDLE_SOURCE_WINDOW_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 400) throw new RangeError("Idle telemetry sinceDays must be an integer from 1 to 400");
  const endMs = Date.now();
  const startMs = endMs - days * 86_400_000;
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  const syncedAt = new Date(endMs).toISOString();
  const fetcher = opts.telemetryFetcher ?? makeSamsaraVehicleTelemetryFetcher(env, token);
  let vehiclesWithTelemetry = 0;
  let windowsWritten = 0;
  const samples = { battery: 0, rpm: 0, engineLoad: 0, ecuSpeed: 0 };

  for (let i = 0; i < vehicles.length; i += 20) {
    const batch = vehicles.slice(i, i + 20);
    const fetched = await fetcher(batch.map((vehicle) => vehicle.samsara_vehicle_id), startIso, endIso);
    if (!fetched.complete) throw new Error(`Samsara telemetry history was truncated after ${fetched.pages} pages; no telemetry windows were reconciled`);
    const recordsBySamsaraId = new Map(fetched.data.map((record) => [String(record.id ?? ""), record]));
    for (const vehicle of batch) {
      const record = recordsBySamsaraId.get(vehicle.samsara_vehicle_id);
      const series: IdleTelemetrySeries = {
        batteryMilliVolts: parseNumericEvents(record?.batteryMilliVolts),
        engineRpm: parseNumericEvents(record?.engineRpm),
        engineLoadPercent: parseNumericEvents(record?.engineLoadPercent).filter((sample) => sample.value >= 0 && sample.value <= 100),
        ecuSpeedMph: parseNumericEvents(record?.ecuSpeedMph).filter((sample) => sample.value >= 0),
      };
      const summary = summarizeIdleTelemetry(series);
      const total = summary.batteryMilliVolts.samples + summary.engineRpm.samples + summary.engineLoadPercent.samples + summary.ecuSpeedMph.samples;
      if (total > 0) vehiclesWithTelemetry += 1;
      samples.battery += summary.batteryMilliVolts.samples;
      samples.rpm += summary.engineRpm.samples;
      samples.engineLoad += summary.engineLoadPercent.samples;
      samples.ecuSpeed += summary.ecuSpeedMph.samples;
      const { error } = await admin.from("idle_telemetry_windows").upsert({
        org_id: orgId,
        vehicle_id: vehicle.id,
        window_start: startIso,
        window_end: endIso,
        data_status: total > 0 ? "observed" : "insufficient",
        battery_sample_count: summary.batteryMilliVolts.samples,
        battery_min_mv: summary.batteryMilliVolts.min,
        battery_max_mv: summary.batteryMilliVolts.max,
        battery_avg_mv: summary.batteryMilliVolts.average,
        rpm_sample_count: summary.engineRpm.samples,
        rpm_min: summary.engineRpm.min,
        rpm_max: summary.engineRpm.max,
        rpm_avg: summary.engineRpm.average,
        engine_load_sample_count: summary.engineLoadPercent.samples,
        engine_load_min_pct: summary.engineLoadPercent.min,
        engine_load_max_pct: summary.engineLoadPercent.max,
        engine_load_avg_pct: summary.engineLoadPercent.average,
        ecu_speed_sample_count: summary.ecuSpeedMph.samples,
        ecu_speed_min_mph: summary.ecuSpeedMph.min,
        ecu_speed_max_mph: summary.ecuSpeedMph.max,
        ecu_speed_avg_mph: summary.ecuSpeedMph.average,
        source: "vehicle_stats_history",
        evidence_version: EVIDENCE_VERSION,
        synced_at: syncedAt,
      }, { onConflict: "org_id,vehicle_id" });
      requireDatabaseSuccess(error, "window upsert");
      windowsWritten += 1;
    }
  }
  return { vehicles: vehicles.length, vehiclesWithTelemetry, windowsWritten, samples };
}
