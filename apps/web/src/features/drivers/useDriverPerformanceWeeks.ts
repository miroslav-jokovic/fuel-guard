import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { supabase } from "@/lib/supabase";

export interface FrozenWeek {
  weekStart: string;
  weekEnd: string;
}

/** A frozen per-driver row from a settled week (driver_performance_weeks). */
export interface PerformanceWeekRow {
  driver_id: string | null;
  driver_name: string | null;
  safety_score: number | null;
  efficiency_score: number | null;
  idle_score: number | null;
  safety_pct: number | null;
  efficiency_pct: number | null;
  idle_pct: number | null;
  week_final: number | null;
  trailing_final: number | null;
  drive_distance_mi: number | null;
  drive_time_hours: number | null;
  eligible: boolean;
  ineligible_reason: string | null;
  rank: number | null;
  is_winner: boolean;
  method_used: string | null;
}

/** Distinct settled weeks (most recent first) available in the rewards ledger. */
export function useDriverPerformanceWeeksList() {
  return useQuery({
    queryKey: ["driver_performance_weeks_list"],
    queryFn: async (): Promise<FrozenWeek[]> => {
      const { data, error } = await supabase
        .from("driver_performance_weeks")
        .select("week_start, week_end")
        .order("week_start", { ascending: false });
      if (error) throw new Error(error.message);
      const seen = new Set<string>();
      const out: FrozenWeek[] = [];
      for (const r of (data ?? []) as { week_start: string; week_end: string }[]) {
        if (!seen.has(r.week_start)) {
          seen.add(r.week_start);
          out.push({ weekStart: r.week_start, weekEnd: r.week_end });
        }
      }
      return out;
    },
  });
}

/** The frozen leaderboard for one settled week (null → query disabled). */
export function useDriverPerformanceWeek(weekStart: Ref<string | null>) {
  return useQuery({
    queryKey: ["driver_performance_week", weekStart],
    enabled: computed(() => !!weekStart.value),
    queryFn: async (): Promise<PerformanceWeekRow[]> => {
      const { data, error } = await supabase
        .from("driver_performance_weeks")
        .select(
          "driver_id, driver_name, safety_score, efficiency_score, idle_score, safety_pct, efficiency_pct, idle_pct, week_final, trailing_final, drive_distance_mi, drive_time_hours, eligible, ineligible_reason, rank, is_winner, method_used",
        )
        .eq("week_start", weekStart.value!)
        .order("rank", { ascending: true, nullsFirst: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as PerformanceWeekRow[];
    },
  });
}
