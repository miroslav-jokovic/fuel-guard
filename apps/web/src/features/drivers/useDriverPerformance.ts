import { useQuery } from "@tanstack/vue-query";
import {
  aggregateDriverIdle,
  combineWeek,
  rankTrailing,
  recentWeeks,
  resolvePerformanceConfig,
  type DriverWeekInput,
  type IdleClassification,
  type IdleRow,
  type WeekLeaderboard,
} from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";

/** One row shown on the leaderboard — eligible drivers carry a rank; ineligible ones are listed below. */
export interface PerformanceDisplayRow {
  driverId: string;
  driverName: string | null;
  rank: number | null;
  trailingFinal: number | null;
  weekFinal: number | null;
  isWinner: boolean;
  safetyScore: number | null;
  efficiencyScore: number | null;
  idleScore: number | null;
  safetyPct: number | null;
  efficiencyPct: number | null;
  idlePct: number | null;
  miles: number | null;
  driveHours: number | null;
  eligible: boolean;
  ineligibleReason: string | null;
}

export interface DriverPerformanceView {
  weekStart: string;
  weekEnd: string;
  methodUsed: string;
  rows: PerformanceDisplayRow[];
  winners: PerformanceDisplayRow[];
  coverage: { safety: number; efficiency: number; idling: number };
  eligibleCount: number;
  trailingWeeks: number;
  weights: { safety: number; efficiency: number; idling: number };
}

interface ScoreRow {
  driver_id: string;
  week_start: string;
  safety_score: number | null;
  efficiency_score: number | null;
  drive_distance_mi: number | null;
  drive_time_hours: number | null;
  engine_on_hours: number | null;
}
interface IdleRowRaw {
  driver_id: string | null;
  started_at: string;
  duration_sec: number | string;
  classification: string;
  fuel_gal: number | string | null;
  idle_gal: number | string | null;
  cost_usd: number | string | null;
}

/**
 * The live current-week driver-performance leaderboard: reads driver_scores (trailing weeks) + idle_events +
 * settings and runs the SAME shared combine/rank the settled snapshot uses, so "this week (live)" matches the
 * frozen record once the week settles. Read-only; the heavy lifting is the shared pure functions.
 */
export function useDriverPerformance() {
  return useQuery({
    queryKey: ["driver_performance_current"],
    queryFn: async (): Promise<DriverPerformanceView> => {
      const [{ data: settingsRow }, { data: orgRow }] = await Promise.all([
        supabase.from("driver_performance_settings").select("*").maybeSingle(),
        supabase.from("organizations").select("operating_hours").maybeSingle(),
      ]);
      const orgTz = (orgRow?.operating_hours as { tz?: string } | null)?.tz ?? "America/Chicago";
      const cfg = resolvePerformanceConfig(settingsRow, orgTz);
      const now = Date.now();
      const weeks = recentWeeks(now, cfg.weekTimezone, cfg.settings.trailingWeeks, cfg.weekStartsOn);
      const weekStarts = weeks.map((w) => w.weekStart);
      const current = weeks[0]!;
      const oldest = weeks[weeks.length - 1]!;

      const { data: scoresData, error: se } = await supabase
        .from("driver_scores")
        .select("driver_id, week_start, safety_score, efficiency_score, drive_distance_mi, drive_time_hours, engine_on_hours")
        .in("week_start", weekStarts);
      if (se) throw new Error(se.message);
      const scores = (scoresData ?? []) as ScoreRow[];

      // Paginate: idle_events far exceeds PostgREST's 1000-row cap over a multi-week window, so a single
      // select silently drops most events (and the entire current week), leaving idle blank for everyone.
      // Loop like the Idling page (useIdleScores) so every in-window event is loaded.
      const IDLE_PAGE = 1000;
      const idleAll: IdleRowRaw[] = [];
      for (let offset = 0; ; offset += IDLE_PAGE) {
        const { data: idleData, error: ie } = await supabase
          .from("idle_events")
          .select("driver_id, started_at, duration_sec, classification, fuel_gal, idle_gal, cost_usd")
          .gte("started_at", oldest.windowStartIso)
          .lt("started_at", current.windowEndIso)
          .order("started_at", { ascending: false })
          .range(offset, offset + IDLE_PAGE - 1);
        if (ie) throw new Error(ie.message);
        const batch = (idleData ?? []) as IdleRowRaw[];
        idleAll.push(...batch);
        if (batch.length < IDLE_PAGE) break;
      }

      const { data: driversData } = await supabase.from("drivers").select("id, full_name");
      const nameMap = new Map(
        ((driversData ?? []) as { id: string; full_name: string }[]).map((d) => [d.id, d.full_name]),
      );

      const idleScoreForWeek = (startIso: string, endIso: string): Map<string, { score: number; discretionaryHours: number; totalIdleHours: number }> => {
        const startMs = Date.parse(startIso);
        const endMs = Date.parse(endIso);
        const rows: IdleRow[] = idleAll
          .filter((r) => {
            if (!r.driver_id) return false;
            const t = Date.parse(r.started_at);
            return t >= startMs && t < endMs;
          })
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
        const m = new Map<string, { score: number; discretionaryHours: number; totalIdleHours: number }>();
        for (const d of aggregateDriverIdle(rows).drivers)
          if (d.driverId !== "__unattributed__")
            m.set(d.driverId, { score: d.score, discretionaryHours: d.discretionaryHours, totalIdleHours: d.totalIdleHours });
        return m;
      };

      const lbs: WeekLeaderboard[] = weeks.map((w) => {
        const idle = idleScoreForWeek(w.windowStartIso, w.windowEndIso);
        const inputs: DriverWeekInput[] = scores
          .filter((s) => s.week_start === w.weekStart)
          .map((r) => {
            const ir = idle.get(r.driver_id) ?? null;
            const totalIdle = ir?.totalIdleHours ?? 0;
            return {
              driverId: r.driver_id,
              driverName: nameMap.get(r.driver_id) ?? null,
              safetyScore: r.safety_score,
              efficiencyScore: cfg.efficiencyEnabled ? r.efficiency_score : null,
              idleScore: ir?.score ?? null, // absent handled in combineWeek (clean driver → perfect; feed down → missing)
              idleDiscretionaryHours: ir?.discretionaryHours ?? null,
              engineOnHours: r.engine_on_hours ?? ((r.drive_time_hours ?? 0) + totalIdle),
              miles: r.drive_distance_mi,
              driveHours: r.engine_on_hours ?? r.drive_time_hours,
            };
          });
        return combineWeek(inputs, cfg.settings);
      });

      const ranked = rankTrailing(lbs, cfg.settings);
      const rankByDriver = new Map(ranked.map((r) => [r.driverId, r]));
      const curLb = lbs[0]!;

      const rows: PerformanceDisplayRow[] = curLb.rows
        .map((r) => {
          const rk = rankByDriver.get(r.driverId);
          return {
            driverId: r.driverId,
            driverName: r.driverName,
            rank: rk?.rank ?? null,
            trailingFinal: rk?.trailingFinal ?? null,
            weekFinal: r.weekFinal,
            isWinner: rk?.isWinner ?? false,
            safetyScore: r.safetyScore,
            efficiencyScore: r.efficiencyScore,
            idleScore: r.idleScore,
            safetyPct: r.safetyPct,
            efficiencyPct: r.efficiencyPct,
            idlePct: r.idlePct,
            miles: r.miles,
            driveHours: r.driveHours,
            eligible: r.eligible,
            ineligibleReason: r.ineligibleReason,
          };
        })
        .sort((a, b) => {
          if (a.rank != null && b.rank != null) return a.rank - b.rank;
          if (a.rank != null) return -1;
          if (b.rank != null) return 1;
          return (b.weekFinal ?? -1) - (a.weekFinal ?? -1) || (a.driverName ?? "").localeCompare(b.driverName ?? "");
        });

      return {
        weekStart: current.weekStart,
        weekEnd: current.weekEnd,
        methodUsed: curLb.methodUsed,
        rows,
        winners: rows.filter((r) => r.isWinner),
        coverage: curLb.coverage,
        eligibleCount: curLb.eligibleCount,
        trailingWeeks: cfg.settings.trailingWeeks,
        weights: cfg.settings.weights,
      };
    },
    refetchInterval: 120_000,
  });
}
