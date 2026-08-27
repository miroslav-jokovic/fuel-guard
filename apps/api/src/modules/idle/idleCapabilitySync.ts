import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aggregateEngineDays,
  buildIdleSessionEvidence,
  buildIdleSessions,
  dayInTz,
  summarizeIdleEvidence,
  learnIdleCapability,
  parseEngineStates,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { loadSamsaraToken } from "../samsara/lib/samsaraToken.js";
import { makeSamsaraEngineStatesFetcher, type EngineStatesFetcher } from "../samsara/lib/samsara.js";
import { NoSamsaraTokenError } from "../samsara/index.js";
import { IDLE_SOURCE_WINDOW_DAYS } from "./idleWindow.js";

export interface IdleCapabilityResult {
  vehicles: number;
  learned: number; // trucks we could classify (not 'unknown')
  engineDays: number; // per-truck/day engine-time rows written
  parkSessions: number; // park sessions written
  vehiclesWithData: number;
  vehiclesWithoutData: number;
  staleEngineDaysDeleted: number;
  staleParkSessionsDeleted: number;
  batches: number;
}

/** Trucks per engineStates call (comma-separated vehicleIds), keeps each request bounded. */
const BATCH = 20;
const DEFAULT_ORG_TIMEZONE = "America/Chicago";

interface VehicleRow {
  id: string;
  samsara_vehicle_id: string;
}

interface ExistingEngineDayRow {
  id: string;
  day: string;
}

interface ExistingParkSessionRow {
  id: string;
  started_at: string;
}

interface CapabilityReconciliationResult {
  staleEngineDaysDeleted: number;
  staleParkSessionsDeleted: number;
}

/** The org's operating clock — the day boundary engine-days, and therefore the rollup, are cut on. */
export function organizationTimezone(value: object | null | undefined): string {
  if (value === null || value === undefined || Array.isArray(value) || !("tz" in value)) {
    return DEFAULT_ORG_TIMEZONE;
  }
  const tz = value.tz;
  return typeof tz === "string" && tz.length > 0 ? tz : DEFAULT_ORG_TIMEZONE;
}

function requireDatabaseSuccess(error: { message: string } | null, operation: string): void {
  if (error) throw new Error(`Idle capability ${operation} failed: ${error.message}`);
}

/** Persisted park-session fields are integer seconds in migration 0076. Keep this boundary explicit even
 * if a future parser starts returning millisecond-derived fractional seconds. */
function persistedSeconds(value: number): number {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}

async function reconcileCapabilityRows(
  admin: SupabaseClient,
  orgId: string,
  vehicleId: string,
  startIso: string,
  endIso: string,
  orgTz: string,
  engineDays: { day: string }[],
  sessions: { startMs: number }[],
): Promise<CapabilityReconciliationResult> {
  const startDay = dayInTz(startIso, orgTz);
  const endDay = dayInTz(new Date(Date.parse(endIso) - 1).toISOString(), orgTz);
  const { data: existingEngineDays, error: engineReadError } = await admin
    .from("vehicle_engine_days")
    .select("id, day")
    .eq("org_id", orgId)
    .eq("vehicle_id", vehicleId)
    .gte("day", startDay)
    .lte("day", endDay);
  requireDatabaseSuccess(engineReadError, "engine-day reconciliation read");
  const currentEngineDays = new Set(engineDays.map((row) => row.day));
  const staleEngineDayIds = ((existingEngineDays ?? []) as ExistingEngineDayRow[])
    .filter((row) => !currentEngineDays.has(row.day))
    .map((row) => row.id);
  if (staleEngineDayIds.length > 0) {
    const { error: engineDeleteError } = await admin
      .from("vehicle_engine_days")
      .delete()
      .in("id", staleEngineDayIds);
    requireDatabaseSuccess(engineDeleteError, "stale engine-day reconciliation");
  }

  const { data: existingParkSessions, error: sessionReadError } = await admin
    .from("idle_park_sessions")
    .select("id, started_at")
    .eq("org_id", orgId)
    .eq("vehicle_id", vehicleId)
    .gte("started_at", startIso)
    .lt("started_at", endIso);
  requireDatabaseSuccess(sessionReadError, "park-session reconciliation read");
  const currentSessionStarts = new Set(sessions.map((session) => session.startMs));
  const staleParkSessionIds = ((existingParkSessions ?? []) as ExistingParkSessionRow[])
    .filter((row) => !currentSessionStarts.has(Date.parse(row.started_at)))
    .map((row) => row.id);
  if (staleParkSessionIds.length > 0) {
    const { error: sessionDeleteError } = await admin
      .from("idle_park_sessions")
      .delete()
      .in("id", staleParkSessionIds);
    requireDatabaseSuccess(sessionDeleteError, "stale park-session reconciliation");
  }
  return {
    staleEngineDaysDeleted: staleEngineDayIds.length,
    staleParkSessionsDeleted: staleParkSessionIds.length,
  };
}

type IdleCapabilitySamples = Parameters<typeof buildIdleSessions>[0];

interface VehicleCapabilitySyncResult {
  learned: number;
  engineDays: number;
  parkSessions: number;
  staleEngineDaysDeleted: number;
  staleParkSessionsDeleted: number;
}

async function syncIdleVehicle(
  admin: SupabaseClient,
  orgId: string,
  vehicle: VehicleRow,
  samples: IdleCapabilitySamples,
  orgTz: string,
  startIso: string,
  endIso: string,
  days: number,
  nowIso: string,
  skipVehicleLearning: boolean,
): Promise<VehicleCapabilitySyncResult> {
  const vehicleId = vehicle.id;
  const sessions = buildIdleSessions(samples);
  const cap = learnIdleCapability(sessions);
  const vehicleEvidence = summarizeIdleEvidence(sessions, samples);
  const engDays = aggregateEngineDays(samples, { tz: orgTz }).map((d) => ({
    org_id: orgId,
    vehicle_id: vehicleId,
    day: d.day,
    drive_sec: d.driveSec,
    idle_sec: d.idleSec,
    off_sec: d.offSec,
    coverage_sec: d.coverageSec,
    tz_offset_minutes: d.tzOffsetMinutes,
    synced_at: nowIso,
  }));
  if (engDays.length) {
    const { error } = await admin
      .from("vehicle_engine_days")
      .upsert(engDays, { onConflict: "org_id,vehicle_id,day" });
    requireDatabaseSuccess(error, "engine-day upsert");
  }

  const parkRows = sessions.map((s) => {
    const evidence = buildIdleSessionEvidence(s, samples);
    return {
      org_id: orgId,
      vehicle_id: vehicleId,
      started_at: new Date(s.startMs).toISOString(),
      ended_at: new Date(s.endMs).toISOString(),
      duration_sec: persistedSeconds(s.durationSec),
      idle_sec: persistedSeconds(s.idleSec),
      off_sec: persistedSeconds(s.offSec),
      cycles: persistedSeconds(s.cycles),
      mode: s.mode,
      // The park's own GPS fix (migration 0188), already present on every engineStates sample we fetch.
      // This is what lets the equipment-evidence sync read the session's weather from weather_cache
      // instead of inheriting a temperature from whatever Samsara idle event happened to overlap it.
      lat: s.lat,
      lng: s.lng,
      observed_mode: evidence.observedMode,
      evidence_status: evidence.evidenceStatus,
      evidence_confidence: evidence.confidence,
      state_sample_count: evidence.stateSampleCount,
      gps_state_sample_count: evidence.gpsStateSampleCount,
      source_coverage_sec: evidence.sourceCoverageSec,
      stationary_sec: evidence.stationarySec,
      max_speed_mph: evidence.maxSpeedMph,
      evidence_version: evidence.evidenceVersion,
      synced_at: nowIso,
    };
  });
  if (parkRows.length) {
    const { error } = await admin
      .from("idle_park_sessions")
      .upsert(parkRows, { onConflict: "org_id,vehicle_id,started_at" });
    requireDatabaseSuccess(error, "park-session upsert");
  }

  const reconciliation = await reconcileCapabilityRows(
    admin,
    orgId,
    vehicleId,
    startIso,
    endIso,
    orgTz,
    engDays,
    sessions,
  );
  const statesIdleSec = Math.round(sessions.reduce((acc, s) => acc + s.idleSec, 0));
  if (skipVehicleLearning) {
    // Historical backfill slice: the day/session HISTORY above is the payload; the truck's CURRENT
    // capability columns stay owned by the latest-window sync (see the opts doc on syncIdleCapabilities).
    return {
      learned: 0,
      engineDays: engDays.length,
      parkSessions: parkRows.length,
      staleEngineDaysDeleted: reconciliation.staleEngineDaysDeleted,
      staleParkSessionsDeleted: reconciliation.staleParkSessionsDeleted,
    };
  }
  const { error: vehicleUpdateError } = await admin
    .from("vehicles")
    .update({
      idle_capability: cap.capability,
      idle_optimized_pct: cap.optimizedPct,
      idle_states_sec: statesIdleSec,
      idle_states_window_days: days,
      idle_states_at: nowIso,
      idle_observed_mode: vehicleEvidence.observedMode,
      idle_evidence_status: vehicleEvidence.evidenceStatus,
      idle_evidence_sessions: vehicleEvidence.sessions,
      idle_evidence_parked_sec: vehicleEvidence.parkedSec,
      idle_evidence_state_samples: vehicleEvidence.stateSampleCount,
      idle_evidence_gps_state_samples: vehicleEvidence.gpsStateSampleCount,
      idle_evidence_confidence: vehicleEvidence.confidence,
      idle_evidence_version: vehicleEvidence.evidenceVersion,
      idle_evidence_at: nowIso,
    })
    .eq("id", vehicleId)
    .eq("org_id", orgId);
  requireDatabaseSuccess(vehicleUpdateError, "vehicle capability update");
  return {
    learned: cap.capability === "unknown" ? 0 : 1,
    engineDays: engDays.length,
    parkSessions: parkRows.length,
    staleEngineDaysDeleted: reconciliation.staleEngineDaysDeleted,
    staleParkSessionsDeleted: reconciliation.staleParkSessionsDeleted,
  };
}

/**
 * Learn each truck's idle CAPABILITY (apu / ecu_optimized / continuous_only) from its engineStates history,
 * so the driver idle score can be fair. Pulls engineStates+gps over a window, builds park sessions, and stores
 * the learned capability + optimized-idle % on the vehicle. A source or database failure is surfaced to the
 * owning job; derived-row reconciliation never runs after an incomplete source read.
 */
export async function syncIdleCapabilities(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: {
    sinceDays?: number;
    /** Window end (default now) — set by the chunked backfill for explicit historical slices. */
    endIso?: string;
    /**
     * Skip the vehicle-level capability/evidence write (idle_capability, idle_states_*, idle_evidence_*).
     * The chunked backfill sets this on every HISTORICAL slice: those columns describe the truck's
     * CURRENT behavior window, and letting a months-old slice overwrite them would regress the fleet's
     * learned capabilities until the final slice ran. Engine-days / park-session rows (day-keyed,
     * window-scoped reconciliation) are still written — they are the history being backfilled.
     */
    skipVehicleLearning?: boolean;
    engineStatesFetcher?: EngineStatesFetcher;
  } = {},
): Promise<IdleCapabilityResult> {
  const token = await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();

  const { data: vs } = await admin
    .from("vehicles")
    .select("id, samsara_vehicle_id")
    .eq("org_id", orgId)
    .not("samsara_vehicle_id", "is", null);
  const vehicles = (vs ?? []) as VehicleRow[];
  if (vehicles.length === 0) {
    return {
      vehicles: 0,
      learned: 0,
      engineDays: 0,
      parkSessions: 0,
      vehiclesWithData: 0,
      vehiclesWithoutData: 0,
      staleEngineDaysDeleted: 0,
      staleParkSessionsDeleted: 0,
      batches: 0,
    };
  }

  // Fleet-local day boundary: bucket engine-days on the org's operating timezone (DST-correct), so "a day" is
  // the fleet's clock, not UTC. Mirrors driverScoreSync / dashboard; same "America/Chicago" default.
  const { data: orgRow } = await admin
    .from("organizations")
    .select("operating_hours")
    .eq("id", orgId)
    .maybeSingle();
  const orgTz = organizationTimezone(orgRow?.operating_hours);

  const days = opts.sinceDays ?? IDLE_SOURCE_WINDOW_DAYS;
  const endMs = opts.endIso != null ? Date.parse(opts.endIso) : Date.now();
  if (!Number.isFinite(endMs))
    throw new RangeError("Idle capability endIso must be a valid ISO timestamp");
  const endIso = new Date(endMs).toISOString();
  const startIso = new Date(endMs - days * 86_400_000).toISOString();
  const fetcher = opts.engineStatesFetcher ?? makeSamsaraEngineStatesFetcher(env, token);
  let learned = 0;
  let engineDays = 0;
  let parkSessions = 0;
  let vehiclesWithData = 0;
  let vehiclesWithoutData = 0;
  let staleEngineDaysDeleted = 0;
  let staleParkSessionsDeleted = 0;
  let batches = 0;
  const nowIso = new Date().toISOString();
  for (let i = 0; i < vehicles.length; i += BATCH) {
    const batch = vehicles.slice(i, i + BATCH);
    const fetched = await fetcher(
      batch.map((v) => v.samsara_vehicle_id),
      startIso,
      endIso,
    );
    if (!fetched.complete) {
      throw new Error(
        `Samsara engine-states history was truncated after ${fetched.pages} pages for org ${orgId}; derived rows were not reconciled`,
      );
    }
    const series = parseEngineStates(fetched);
    batches += 1;
    for (const vehicle of batch) {
      const samples = series.get(vehicle.samsara_vehicle_id) ?? [];
      if (samples.length > 0) vehiclesWithData += 1;
      else vehiclesWithoutData += 1;

      const result = await syncIdleVehicle(
        admin,
        orgId,
        vehicle,
        samples,
        orgTz,
        startIso,
        endIso,
        days,
        nowIso,
        opts.skipVehicleLearning === true,
      );
      learned += result.learned;
      engineDays += result.engineDays;
      parkSessions += result.parkSessions;
      staleEngineDaysDeleted += result.staleEngineDaysDeleted;
      staleParkSessionsDeleted += result.staleParkSessionsDeleted;
    }
  }
  return {
    vehicles: vehicles.length,
    learned,
    engineDays,
    parkSessions,
    vehiclesWithData,
    vehiclesWithoutData,
    staleEngineDaysDeleted,
    staleParkSessionsDeleted,
    batches,
  };
}
