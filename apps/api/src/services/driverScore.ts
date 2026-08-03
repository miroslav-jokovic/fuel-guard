import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_PERFORMANCE_SETTINGS,
  type MeScoreResponse,
  type MeScoreWeek,
  type PerformanceWeightsView,
} from "@fuelguard/shared";

/**
 * The signed-in driver's own frozen weekly grades (Driver App Phase 5). Read with the service role and
 * a minimal per-driver projection precisely so RLS can stay closed on the leaderboard: a driver sees
 * their own settled weeks and, per week, HOW MANY drivers were ranked — never who or what they scored.
 * That cohort count is the one fact `dpw_driver_scope` would deny the driver directly, so the API is the
 * only place "rank #4 of 23" can be assembled without leaking a single other row.
 */

// One string LITERAL (not a `+` concatenation) so supabase-js infers the row shape instead of widening
// the select to `string` and typing the result as GenericStringError[].
const DPW_COLUMNS =
  "week_start, week_end, safety_score, efficiency_score, idle_score, safety_pct, efficiency_pct, idle_pct, week_final, trailing_final, drive_distance_mi, drive_time_hours, eligible, ineligible_reason, rank, is_winner, weights_used";

interface DpwRow {
  week_start: string;
  week_end: string;
  safety_score: number | string | null;
  efficiency_score: number | string | null;
  idle_score: number | string | null;
  safety_pct: number | string | null;
  efficiency_pct: number | string | null;
  idle_pct: number | string | null;
  week_final: number | string | null;
  trailing_final: number | string | null;
  drive_distance_mi: number | string | null;
  drive_time_hours: number | string | null;
  eligible: boolean;
  ineligible_reason: string | null;
  rank: number | null;
  is_winner: boolean;
  weights_used: unknown;
}

const numOrNull = (v: number | string | null): number | null =>
  v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null;

/** Coerce a stored weights_used jsonb into the view weights, falling back to configured defaults. */
function resolveWeights(raw: unknown): PerformanceWeightsView {
  const d = DEFAULT_PERFORMANCE_SETTINGS.weights;
  const w = (raw ?? null) as { safety?: unknown; efficiency?: unknown; idling?: unknown } | null;
  const pick = (v: unknown, fallback: number): number =>
    v != null && Number.isFinite(Number(v)) ? Number(v) : fallback;
  return {
    safety: pick(w?.safety, d.safety),
    efficiency: pick(w?.efficiency, d.efficiency),
    idling: pick(w?.idling, d.idling),
  };
}

export async function getDriverScore(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<MeScoreResponse> {
  const { data, error } = await admin
    .from("driver_performance_weeks")
    .select(DPW_COLUMNS)
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .order("week_start", { ascending: false })
    .limit(8);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as DpwRow[];

  if (rows.length === 0) {
    return { weeks: [], weights: DEFAULT_PERFORMANCE_SETTINGS.weights };
  }

  // Cohort size = ranked (eligible) drivers that week. One HEAD count per returned week, in parallel;
  // ≤8 tiny queries and no assumption about fleet size (a single row select could hit PostgREST's cap).
  const weekStarts = [...new Set(rows.map((r) => r.week_start))];
  const cohortEntries = await Promise.all(
    weekStarts.map(async (ws): Promise<[string, number | null]> => {
      const { count, error: cErr } = await admin
        .from("driver_performance_weeks")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("week_start", ws)
        .not("rank", "is", null);
      return [ws, cErr ? null : (count ?? null)];
    }),
  );
  const cohortByWeek = new Map(cohortEntries);

  const weeks: MeScoreWeek[] = rows.map((r) => ({
    week_start: r.week_start,
    week_end: r.week_end,
    safety_score: numOrNull(r.safety_score),
    efficiency_score: numOrNull(r.efficiency_score),
    idle_score: numOrNull(r.idle_score),
    safety_pct: numOrNull(r.safety_pct),
    efficiency_pct: numOrNull(r.efficiency_pct),
    idle_pct: numOrNull(r.idle_pct),
    week_final: numOrNull(r.week_final),
    trailing_final: numOrNull(r.trailing_final),
    drive_distance_mi: numOrNull(r.drive_distance_mi),
    drive_time_hours: numOrNull(r.drive_time_hours),
    eligible: r.eligible,
    ineligible_reason: r.ineligible_reason,
    rank: r.rank,
    is_winner: r.is_winner,
    cohort_size: cohortByWeek.get(r.week_start) ?? null,
  }));

  return { weeks, weights: resolveWeights(rows[0]?.weights_used) };
}
