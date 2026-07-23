import { computed, type Ref, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  computeAvoidable,
  avoidableCost,
  idleScore,
  attributeDriverIdle,
  type IdleMode,
  type IdleCapability,
  type IdleBucket,
  type DriverAssignment,
} from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import type { IdleDateFilter } from "./useIdleScores";
import type { IdleCostBasis } from "./useIdleCostBasis";

const PAGE = 1000;
const WINDOW_DAYS = 30;
const DEFAULT_COST_BASIS: IdleCostBasis = { idleGalPerHour: 0.8, fuelPricePerGal: 4.0, priceSource: "default" };

/** One driver's idle scorecard for the range, attributed from the foundation via assignments. */
export interface DriverIdleRow {
  driverId: string; // our driver id, the samsara id if unmatched, or "__unattributed__"
  driverName: string;
  engineOnH: number;
  idleH: number;
  avoidableH: number;
  avoidableUsd: number;
  idlePct: number;
  score: number | null; // avoidable ÷ engine-on
}

function bounds(f: IdleDateFilter) {
  const toMs = f.to ? Date.parse(f.to) : Date.now();
  const fromMs = f.from ? Date.parse(f.from) : toMs - WINDOW_DAYS * 86_400_000;
  const days = Math.max(1, Math.round((toMs - fromMs) / 86_400_000));
  return {
    fromDate: new Date(fromMs).toISOString().slice(0, 10),
    toDate: new Date(toMs).toISOString().slice(0, 10),
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(toMs).toISOString(),
    days,
  };
}

const hrs = (sec: number) => Math.round(sec / 360) / 10;

/**
 * The driver idle leaderboard on the new model: avoidable idle and engine-on time attributed to whoever was
 * assigned to each truck at the time (shared attributeDriverIdle), scored avoidable ÷ engine-on. Only CONFIDENT
 * trucks contribute, so a driver is never scored on thin data. Avoidable is credited per park session (precise
 * timing); engine-on/idle per day (attributed at midday).
 */
export function useIdleDrivers(filters: Ref<IdleDateFilter>, costBasis?: Ref<IdleCostBasis>) {
  return useQuery({
    queryKey: ["idle_drivers", filters, computed(() => toValue(costBasis) ?? DEFAULT_COST_BASIS)],
    refetchInterval: 120_000,
    queryFn: async (): Promise<DriverIdleRow[]> => {
      const { fromDate, toDate, fromIso, toIso, days } = bounds(toValue(filters));
      const cb = toValue(costBasis) ?? DEFAULT_COST_BASIS;

      // Engine-days (kept per row for per-day attribution + summed per vehicle for the truck verdict).
      type Day = { vehicle_id: string; day: string; drive_sec: number; idle_sec: number; off_sec: number; coverage_sec: number };
      const dayRows: Day[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from("vehicle_engine_days")
          .select("vehicle_id, day, drive_sec, idle_sec, off_sec, coverage_sec")
          .gte("day", fromDate)
          .lte("day", toDate)
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as Day[];
        for (const r of batch) if (r.vehicle_id) dayRows.push(r);
        if (batch.length < PAGE) break;
      }

      // Park sessions (kept per row for per-session avoidable attribution).
      type Sess = { vehicle_id: string; started_at: string; idle_sec: number; mode: string };
      const sessRows: Sess[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from("idle_park_sessions")
          .select("vehicle_id, started_at, idle_sec, mode")
          .gte("started_at", fromIso)
          .lte("started_at", toIso)
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as Sess[];
        for (const r of batch) if (r.vehicle_id) sessRows.push(r);
        if (batch.length < PAGE) break;
      }

      // Vehicles (capability + samsara id), drivers (samsara id → name), assignments overlapping the range.
      const { data: vdata, error: verr } = await supabase
        .from("vehicles")
        .select("id, samsara_vehicle_id, has_apu, has_optimized_idle, idle_capability")
        .neq("status", "retired");
      if (verr) throw new Error(verr.message);
      const vehicles = (vdata ?? []) as { id: string; samsara_vehicle_id: string | null; has_apu: boolean | null; has_optimized_idle: boolean | null; idle_capability: string | null }[];
      const vehById = new Map(vehicles.map((v) => [v.id, v]));

      const { data: ddata, error: derr } = await supabase.from("drivers").select("id, samsara_driver_id, full_name");
      if (derr) throw new Error(derr.message);
      const driverBySamsara = new Map<string, { id: string; full_name: string }>();
      for (const d of (ddata ?? []) as { id: string; samsara_driver_id: string | null; full_name: string }[]) {
        if (d.samsara_driver_id) driverBySamsara.set(d.samsara_driver_id, { id: d.id, full_name: d.full_name });
      }

      const { data: adata, error: aerr } = await supabase
        .from("driver_vehicle_assignments")
        .select("vehicle_samsara_id, driver_samsara_id, start_at, end_at")
        .lte("start_at", toIso)
        .or(`end_at.is.null,end_at.gte.${fromIso}`);
      if (aerr) throw new Error(aerr.message);
      const assignments: DriverAssignment[] = ((adata ?? []) as { vehicle_samsara_id: string; driver_samsara_id: string; start_at: string; end_at: string | null }[]).map((a) => ({
        vehicleSamsaraId: a.vehicle_samsara_id,
        driverSamsaraId: a.driver_samsara_id,
        startMs: Date.parse(a.start_at),
        endMs: a.end_at ? Date.parse(a.end_at) : null,
      }));

      // Per-vehicle sums + session lists, to compute the truck verdict (hasAlternative + confident).
      const engByVeh = new Map<string, { drive: number; idle: number; off: number; cov: number }>();
      for (const r of dayRows) {
        const e = engByVeh.get(r.vehicle_id) ?? { drive: 0, idle: 0, off: 0, cov: 0 };
        e.drive += Number(r.drive_sec);
        e.idle += Number(r.idle_sec);
        e.off += Number(r.off_sec);
        e.cov += Number(r.coverage_sec);
        engByVeh.set(r.vehicle_id, e);
      }
      const sessByVeh = new Map<string, { idleSec: number; mode: IdleMode }[]>();
      for (const r of sessRows) {
        const arr = sessByVeh.get(r.vehicle_id) ?? [];
        arr.push({ idleSec: Number(r.idle_sec), mode: r.mode as IdleMode });
        sessByVeh.set(r.vehicle_id, arr);
      }
      const periodSec = days * 86_400;
      // verdict per vehicle: confident + hasAlternative (only confident trucks feed driver scoring).
      const verdict = new Map<string, { confident: boolean; hasAlternative: boolean }>();
      for (const v of vehicles) {
        const e = engByVeh.get(v.id);
        if (!e) continue;
        const r = computeAvoidable({
          driveSec: e.drive, idleSec: e.idle, offSec: e.off, coverageSec: e.cov, periodSec,
          sessions: sessByVeh.get(v.id) ?? [],
          hasApu: v.has_apu ?? null,
          hasOptimizedIdle: v.has_optimized_idle ?? null,
          learnedCapability: (v.idle_capability ?? "unknown") as IdleCapability,
        });
        verdict.set(v.id, { confident: r.confident, hasAlternative: r.hasAlternative });
      }

      // Build attribution buckets on CONFIDENT trucks only.
      const dayNoonMs = (day: string) => Date.parse(`${day}T12:00:00Z`);
      const buckets: IdleBucket[] = [];
      for (const r of sessRows) {
        const v = vehById.get(r.vehicle_id);
        const ver = verdict.get(r.vehicle_id);
        if (!v?.samsara_vehicle_id || !ver?.confident) continue;
        const avoidableSec = r.mode === "continuous" && ver.hasAlternative ? Number(r.idle_sec) : 0;
        if (avoidableSec > 0) buckets.push({ vehicleSamsaraId: v.samsara_vehicle_id, atMs: Date.parse(r.started_at), avoidableSec, engineOnSec: 0, idleSec: 0 });
      }
      for (const r of dayRows) {
        const v = vehById.get(r.vehicle_id);
        const ver = verdict.get(r.vehicle_id);
        if (!v?.samsara_vehicle_id || !ver?.confident) continue;
        buckets.push({ vehicleSamsaraId: v.samsara_vehicle_id, atMs: dayNoonMs(r.day), avoidableSec: 0, engineOnSec: Number(r.drive_sec) + Number(r.idle_sec), idleSec: Number(r.idle_sec) });
      }

      const totals = attributeDriverIdle(buckets, assignments);
      const rows: DriverIdleRow[] = totals.map((t) => {
        const d = t.driverSamsaraId ? driverBySamsara.get(t.driverSamsaraId) : null;
        return {
          driverId: t.driverSamsaraId == null ? "__unattributed__" : d?.id ?? t.driverSamsaraId,
          driverName: t.driverSamsaraId == null ? "Unattributed" : d?.full_name ?? "Unknown driver",
          engineOnH: hrs(t.engineOnSec),
          idleH: hrs(t.idleSec),
          avoidableH: hrs(t.avoidableSec),
          avoidableUsd: avoidableCost(t.avoidableSec, { idleGalPerHour: cb.idleGalPerHour, fuelPricePerGal: cb.fuelPricePerGal }).usd,
          idlePct: t.engineOnSec > 0 ? Math.round((t.idleSec / t.engineOnSec) * 1000) / 10 : 0,
          score: idleScore(t.avoidableSec, t.engineOnSec),
        };
      });
      // Worst first: most avoidable $, then most avoidable hours.
      rows.sort((a, b) => b.avoidableUsd - a.avoidableUsd || b.avoidableH - a.avoidableH);
      return rows;
    },
  });
}
