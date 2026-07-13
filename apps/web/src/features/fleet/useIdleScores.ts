import { useQuery } from "@tanstack/vue-query";
import {
  aggregateDriverIdle,
  type IdleRow,
  type IdleSummary,
  type IdleClassification,
} from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";

const PAGE = 1000;
const WINDOW_DAYS = 30;

interface RawIdleRow {
  driver_id: string | null;
  started_at: string;
  duration_sec: number | string;
  classification: string;
  fuel_gal: number | string | null;
  idle_gal: number | string | null;
  cost_usd: number | string | null;
  drivers: { full_name: string } | null;
}

/**
 * Load the last WINDOW_DAYS of idle events (RLS-scoped) and aggregate into the driver leaderboard + fleet
 * idle-$ summary. Read-only; never writes. The heavy lifting is the shared pure aggregator.
 */
export function useIdleScores() {
  return useQuery({
    queryKey: ["idle_scores"],
    queryFn: async (): Promise<IdleSummary> => {
      const from = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
      const rows: IdleRow[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from("idle_events")
          .select(
            "driver_id, started_at, duration_sec, classification, fuel_gal, idle_gal, cost_usd, drivers(full_name)",
          )
          .gte("started_at", from)
          .order("started_at", { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as unknown as RawIdleRow[];
        for (const r of batch) {
          rows.push({
            driverId: r.driver_id,
            driverName: r.drivers?.full_name ?? null,
            startedAt: r.started_at,
            durationSec: Number(r.duration_sec),
            classification: r.classification as IdleClassification,
            fuelGal: r.fuel_gal == null ? null : Number(r.fuel_gal),
            idleGal: r.idle_gal == null ? null : Number(r.idle_gal),
            costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
          });
        }
        if (batch.length < PAGE) break;
      }
      return aggregateDriverIdle(rows);
    },
    refetchInterval: 120_000,
  });
}
