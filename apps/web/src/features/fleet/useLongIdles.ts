import { useQuery } from "@tanstack/vue-query";
import {
  topAvoidableIdles,
  type LongIdleInput,
  type LongIdleRow,
  type IdleClassification,
} from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";

const PAGE = 1000;
const WINDOW_DAYS = 30;

interface RawLongIdleRow {
  started_at: string;
  duration_sec: number | string;
  classification: string;
  fuel_gal: number | string | null;
  cost_usd: number | string | null;
  drivers: { full_name: string } | null;
  vehicles: {
    unit_number: string;
    idle_capability: string | null;
    has_apu: boolean | null;
    has_optimized_idle: boolean | null;
  } | null;
}

/**
 * The longest AVOIDABLE idle events over the last WINDOW_DAYS — the single biggest coaching wins. Joins each
 * discretionary idle to the truck's learned capability so we can flag the ones where an APU / optimized idle was
 * available (the driver could have shut the main engine off). RLS-scoped, read-only; sorting lives in the shared
 * pure helper.
 */
export function useLongIdles() {
  return useQuery({
    queryKey: ["long_idles"],
    queryFn: async (): Promise<LongIdleRow[]> => {
      const from = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
      const rows: LongIdleInput[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from("idle_events")
          .select(
            "started_at, duration_sec, classification, fuel_gal, cost_usd, drivers(full_name), vehicles(unit_number, idle_capability, has_apu, has_optimized_idle)",
          )
          .eq("classification", "discretionary")
          .gte("started_at", from)
          .order("duration_sec", { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as unknown as RawLongIdleRow[];
        for (const r of batch) {
          rows.push({
            driverName: r.drivers?.full_name ?? null,
            unitNumber: r.vehicles?.unit_number ?? null,
            startedAt: r.started_at,
            durationSec: Number(r.duration_sec),
            classification: r.classification as IdleClassification,
            fuelGal: r.fuel_gal == null ? null : Number(r.fuel_gal),
            costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
            hasApu: r.vehicles?.has_apu ?? null,
            hasOptimizedIdle: r.vehicles?.has_optimized_idle ?? null,
            idleCapability: r.vehicles?.idle_capability ?? null,
          });
        }
        if (batch.length < PAGE) break;
      }
      return topAvoidableIdles(rows);
    },
    refetchInterval: 120_000,
  });
}
