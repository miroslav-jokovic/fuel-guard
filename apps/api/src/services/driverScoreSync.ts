import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseSafetyScores,
  parseDriverEfficiency,
  resolvePerformanceConfig,
  weekWindow,
  type SafetyScoreRow,
  type EfficiencyScoreRow,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import {
  makeSamsaraSafetyScoreFetcher,
  makeSamsaraDriverEfficiencyFetcher,
  type SamsaraSafetyScoreFetcher,
  type SamsaraDriverEfficiencyFetcher,
} from "../lib/samsara.js";
import { NoSamsaraTokenError } from "./samsaraVehicleSync.js";

export interface DriverScoreSyncResult {
  weekStart: string;
  drivers: number;
  safetyRows: number;
  efficiencyRows: number;
  safetyOk: boolean;
  efficiencyOk: boolean;
  upserted: number;
}

const HOUR = 3_600_000;
const floorHourIso = (ms: number) => new Date(Math.floor(ms / HOUR) * HOUR).toISOString();

/**
 * Pull the current week's Samsara Safety + Driver-Efficiency component scores for the org's drivers and upsert
 * them into driver_scores (one row per driver-week). Safety is REQUIRED (it carries exposure — miles/hours);
 * Efficiency is best-effort (beta — a 4xx / absent feed degrades to null, never fails the sync). Idempotent on
 * (org_id, driver_id, week_start). Fetchers are injectable for tests. (docs/16-DRIVER-PERFORMANCE.md)
 */
export async function syncDriverScores(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: {
    nowMs?: number;
    weekOffset?: number; // 0 = current week, 1 = last week, … (used by the snapshot to backfill a settled week)
    safetyFetcher?: SamsaraSafetyScoreFetcher;
    efficiencyFetcher?: SamsaraDriverEfficiencyFetcher;
  } = {},
): Promise<DriverScoreSyncResult> {
  const injected = Boolean(opts.safetyFetcher || opts.efficiencyFetcher);
  const token = injected ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();

  const [{ data: settingsRow }, { data: orgRow }] = await Promise.all([
    admin.from("driver_performance_settings").select("*").eq("org_id", orgId).maybeSingle(),
    admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle(),
  ]);
  const orgTz = (orgRow?.operating_hours as { tz?: string } | null | undefined)?.tz ?? "America/Chicago";
  const cfg = resolvePerformanceConfig(settingsRow, orgTz);
  const now = opts.nowMs ?? Date.now();
  const anchor = now - (opts.weekOffset ?? 0) * 7 * 24 * HOUR;
  const wk = weekWindow(anchor, cfg.weekTimezone, cfg.weekStartsOn);

  const { data: ds } = await admin
    .from("drivers")
    .select("id, samsara_driver_id, full_name")
    .eq("org_id", orgId)
    .not("samsara_driver_id", "is", null);
  const drivers = (ds ?? []) as { id: string; samsara_driver_id: string; full_name: string }[];
  const bySamsara = new Map(drivers.map((d) => [d.samsara_driver_id, d]));
  const driverIds = drivers.map((d) => d.samsara_driver_id);
  if (driverIds.length === 0) {
    return { weekStart: wk.weekStart, drivers: 0, safetyRows: 0, efficiencyRows: 0, safetyOk: false, efficiencyOk: false, upserted: 0 };
  }

  const startMs = Date.parse(wk.windowStartIso);
  const startIso = wk.windowStartIso;
  // Safety window ends at min(week end, now). Efficiency requires end ≤3h before now + hour-truncation, and
  // start ≥1 day before end — clamp accordingly (and skip efficiency when the valid window is < 1 day).
  const safetyEndIso = floorHourIso(Math.min(Date.parse(wk.windowEndIso), now));
  const effEndMs = Math.min(Date.parse(wk.windowEndIso), now - 4 * HOUR);
  const efficiencyEndIso = floorHourIso(effEndMs);

  const safetyFetch = opts.safetyFetcher ?? makeSamsaraSafetyScoreFetcher(env, token);
  const efficiencyFetch =
    opts.efficiencyFetcher ??
    (cfg.efficiencyEnabled ? makeSamsaraDriverEfficiencyFetcher(env, token) : null);

  let safety: SafetyScoreRow[] = [];
  let safetyOk = false;
  try {
    safety = parseSafetyScores(await safetyFetch(startIso, safetyEndIso, driverIds));
    safetyOk = true;
  } catch (e) {
    console.error("[driver-scores] safety fetch failed:", e instanceof Error ? e.message : e);
  }

  let efficiency: EfficiencyScoreRow[] = [];
  let efficiencyOk = false;
  if (efficiencyFetch && effEndMs - startMs >= 24 * HOUR) {
    try {
      efficiency = parseDriverEfficiency(await efficiencyFetch(startIso, efficiencyEndIso, driverIds));
      efficiencyOk = true;
    } catch (e) {
      console.error("[driver-scores] efficiency fetch failed (degrading):", e instanceof Error ? e.message : e);
    }
  }
  const effBySamsara = new Map(efficiency.map((e) => [e.samsaraDriverId, e]));

  const syncedAt = new Date(now).toISOString();
  const rows = safety
    .filter((s) => bySamsara.has(s.samsaraDriverId))
    .map((s) => {
      const d = bySamsara.get(s.samsaraDriverId)!;
      const eff = effBySamsara.get(s.samsaraDriverId);
      return {
        org_id: orgId,
        driver_id: d.id,
        samsara_driver_id: s.samsaraDriverId,
        week_start: wk.weekStart,
        week_end: wk.weekEnd,
        window_start: startIso,
        window_end: safetyEndIso,
        safety_score: s.safetyScore,
        drive_distance_mi: s.driveDistanceMi,
        drive_time_hours: s.driveTimeHours,
        harsh_accel_count: s.harshAccelCount,
        harsh_brake_count: s.harshBrakeCount,
        harsh_turn_count: s.harshTurnCount,
        crash_count: s.crashCount,
        speeding_ms: s.speedingMs,
        safety_raw: { behaviors: s.behaviorsRaw, speeding: s.speedingRaw },
        efficiency_score: eff?.efficiencyScore ?? null,
        efficiency_grade_letter: eff?.efficiencyGradeLetter ?? null,
        engine_on_hours: eff?.engineOnHours ?? null,
        idling_pct: eff?.idlingPct ?? null,
        efficiency_raw: eff?.raw ?? null,
        synced_at: syncedAt,
      };
    });

  let upserted = 0;
  if (rows.length) {
    const { error } = await admin
      .from("driver_scores")
      .upsert(rows, { onConflict: "org_id,driver_id,week_start" });
    if (error) throw new Error(error.message);
    upserted = rows.length;
  }

  return {
    weekStart: wk.weekStart,
    drivers: drivers.length,
    safetyRows: safety.length,
    efficiencyRows: efficiency.length,
    safetyOk,
    efficiencyOk,
    upserted,
  };
}
