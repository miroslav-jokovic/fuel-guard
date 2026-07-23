import { computed, type Ref, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  computeAvoidable,
  avoidableCost,
  idleScore,
  type IdleMode,
  type IdleCapability,
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
  // Compare on the picked calendar date directly (the `day` column is a fleet-local calendar date). Parsing
  // the naive "…T23:59:59" as browser-local then converting to UTC rolled the end date forward a day for
  // browsers west of UTC, so one selected date showed two days. See useIdleBreakdown.rangeBounds.
  const toDate = f.to ? f.to.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const fromDate = f.from ? f.from.slice(0, 10) : new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const fromIso = `${fromDate}T00:00:00.000Z`;
  const toIso = `${toDate}T23:59:59.999Z`;
  const days = Math.max(1, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000));
  return { fromDate, toDate, fromIso, toIso, days };
}

const hrs = (sec: number) => Math.round(sec / 360) / 10;

/**
 * The driver idle leaderboard: engine-on / idle / avoidable time attributed to the driver who had each truck,
 * scored avoidable ÷ engine-on. Driver resolution picks the DOMINANT driver per (vehicle, day) from two rich
 * Samsara signals combined by time: the operator on each idle event (idle_events.driver_id) plus the day
 * OVERLAP of the driver↔vehicle assignment intervals (Samsara HOS driving segments). Measuring overlap — rather
 * than sampling one instant — is what makes the short, scattered HOS segments count, and it covers trucks that
 * drove but never idled. Falls back to the vehicle's overall dominant driver. Every truck that ran is attributed
 * (so all drivers appear); only confident trucks feed the score denominator, so no one is scored on thin data.
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
          .order("vehicle_id", { ascending: true }) // stable, unique per row → no dropped/duplicated pages
          .order("day", { ascending: true })
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
          .order("vehicle_id", { ascending: true }) // stable, unique per row → no dropped/duplicated pages
          .order("started_at", { ascending: true })
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
      const driverById = new Map<string, { full_name: string }>();
      for (const d of (ddata ?? []) as { id: string; samsara_driver_id: string | null; full_name: string }[]) {
        if (d.samsara_driver_id) driverBySamsara.set(d.samsara_driver_id, { id: d.id, full_name: d.full_name });
        driverById.set(d.id, { full_name: d.full_name });
      }

      // PRIMARY driver source: Samsara's operator on each idle event (idle_events.driver_id, already our id) —
      // the rich signal the old driver view used. Aggregate the dominant driver per (vehicle, day) and per
      // vehicle overall; the driver_vehicle_assignments feed is a fallback (sparse for this fleet on its own).
      type Ev = { vehicle_id: string; driver_id: string | null; started_at: string; duration_sec: number | string };
      const durVehDay = new Map<string, Map<string, number>>(); // `${vehId}|${YYYY-MM-DD}` → driverId → idle sec
      const durVeh = new Map<string, Map<string, number>>(); //    vehId               → driverId → idle sec
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from("idle_events")
          .select("vehicle_id, driver_id, started_at, duration_sec")
          .gte("started_at", fromIso)
          .lte("started_at", toIso)
          .not("driver_id", "is", null)
          .order("vehicle_id", { ascending: true })
          .order("started_at", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as Ev[];
        for (const e of batch) {
          if (!e.vehicle_id || !e.driver_id) continue;
          const dur = Number(e.duration_sec) || 0;
          const kd = `${e.vehicle_id}|${e.started_at.slice(0, 10)}`;
          const md = durVehDay.get(kd) ?? new Map<string, number>();
          md.set(e.driver_id, (md.get(e.driver_id) ?? 0) + dur);
          durVehDay.set(kd, md);
          const mv = durVeh.get(e.vehicle_id) ?? new Map<string, number>();
          mv.set(e.driver_id, (mv.get(e.driver_id) ?? 0) + dur);
          durVeh.set(e.vehicle_id, mv);
        }
        if (batch.length < PAGE) break;
      }
      const topDriver = (m: Map<string, number> | undefined): string | null => {
        if (!m) return null;
        let best: string | null = null;
        let bestDur = -1;
        for (const [d, du] of m) if (du > bestDur) { best = d; bestDur = du; }
        return best;
      };

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

      // Fold the driver↔vehicle assignment intervals (Samsara HOS driving segments + operator-derived) into the
      // SAME dominant-driver-per-day maps, by day OVERLAP. HOS segments are short and scattered, so sampling a
      // single instant missed them — measuring each interval's overlap with each day it spans is what makes the
      // rich assignment data actually count, and it covers trucks that drove but never idled.
      const samsaraToVeh = new Map<string, string>();
      for (const v of vehicles) if (v.samsara_vehicle_id) samsaraToVeh.set(v.samsara_vehicle_id, v.id);
      const winStart = Date.parse(fromIso);
      const winEnd = Date.parse(toIso);
      const DAY_MS = 86_400_000;
      const addDur = (vehId: string, day: string, driverId: string, sec: number) => {
        const kd = `${vehId}|${day}`;
        const md = durVehDay.get(kd) ?? new Map<string, number>();
        md.set(driverId, (md.get(driverId) ?? 0) + sec);
        durVehDay.set(kd, md);
        const mv = durVeh.get(vehId) ?? new Map<string, number>();
        mv.set(driverId, (mv.get(driverId) ?? 0) + sec);
        durVeh.set(vehId, mv);
      };
      for (const a of assignments) {
        const vehId = samsaraToVeh.get(a.vehicleSamsaraId);
        const drvId = driverBySamsara.get(a.driverSamsaraId)?.id;
        if (!vehId || !drvId) continue;
        const s = Math.max(a.startMs, winStart);
        const e = Math.min(a.endMs ?? winEnd, winEnd);
        if (!(e > s)) continue;
        for (let dayStart = Math.floor(s / DAY_MS) * DAY_MS; dayStart < e; dayStart += DAY_MS) {
          const ov = Math.min(e, dayStart + DAY_MS) - Math.max(s, dayStart);
          if (ov > 0) addDur(vehId, new Date(dayStart).toISOString().slice(0, 10), drvId, ov / 1000);
        }
      }

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

      // Resolve a truck's driver for a day: the dominant driver that day (idle-event operators + assignment
      // overlap, combined above) → the vehicle's overall dominant driver as a last resort. Returns OUR driver id.
      const resolveDriver = (vehId: string, day: string): string | null =>
        topDriver(durVehDay.get(`${vehId}|${day}`)) ?? topDriver(durVeh.get(vehId));

      // Attribute EVERY truck that ran, so every driver who drove appears. Engine-on/idle credited for all
      // trucks; avoidable only where the truck is confident AND has a demonstrated alternative; the score
      // denominator (confidentEngineOnSec) counts only confident trucks, so an un-judgeable driver still shows
      // (engine-on/idle) but isn't scored.
      type Tot = { engineOnSec: number; idleSec: number; avoidableSec: number; confidentEngineOnSec: number };
      const byDriver = new Map<string | null, Tot>();
      const add = (driverId: string | null, p: Partial<Tot>) => {
        const t = byDriver.get(driverId) ?? { engineOnSec: 0, idleSec: 0, avoidableSec: 0, confidentEngineOnSec: 0 };
        t.engineOnSec += p.engineOnSec ?? 0;
        t.idleSec += p.idleSec ?? 0;
        t.avoidableSec += p.avoidableSec ?? 0;
        t.confidentEngineOnSec += p.confidentEngineOnSec ?? 0;
        byDriver.set(driverId, t);
      };
      for (const r of dayRows) {
        if (!vehById.has(r.vehicle_id)) continue;
        const ver = verdict.get(r.vehicle_id);
        const engineOnSec = Number(r.drive_sec) + Number(r.idle_sec);
        const driver = resolveDriver(r.vehicle_id, r.day);
        add(driver, { engineOnSec, idleSec: Number(r.idle_sec), confidentEngineOnSec: ver?.confident ? engineOnSec : 0 });
      }
      for (const r of sessRows) {
        if (!vehById.has(r.vehicle_id)) continue;
        const ver = verdict.get(r.vehicle_id);
        if (!(r.mode === "continuous" && ver?.confident && ver.hasAlternative)) continue;
        const driver = resolveDriver(r.vehicle_id, r.started_at.slice(0, 10));
        add(driver, { avoidableSec: Number(r.idle_sec) });
      }

      const rows: DriverIdleRow[] = [...byDriver.entries()].map(([driverId, t]) => ({
        driverId: driverId == null ? "__unattributed__" : driverId,
        driverName: driverId == null ? "Unattributed" : driverById.get(driverId)?.full_name ?? "Unknown driver",
        engineOnH: hrs(t.engineOnSec),
        idleH: hrs(t.idleSec),
        avoidableH: hrs(t.avoidableSec),
        avoidableUsd: avoidableCost(t.avoidableSec, { idleGalPerHour: cb.idleGalPerHour, fuelPricePerGal: cb.fuelPricePerGal }).usd,
        idlePct: t.engineOnSec > 0 ? Math.round((t.idleSec / t.engineOnSec) * 1000) / 10 : 0,
        // Score off the JUDGEABLE basis only → null (shown as "—") when none of the driver's trucks were confident.
        score: idleScore(t.avoidableSec, t.confidentEngineOnSec),
      }));
      // Worst first: most avoidable $, then most avoidable hours.
      rows.sort((a, b) => b.avoidableUsd - a.avoidableUsd || b.avoidableH - a.avoidableH);
      return rows;
    },
  });
}
