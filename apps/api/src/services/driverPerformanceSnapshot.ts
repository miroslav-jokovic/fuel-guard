import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aggregateDriverIdle,
  combineWeek,
  rankTrailing,
  recentWeeks,
  resolvePerformanceConfig,
  type DriverWeekInput,
  type IdleClassification,
  type IdleRow,
  type ResolvedPerformanceConfig,
  type WeekLeaderboard,
  type WeekWindow,
} from "@fuelguard/shared";
import type { Env } from "../env.js";

const HOUR = 3_600_000;

interface ScoreRow {
  driver_id: string;
  safety_score: number | null;
  efficiency_score: number | null;
  drive_distance_mi: number | null;
  drive_time_hours: number | null;
  engine_on_hours: number | null;
}
interface IdleEventRow {
  driver_id: string | null;
  duration_sec: number | string;
  classification: string;
  fuel_gal: number | string | null;
  idle_gal: number | string | null;
  cost_usd: number | string | null;
  started_at: string;
}

/** Per-driver weekly idle score (0–100, higher = better) from idle_events in the week window. */
async function idleScoresForWindow(
  admin: SupabaseClient,
  orgId: string,
  wk: WeekWindow,
): Promise<Map<string, number>> {
  const { data } = await admin
    .from("idle_events")
    .select("driver_id, duration_sec, classification, fuel_gal, idle_gal, cost_usd, started_at")
    .eq("org_id", orgId)
    .gte("started_at", wk.windowStartIso)
    .lt("started_at", wk.windowEndIso);
  const rows: IdleRow[] = ((data ?? []) as IdleEventRow[])
    .filter((r) => r.driver_id)
    .map((r) => ({
      driverId: r.driver_id,
      driverName: null,
      durationSec: Number(r.duration_sec),
      classification: r.classification as IdleClassification,
      fuelGal: r.fuel_gal == null ? null : Number(r.fuel_gal),
      idleGal: r.idle_gal == null ? null : Number(r.idle_gal),
      costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
      startedAt: r.started_at,
    }));
  const summary = aggregateDriverIdle(rows);
  const m = new Map<string, number>();
  for (const d of summary.drivers) if (d.driverId !== "__unattributed__") m.set(d.driverId, d.score);
  return m;
}

/** Build one week's leaderboard from driver_scores(week) + idle_events(week) via the shared combine. */
async function weekLeaderboard(
  admin: SupabaseClient,
  orgId: string,
  wk: WeekWindow,
  cfg: ResolvedPerformanceConfig,
): Promise<{ lb: WeekLeaderboard; scoreRows: Map<string, ScoreRow> }> {
  const { data } = await admin
    .from("driver_scores")
    .select("driver_id, safety_score, efficiency_score, drive_distance_mi, drive_time_hours, engine_on_hours")
    .eq("org_id", orgId)
    .eq("week_start", wk.weekStart);
  const scoreRows = new Map<string, ScoreRow>();
  for (const r of (data ?? []) as ScoreRow[]) scoreRows.set(r.driver_id, r);
  const idle = await idleScoresForWindow(admin, orgId, wk);
  const inputs: DriverWeekInput[] = [...scoreRows.values()].map((r) => ({
    driverId: r.driver_id,
    safetyScore: r.safety_score,
    efficiencyScore: cfg.efficiencyEnabled ? r.efficiency_score : null,
    // Eligible driver with drive activity but no scored idle events → no avoidable idle (100).
    idleScore: idle.get(r.driver_id) ?? 100,
    miles: r.drive_distance_mi,
    driveHours: r.engine_on_hours ?? r.drive_time_hours,
  }));
  return { lb: combineWeek(inputs, cfg.settings), scoreRows };
}

export interface SnapshotResult {
  weeksFrozen: string[];
  rowsWritten: number;
}

/**
 * Freeze every settled, not-yet-frozen week into driver_performance_weeks (the rewards ledger). A week is
 * settled once `now ≥ weekEnd + settle_hours` (clears Samsara's 72h efficiency lag). Each frozen week is
 * ranked on the trailing `trailing_weeks` window and the top `reward_top_n` eligible drivers are flagged
 * winners. Idempotent: existing frozen weeks are skipped; upsert on (org_id, week_start, driver_id).
 */
export async function snapshotSettledWeeks(
  admin: SupabaseClient,
  _env: Env,
  orgId: string,
  opts: { nowMs?: number; maxWeeks?: number } = {},
): Promise<SnapshotResult> {
  const now = opts.nowMs ?? Date.now();
  const [{ data: settingsRow }, { data: orgRow }] = await Promise.all([
    admin.from("driver_performance_settings").select("*").eq("org_id", orgId).maybeSingle(),
    admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle(),
  ]);
  const orgTz = (orgRow?.operating_hours as { tz?: string } | null | undefined)?.tz ?? "America/Chicago";
  const cfg = resolvePerformanceConfig(settingsRow, orgTz);
  const maxWeeks = opts.maxWeeks ?? 8;

  const weeks = recentWeeks(now, cfg.weekTimezone, maxWeeks + cfg.settings.trailingWeeks, cfg.weekStartsOn);
  const settledEligible = weeks.filter((w) => now >= Date.parse(w.windowEndIso) + cfg.settleHours * HOUR);

  const { data: frozenRows } = await admin
    .from("driver_performance_weeks")
    .select("week_start")
    .eq("org_id", orgId);
  const frozen = new Set(((frozenRows ?? []) as { week_start: string }[]).map((r) => r.week_start));
  const toFreeze = settledEligible.filter((w) => !frozen.has(w.weekStart)).slice(0, maxWeeks);

  const lbCache = new Map<string, { lb: WeekLeaderboard; scoreRows: Map<string, ScoreRow> }>();
  const getLb = async (w: WeekWindow) => {
    let v = lbCache.get(w.weekStart);
    if (!v) {
      v = await weekLeaderboard(admin, orgId, w, cfg);
      lbCache.set(w.weekStart, v);
    }
    return v;
  };

  const weeksFrozen: string[] = [];
  let rowsWritten = 0;

  for (const w0 of toFreeze) {
    const { lb: cur, scoreRows } = await getLb(w0);
    if (!cur.rows.length) continue;

    const i0 = weeks.findIndex((w) => w.weekStart === w0.weekStart);
    const windowWeeks = weeks.slice(i0, i0 + cfg.settings.trailingWeeks);
    const lbs: WeekLeaderboard[] = [];
    for (const w of windowWeeks) lbs.push((await getLb(w)).lb);
    const rankByDriver = new Map(rankTrailing(lbs, cfg.settings).map((r) => [r.driverId, r]));

    const ids = cur.rows.map((r) => r.driverId);
    const nameMap = new Map<string, string>();
    if (ids.length) {
      const { data: dn } = await admin.from("drivers").select("id, full_name").in("id", ids);
      for (const d of (dn ?? []) as { id: string; full_name: string }[]) nameMap.set(d.id, d.full_name);
    }

    const rows = cur.rows.map((r) => {
      const rk = rankByDriver.get(r.driverId);
      const sr = scoreRows.get(r.driverId);
      return {
        org_id: orgId,
        week_start: w0.weekStart,
        week_end: w0.weekEnd,
        driver_id: r.driverId,
        driver_name: nameMap.get(r.driverId) ?? null,
        safety_score: r.safetyScore,
        efficiency_score: r.efficiencyScore,
        idle_score: r.idleScore,
        safety_pct: r.safetyPct,
        efficiency_pct: r.efficiencyPct,
        idle_pct: r.idlePct,
        week_final: r.weekFinal,
        trailing_final: rk?.trailingFinal ?? null,
        drive_distance_mi: r.miles,
        drive_time_hours: sr?.drive_time_hours ?? r.driveHours,
        eligible: r.eligible,
        ineligible_reason: r.ineligibleReason,
        rank: rk?.rank ?? null,
        is_winner: rk?.isWinner ?? false,
        weights_used: cfg.settings.weights,
        method_used: cur.methodUsed,
        settled_at: new Date(now).toISOString(),
      };
    });

    const { error } = await admin
      .from("driver_performance_weeks")
      .upsert(rows, { onConflict: "org_id,week_start,driver_id" });
    if (error) throw new Error(error.message);
    rowsWritten += rows.length;
    weeksFrozen.push(w0.weekStart);
  }

  return { weeksFrozen, rowsWritten };
}
