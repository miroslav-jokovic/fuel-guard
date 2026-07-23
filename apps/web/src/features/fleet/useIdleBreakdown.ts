import { type Ref, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { computeAvoidable, avoidableCost, idleScore, type IdleMode, type IdleCapability } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import type { IdleDateFilter } from "./useIdleScores";

const PAGE = 1000;
const WINDOW_DAYS = 30;

/** One truck's engine-time + avoidable breakdown for the selected range (hours, 0.1h precision). */
export interface TruckBreakdown {
  vehicleId: string;
  unit: string;
  engineOnH: number; // drive + idle
  driveH: number;
  idleH: number;
  offH: number;
  idlePct: number; // idle ÷ engine-on
  managedH: number; // apu_or_off + optimized_cycling idle
  continuousH: number;
  avoidableH: number;
  unavoidableH: number;
  avoidableUsd: number;
  score: number | null; // idle score (avoidable ÷ engine-on)
  alternative: string; // apu | optimized_idle | learned_apu | learned_optimized | none | unknown
  capability: IdleCapability; // learned
  coveragePct: number; // observed share of the range
  confident: boolean;
}

export interface IdleFleet {
  engineOnH: number;
  driveH: number;
  idleH: number;
  offH: number;
  drivePct: number;
  idlePct: number;
  avoidableH: number;
  avoidableUsd: number;
  confidentTrucks: number;
  totalTrucks: number;
  rangeDays: number;
}

export interface IdleBreakdown {
  trucks: TruckBreakdown[];
  fleet: IdleFleet;
}

function rangeBounds(f: IdleDateFilter) {
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

const hrs = (sec: number) => Math.round(sec / 360) / 10; // seconds → hours, 0.1h
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The per-truck idle breakdown (engine-on = drive + idle) + fleet totals, computed client-side from the
 * foundation tables (vehicle_engine_days + idle_park_sessions) via the shared avoidable algorithm. Fleet
 * avoidable totals count CONFIDENT trucks only, so the headline number is never inflated by thin data.
 */
export function useIdleBreakdown(filters: Ref<IdleDateFilter>) {
  return useQuery({
    queryKey: ["idle_breakdown", filters],
    refetchInterval: 120_000,
    queryFn: async (): Promise<IdleBreakdown> => {
      const { fromDate, toDate, fromIso, toIso, days } = rangeBounds(toValue(filters));

      // 1) Engine-days summed per vehicle.
      const eng = new Map<string, { drive: number; idle: number; off: number; cov: number }>();
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from("vehicle_engine_days")
          .select("vehicle_id, drive_sec, idle_sec, off_sec, coverage_sec")
          .gte("day", fromDate)
          .lte("day", toDate)
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as { vehicle_id: string | null; drive_sec: number; idle_sec: number; off_sec: number; coverage_sec: number }[];
        for (const r of batch) {
          if (!r.vehicle_id) continue;
          const e = eng.get(r.vehicle_id) ?? { drive: 0, idle: 0, off: 0, cov: 0 };
          e.drive += Number(r.drive_sec);
          e.idle += Number(r.idle_sec);
          e.off += Number(r.off_sec);
          e.cov += Number(r.coverage_sec);
          eng.set(r.vehicle_id, e);
        }
        if (batch.length < PAGE) break;
      }

      // 2) Park sessions grouped per vehicle.
      const sess = new Map<string, { idleSec: number; mode: IdleMode }[]>();
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from("idle_park_sessions")
          .select("vehicle_id, idle_sec, mode, started_at")
          .gte("started_at", fromIso)
          .lte("started_at", toIso)
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as { vehicle_id: string | null; idle_sec: number; mode: string }[];
        for (const r of batch) {
          if (!r.vehicle_id) continue;
          const arr = sess.get(r.vehicle_id) ?? [];
          arr.push({ idleSec: Number(r.idle_sec), mode: r.mode as IdleMode });
          sess.set(r.vehicle_id, arr);
        }
        if (batch.length < PAGE) break;
      }

      // 3) Vehicles (capability + admin flags).
      const { data: vdata, error: verr } = await supabase
        .from("vehicles")
        .select("id, unit_number, has_apu, has_optimized_idle, idle_capability")
        .neq("status", "retired");
      if (verr) throw new Error(verr.message);
      const vehicles = (vdata ?? []) as {
        id: string;
        unit_number: string;
        has_apu: boolean | null;
        has_optimized_idle: boolean | null;
        idle_capability: string | null;
      }[];

      const periodSec = days * 86_400;
      const trucks: TruckBreakdown[] = [];
      for (const v of vehicles) {
        const e = eng.get(v.id);
        if (!e) continue; // nothing observed for this truck in the range
        const r = computeAvoidable({
          driveSec: e.drive,
          idleSec: e.idle,
          offSec: e.off,
          coverageSec: e.cov,
          periodSec,
          sessions: sess.get(v.id) ?? [],
          hasApu: v.has_apu ?? null,
          hasOptimizedIdle: v.has_optimized_idle ?? null,
          learnedCapability: (v.idle_capability ?? "unknown") as IdleCapability,
        });
        trucks.push({
          vehicleId: v.id,
          unit: v.unit_number,
          engineOnH: hrs(r.engineOnSec),
          driveH: hrs(r.driveSec),
          idleH: hrs(r.idleSec),
          offH: hrs(r.offSec),
          idlePct: r.engineOnSec > 0 ? Math.round((r.idleSec / r.engineOnSec) * 1000) / 10 : 0,
          managedH: hrs(r.managedIdleSec),
          continuousH: hrs(r.continuousIdleSec),
          avoidableH: hrs(r.avoidableIdleSec),
          unavoidableH: hrs(r.unavoidableIdleSec),
          avoidableUsd: avoidableCost(r.avoidableIdleSec).usd,
          score: idleScore(r.avoidableIdleSec, r.engineOnSec),
          alternative: r.alternative,
          capability: (v.idle_capability ?? "unknown") as IdleCapability,
          coveragePct: Math.round(r.coverage * 1000) / 10,
          confident: r.confident,
        });
      }
      trucks.sort((a, b) => b.avoidableUsd - a.avoidableUsd || b.avoidableH - a.avoidableH);

      let engineOn = 0, drive = 0, idle = 0, off = 0, avoidH = 0, avoidUsd = 0, confidentTrucks = 0;
      for (const t of trucks) {
        engineOn += t.engineOnH;
        drive += t.driveH;
        idle += t.idleH;
        off += t.offH;
        if (t.confident) {
          avoidH += t.avoidableH;
          avoidUsd += t.avoidableUsd;
          confidentTrucks += 1;
        }
      }
      return {
        trucks,
        fleet: {
          engineOnH: r1(engineOn),
          driveH: r1(drive),
          idleH: r1(idle),
          offH: r1(off),
          drivePct: engineOn > 0 ? Math.round((drive / engineOn) * 1000) / 10 : 0,
          idlePct: engineOn > 0 ? Math.round((idle / engineOn) * 1000) / 10 : 0,
          avoidableH: r1(avoidH),
          avoidableUsd: Math.round(avoidUsd),
          confidentTrucks,
          totalTrucks: trucks.length,
          rangeDays: days,
        },
      };
    },
  });
}
