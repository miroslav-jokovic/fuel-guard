import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEngineStates, buildIdleSessions, learnIdleCapability, aggregateEngineDays } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { makeSamsaraEngineStatesFetcher } from "../lib/samsara.js";
import { NoSamsaraTokenError } from "./samsaraVehicleSync.js";

export interface IdleCapabilityResult {
  vehicles: number;
  learned: number; // trucks we could classify (not 'unknown')
  engineDays: number; // per-truck/day engine-time rows written
  parkSessions: number; // park sessions written
}

/** Trucks per engineStates call (comma-separated vehicleIds), keeps each request bounded. */
const BATCH = 20;

/**
 * Learn each truck's idle CAPABILITY (apu / ecu_optimized / continuous_only) from its engineStates history,
 * so the driver idle score can be fair. Pulls engineStates+gps over a window, builds park sessions, and stores
 * the learned capability + optimized-idle % on the vehicle. Best-effort; a 401 means the token lacks the
 * Read Vehicle Statistics scope.
 */
export async function syncIdleCapabilities(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: { sinceDays?: number } = {},
): Promise<IdleCapabilityResult> {
  const token = await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();

  const { data: vs } = await admin
    .from("vehicles")
    .select("id, samsara_vehicle_id")
    .eq("org_id", orgId)
    .not("samsara_vehicle_id", "is", null);
  const vehicles = (vs ?? []) as { id: string; samsara_vehicle_id: string }[];
  if (vehicles.length === 0) return { vehicles: 0, learned: 0, engineDays: 0, parkSessions: 0 };

  const days = opts.sinceDays ?? 30;
  const endIso = new Date().toISOString();
  const startIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const fetcher = makeSamsaraEngineStatesFetcher(env, token);
  const idBySamsara = new Map(vehicles.map((v) => [v.samsara_vehicle_id, v.id]));

  let learned = 0;
  let engineDays = 0;
  let parkSessions = 0;
  const nowIso = new Date().toISOString();
  for (let i = 0; i < vehicles.length; i += BATCH) {
    const batch = vehicles.slice(i, i + BATCH);
    const series = parseEngineStates(
      await fetcher(
        batch.map((v) => v.samsara_vehicle_id),
        startIso,
        endIso,
      ),
    );
    for (const [samsaraId, samples] of series) {
      const vehicleId = idBySamsara.get(samsaraId);
      if (!vehicleId) continue;
      const sessions = buildIdleSessions(samples);
      const cap = learnIdleCapability(sessions);

      // Foundation: persist the per-day engine-time split (drive/idle/off/coverage) and each classified park
      // session, from THIS same engineStates pass, so the avoidable module reads stored facts (no re-fetch).
      // tz_offset_minutes 0 = UTC day boundaries for now (a fleet-local boundary can be introduced later).
      const engDays = aggregateEngineDays(samples).map((d) => ({
        org_id: orgId,
        vehicle_id: vehicleId,
        day: d.day,
        drive_sec: d.driveSec,
        idle_sec: d.idleSec,
        off_sec: d.offSec,
        coverage_sec: d.coverageSec,
        tz_offset_minutes: 0,
        synced_at: nowIso,
      }));
      if (engDays.length) {
        const { error } = await admin
          .from("vehicle_engine_days")
          .upsert(engDays, { onConflict: "org_id,vehicle_id,day" });
        if (!error) engineDays += engDays.length;
      }
      const parkRows = sessions.map((s) => ({
        org_id: orgId,
        vehicle_id: vehicleId,
        started_at: new Date(s.startMs).toISOString(),
        ended_at: new Date(s.endMs).toISOString(),
        duration_sec: s.durationSec,
        idle_sec: s.idleSec,
        off_sec: s.offSec,
        cycles: s.cycles,
        mode: s.mode,
        synced_at: nowIso,
      }));
      if (parkRows.length) {
        const { error } = await admin
          .from("idle_park_sessions")
          .upsert(parkRows, { onConflict: "org_id,vehicle_id,started_at" });
        if (!error) parkSessions += parkRows.length;
      }

      // CP6: independent idle measure — total engine-on idle seconds from the raw engine-state sessions, stored
      // to cross-validate against the Samsara idle-events total on the Data Confidence panel.
      const statesIdleSec = Math.round(sessions.reduce((acc, s) => acc + s.idleSec, 0));
      // Always write the result — including "unknown" (insufficient park sessions). Previously we skipped
      // unknown, so a truck with too little engine-state data was left NULL and vanished from the capability
      // table entirely (audit A1.1). Writing "unknown" keeps every synced truck visible with an honest
      // data-sufficiency state instead of silently hiding it.
      await admin
        .from("vehicles")
        .update({
          idle_capability: cap.capability,
          idle_optimized_pct: cap.optimizedPct,
          idle_states_sec: statesIdleSec,
          idle_states_window_days: days,
          idle_states_at: new Date().toISOString(),
        })
        .eq("id", vehicleId)
        .eq("org_id", orgId);
      if (cap.capability !== "unknown") learned += 1;
    }
  }
  return { vehicles: vehicles.length, learned, engineDays, parkSessions };
}
