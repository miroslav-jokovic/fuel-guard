import { computed, type Ref, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { computeAvoidable, avoidableCost, idleScore, type IdleCapability } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import type { IdleDateFilter } from "./useIdleScores";
import type { IdleCostBasis } from "@/composables/useIdleCostBasis";

const DEFAULT_COST_BASIS: IdleCostBasis = { idleGalPerHour: 0.8, fuelPricePerGal: 4.0, priceSource: "default" };

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
  // HOS duty split (rest = SB/OFF, work = On Duty) — carried on the same rollup rows now. Null when the
  // truck idled but NO duty overlay exists at all (no idle events for the range) → shown as "—", never a
  // fake zero.
  restIdleH: number | null;
  workIdleH: number | null;
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
  // `idle_rollup_days.day` is a calendar date and the picker gives calendar dates, so we compare on the
  // picked YYYY-MM-DD DIRECTLY (round-tripping through Date shifted the end date for browsers west of UTC).
  const toDate = f.to ? f.to.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const fromDate = f.from ? f.from.slice(0, 10) : new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const days = Math.max(1, Math.round((Date.parse(`${toDate}T23:59:59.999Z`) - Date.parse(`${fromDate}T00:00:00.000Z`)) / 86_400_000));
  return { fromDate, toDate, days };
}

const hrs = (sec: number) => Math.round(sec / 360) / 10; // seconds → hours, 0.1h
const r1 = (n: number) => Math.round(n * 10) / 10;

/** One rollup row as read from idle_rollup_days. */
export interface RollupRow {
  vehicle_id: string;
  day: string;
  drive_sec: number;
  idle_sec: number;
  off_sec: number;
  coverage_sec: number;
  managed_idle_sec: number;
  continuous_idle_sec: number;
  rest_idle_sec: number;
  work_idle_sec: number;
  other_idle_sec: number;
  attributed_driver_id: string | null;
}

/** Page the range's rollup rows (~trucks×days — tiny next to the raw event tables it replaced). */
export async function fetchRollupRows(fromDate: string, toDate: string): Promise<RollupRow[]> {
  const out: RollupRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("idle_rollup_days")
      .select(
        "vehicle_id, day, drive_sec, idle_sec, off_sec, coverage_sec, managed_idle_sec, continuous_idle_sec, rest_idle_sec, work_idle_sec, other_idle_sec, attributed_driver_id",
      )
      .gte("day", fromDate)
      .lte("day", toDate)
      // (day, vehicle_id) is unique per org → a stable total order the (org_id, day, vehicle_id) index
      // serves directly (no dropped/duplicated pages, no sort).
      .order("day", { ascending: true })
      .order("vehicle_id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as RollupRow[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/** Per-vehicle sums of the range's rollup rows — the inputs computeAvoidable needs. */
export interface VehicleRollupSums {
  drive: number;
  idle: number;
  off: number;
  cov: number;
  managed: number;
  continuous: number;
  rest: number;
  work: number;
  other: number;
}

export function sumRollupByVehicle(rows: RollupRow[]): Map<string, VehicleRollupSums> {
  const out = new Map<string, VehicleRollupSums>();
  for (const r of rows) {
    const s = out.get(r.vehicle_id) ?? { drive: 0, idle: 0, off: 0, cov: 0, managed: 0, continuous: 0, rest: 0, work: 0, other: 0 };
    s.drive += Number(r.drive_sec);
    s.idle += Number(r.idle_sec);
    s.off += Number(r.off_sec);
    s.cov += Number(r.coverage_sec);
    s.managed += Number(r.managed_idle_sec);
    s.continuous += Number(r.continuous_idle_sec);
    s.rest += Number(r.rest_idle_sec);
    s.work += Number(r.work_idle_sec);
    s.other += Number(r.other_idle_sec);
    out.set(r.vehicle_id, s);
  }
  return out;
}

/**
 * The per-truck idle breakdown (engine-on = drive + idle) + fleet totals, read from the pre-aggregated
 * idle_rollup_days (maintained server-side by the idle/HOS syncs) — NOT from the raw event tables. The
 * mode sums reconstruct `computeAvoidable` exactly (it only ever sums sessions by mode), so the verdict
 * math is unchanged from the raw-table version. Fleet avoidable totals count CONFIDENT trucks only.
 */
export function useIdleBreakdown(filters: Ref<IdleDateFilter>, costBasis?: Ref<IdleCostBasis>) {
  return useQuery({
    queryKey: ["idle_breakdown", filters, computed(() => toValue(costBasis) ?? DEFAULT_COST_BASIS)],
    refetchInterval: 120_000,
    queryFn: async (): Promise<IdleBreakdown> => {
      const { fromDate, toDate, days } = rangeBounds(toValue(filters));
      const cb = toValue(costBasis) ?? DEFAULT_COST_BASIS;
      const costOf = (sec: number) => avoidableCost(sec, { idleGalPerHour: cb.idleGalPerHour, fuelPricePerGal: cb.fuelPricePerGal }).usd;

      const sums = sumRollupByVehicle(await fetchRollupRows(fromDate, toDate));

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
        const s = sums.get(v.id);
        if (!s) continue; // nothing observed for this truck in the range
        const r = computeAvoidable({
          driveSec: s.drive,
          idleSec: s.idle,
          offSec: s.off,
          coverageSec: s.cov,
          periodSec,
          // Mode SUMS are all computeAvoidable uses — two synthetic sessions reproduce it exactly.
          sessions: [
            { idleSec: s.continuous, mode: "continuous" },
            { idleSec: s.managed, mode: "apu_or_off" },
          ],
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
          avoidableUsd: costOf(r.avoidableIdleSec),
          score: idleScore(r.avoidableIdleSec, r.engineOnSec),
          alternative: r.alternative,
          capability: (v.idle_capability ?? "unknown") as IdleCapability,
          coveragePct: Math.round(r.coverage * 1000) / 10,
          confident: r.confident,
          // No duty overlay at all (idled, but zero attributed seconds in any bucket) → "—", not fake 0.
          restIdleH: s.rest + s.work + s.other === 0 && s.idle > 0 ? null : hrs(s.rest),
          workIdleH: s.rest + s.work + s.other === 0 && s.idle > 0 ? null : hrs(s.work),
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
