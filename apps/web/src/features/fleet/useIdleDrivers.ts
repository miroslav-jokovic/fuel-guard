import { computed, type Ref, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { computeAvoidable, avoidableCost, idleScore, type IdleCapability } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import type { IdleDateFilter } from "./useIdleScores";
import type { IdleCostBasis } from "./useIdleCostBasis";
import { fetchRollupRows, sumRollupByVehicle } from "./useIdleBreakdown";

const WINDOW_DAYS = 30;
const DEFAULT_COST_BASIS: IdleCostBasis = { idleGalPerHour: 0.8, fuelPricePerGal: 4.0, priceSource: "default" };

/** One driver's idle scorecard for the range, attributed from the rollup's per-day dominant driver. */
export interface DriverIdleRow {
  driverId: string; // our driver id, or "__unattributed__"
  driverName: string;
  engineOnH: number;
  idleH: number;
  avoidableH: number;
  avoidableUsd: number;
  idlePct: number;
  score: number | null; // avoidable ÷ engine-on
}

function bounds(f: IdleDateFilter) {
  // Compare on the picked calendar date directly (`day` is a calendar date; see useIdleBreakdown).
  const toDate = f.to ? f.to.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const fromDate = f.from ? f.from.slice(0, 10) : new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const days = Math.max(1, Math.round((Date.parse(`${toDate}T23:59:59.999Z`) - Date.parse(`${fromDate}T00:00:00.000Z`)) / 86_400_000));
  return { fromDate, toDate, days };
}

const hrs = (sec: number) => Math.round(sec / 360) / 10;

/**
 * The driver idle leaderboard, read from the pre-aggregated idle_rollup_days. Each rollup row already
 * carries the day's DOMINANT driver (idle-event operators + assignment day-overlap — the same two Samsara
 * signals this hook used to combine in the browser from four raw tables), so attribution here is just a
 * group-by. Engine-on/idle are credited for every attributed truck-day; avoidable only where the truck's
 * range verdict is confident AND it has a demonstrated alternative; the score denominator counts only
 * confident trucks, so no one is scored on thin data — all identical semantics to the raw-table version.
 */
export function useIdleDrivers(filters: Ref<IdleDateFilter>, costBasis?: Ref<IdleCostBasis>) {
  return useQuery({
    queryKey: ["idle_drivers", filters, computed(() => toValue(costBasis) ?? DEFAULT_COST_BASIS)],
    refetchInterval: 120_000,
    queryFn: async (): Promise<DriverIdleRow[]> => {
      const { fromDate, toDate, days } = bounds(toValue(filters));
      const cb = toValue(costBasis) ?? DEFAULT_COST_BASIS;

      const rows = await fetchRollupRows(fromDate, toDate);
      const sums = sumRollupByVehicle(rows);

      const { data: vdata, error: verr } = await supabase
        .from("vehicles")
        .select("id, has_apu, has_optimized_idle, idle_capability")
        .neq("status", "retired");
      if (verr) throw new Error(verr.message);
      const vehicles = (vdata ?? []) as { id: string; has_apu: boolean | null; has_optimized_idle: boolean | null; idle_capability: string | null }[];
      const vehById = new Map(vehicles.map((v) => [v.id, v]));

      const { data: ddata, error: derr } = await supabase.from("drivers").select("id, full_name");
      if (derr) throw new Error(derr.message);
      const nameById = new Map(((ddata ?? []) as { id: string; full_name: string }[]).map((d) => [d.id, d.full_name]));

      // Truck verdict over the whole range (confident + hasAlternative) — only confident trucks feed scoring.
      const periodSec = days * 86_400;
      const verdict = new Map<string, { confident: boolean; hasAlternative: boolean }>();
      for (const v of vehicles) {
        const s = sums.get(v.id);
        if (!s) continue;
        const r = computeAvoidable({
          driveSec: s.drive, idleSec: s.idle, offSec: s.off, coverageSec: s.cov, periodSec,
          // Mode SUMS are all computeAvoidable uses — two synthetic sessions reproduce it exactly.
          sessions: [
            { idleSec: s.continuous, mode: "continuous" },
            { idleSec: s.managed, mode: "apu_or_off" },
          ],
          hasApu: v.has_apu ?? null,
          hasOptimizedIdle: v.has_optimized_idle ?? null,
          learnedCapability: (v.idle_capability ?? "unknown") as IdleCapability,
        });
        verdict.set(v.id, { confident: r.confident, hasAlternative: r.hasAlternative });
      }

      // Group the attributed truck-days by driver.
      type Tot = { engineOnSec: number; idleSec: number; avoidableSec: number; confidentEngineOnSec: number };
      const byDriver = new Map<string | null, Tot>();
      for (const r of rows) {
        if (!vehById.has(r.vehicle_id)) continue; // retired trucks excluded, as before
        const ver = verdict.get(r.vehicle_id);
        const engineOnSec = Number(r.drive_sec) + Number(r.idle_sec);
        const t = byDriver.get(r.attributed_driver_id) ?? { engineOnSec: 0, idleSec: 0, avoidableSec: 0, confidentEngineOnSec: 0 };
        t.engineOnSec += engineOnSec;
        t.idleSec += Number(r.idle_sec);
        t.confidentEngineOnSec += ver?.confident ? engineOnSec : 0;
        if (ver?.confident && ver.hasAlternative) t.avoidableSec += Number(r.continuous_idle_sec);
        byDriver.set(r.attributed_driver_id, t);
      }

      const out: DriverIdleRow[] = [...byDriver.entries()].map(([driverId, t]) => ({
        driverId: driverId == null ? "__unattributed__" : driverId,
        driverName: driverId == null ? "Unattributed" : nameById.get(driverId) ?? "Unknown driver",
        engineOnH: hrs(t.engineOnSec),
        idleH: hrs(t.idleSec),
        avoidableH: hrs(t.avoidableSec),
        avoidableUsd: avoidableCost(t.avoidableSec, { idleGalPerHour: cb.idleGalPerHour, fuelPricePerGal: cb.fuelPricePerGal }).usd,
        idlePct: t.engineOnSec > 0 ? Math.round((t.idleSec / t.engineOnSec) * 1000) / 10 : 0,
        score: idleScore(t.avoidableSec, t.confidentEngineOnSec),
      }));
      out.sort((a, b) => b.avoidableUsd - a.avoidableUsd || b.avoidableH - a.avoidableH);
      return out;
    },
  });
}
