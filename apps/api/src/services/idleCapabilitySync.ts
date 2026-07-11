import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEngineStates, buildIdleSessions, learnIdleCapability } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { makeSamsaraEngineStatesFetcher } from "../lib/samsara.js";
import { NoSamsaraTokenError } from "./samsaraVehicleSync.js";

export interface IdleCapabilityResult {
  vehicles: number;
  learned: number; // trucks we could classify (not 'unknown')
}

/** Trucks per engineStates call (comma-separated vehicleIds), keeps each request bounded. */
const BATCH = 20;

/**
 * Learn each truck's idle CAPABILITY (apu / ecu_optimized / continuous_only) from its engineStates history,
 * so the driver idle score can be fair. Pulls engineStates+gps over a window, builds park sessions, and stores
 * the learned capability + optimized-idle % on the vehicle. Best-effort; a 401 means the token lacks the
 * Read Vehicle Statistics scope.
 */
export async function syncIdleCapabilities(admin: SupabaseClient, env: Env, orgId: string, opts: { sinceDays?: number } = {}): Promise<IdleCapabilityResult> {
  const token = await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();

  const { data: vs } = await admin.from("vehicles").select("id, samsara_vehicle_id").eq("org_id", orgId).not("samsara_vehicle_id", "is", null);
  const vehicles = (vs ?? []) as { id: string; samsara_vehicle_id: string }[];
  if (vehicles.length === 0) return { vehicles: 0, learned: 0 };

  const days = opts.sinceDays ?? 14;
  const endIso = new Date().toISOString();
  const startIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const fetcher = makeSamsaraEngineStatesFetcher(env, token);
  const idBySamsara = new Map(vehicles.map((v) => [v.samsara_vehicle_id, v.id]));

  let learned = 0;
  for (let i = 0; i < vehicles.length; i += BATCH) {
    const batch = vehicles.slice(i, i + BATCH);
    const series = parseEngineStates(await fetcher(batch.map((v) => v.samsara_vehicle_id), startIso, endIso));
    for (const [samsaraId, samples] of series) {
      const vehicleId = idBySamsara.get(samsaraId);
      if (!vehicleId) continue;
      const sessions = buildIdleSessions(samples);
      const cap = learnIdleCapability(sessions);
      // Always write the result — including "unknown" (insufficient park sessions). Previously we skipped
      // unknown, so a truck with too little engine-state data was left NULL and vanished from the capability
      // table entirely (audit A1.1). Writing "unknown" keeps every synced truck visible with an honest
      // data-sufficiency state instead of silently hiding it.
      await admin.from("vehicles").update({ idle_capability: cap.capability, idle_optimized_pct: cap.optimizedPct }).eq("id", vehicleId).eq("org_id", orgId);
      if (cap.capability !== "unknown") learned += 1;
    }
  }
  return { vehicles: vehicles.length, learned };
}
