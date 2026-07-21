import { type Ref, toValue } from "vue";
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

/** Date window for the idle views. Both bounds optional; unset `from` defaults to the last 30 days. */
export interface IdleDateFilter {
  from?: string; // ISO (inclusive)
  to?: string; // ISO (inclusive — pass an end-of-day time for a timestamp column)
}

interface RawIdleRow {
  driver_id: string | null;
  vehicle_id: string | null;
  started_at: string;
  duration_sec: number | string;
  classification: string;
  fuel_gal: number | string | null;
  idle_gal: number | string | null;
  cost_usd: number | string | null;
  drivers: { full_name: string } | null;
  vehicles: { unit_number: string } | null;
}

/** Default `from` when the caller hasn't set a range — preserves the historical last-30-days behavior. */
const defaultFrom = () => new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

/**
 * Load idle events in the selected date range (RLS-scoped) and aggregate into the driver leaderboard +
 * fleet idle-$ summary. Read-only; the heavy lifting is the shared pure aggregator.
 */
export function useIdleScores(filters: Ref<IdleDateFilter>) {
  return useQuery({
    queryKey: ["idle_scores", filters],
    queryFn: async (): Promise<IdleSummary> => {
      const f = toValue(filters);
      const fromIso = f.from ?? defaultFrom();
      const rows: IdleRow[] = [];
      for (let offset = 0; ; offset += PAGE) {
        let q = supabase
          .from("idle_events")
          .select(
            "driver_id, vehicle_id, started_at, duration_sec, classification, fuel_gal, idle_gal, cost_usd, drivers(full_name), vehicles(unit_number)",
          )
          .gte("started_at", fromIso)
          .order("started_at", { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (f.to) q = q.lte("started_at", f.to);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as unknown as RawIdleRow[];
        for (const r of batch) {
          rows.push({
            driverId: r.driver_id,
            driverName: r.drivers?.full_name ?? null,
            unitNumber: r.vehicles?.unit_number ?? null,
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
