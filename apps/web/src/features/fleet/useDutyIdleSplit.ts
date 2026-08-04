import { type Ref, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { hosOverlapSeconds, type HosSegment, type HosStatus } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import type { IdleDateFilter } from "./useIdleScores";

const PAGE = 1000;
const WINDOW_DAYS = 30;
/** Fetch duty segments from this far BEFORE the visible window: a segment that started earlier (an
 *  overnight sleeper, a 34-h restart) still covers idle events at the window's start. */
const SEGMENT_LOOKBACK_MS = 72 * 3_600_000;

/** Per-truck idle split by HOS duty kind (hours, 0.1h). P1: SHOWN ONLY — nothing here feeds scoring yet. */
export interface DutyIdleSplit {
  restH: number; // idle during Sleeper Berth / Off Duty (hotel-load, APU-replaceable)
  workH: number; // idle during On Duty not driving (loading / dock / inspection)
  otherH: number; // driving / yard-move / personal-conveyance / unknown / no-driver idle
}

function rangeBounds(f: IdleDateFilter) {
  const toDate = f.to ? f.to.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const fromDate = f.from ? f.from.slice(0, 10) : new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  return { fromIso: `${fromDate}T00:00:00.000Z`, toIso: `${toDate}T23:59:59.999Z` };
}

const hrs = (sec: number) => Math.round(sec / 360) / 10;

/**
 * Overlay HOS duty-status segments onto idle events to split each truck's idle into rest (SB/OFF) vs
 * on-duty vs other. Idle events already carry driver + time; we look up the driver's duty status over each
 * event's interval and bucket its seconds. Events with no driver, or time not covered by a duty segment,
 * fall to `otherH` (honest — never guessed as rest). This is a P1 read-only view to eyeball the split before
 * P2 makes avoidable duty-aware; it does not alter any score.
 */
export function useDutyIdleSplit(filters: Ref<IdleDateFilter>) {
  return useQuery({
    queryKey: ["duty_idle_split", filters],
    refetchInterval: 120_000,
    queryFn: async (): Promise<Map<string, DutyIdleSplit>> => {
      const { fromIso, toIso } = rangeBounds(toValue(filters));

      // 1) HOS duty segments in range, grouped per driver. Unlinked rows (driver_id null — 2/3 of a large
      // historical backfill) can never join to an event, so they're excluded SERVER-side; ordering on
      // (started_at, id) matches idx_hos_seg_org_time so pages come off the index instead of a repeated
      // sort — this query was hitting the DB's statement timeout on a 500k+-row table, and the swallowed
      // error blanked both duty columns. The window start is padded so already-open segments still count.
      const segFromIso = new Date(Date.parse(fromIso) - SEGMENT_LOOKBACK_MS).toISOString();
      const segsByDriver = new Map<string, HosSegment[]>();
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from("hos_duty_segments")
          .select("driver_id, status, started_at, ended_at")
          .not("driver_id", "is", null)
          .gte("started_at", segFromIso)
          .lte("started_at", toIso)
          .order("started_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as { driver_id: string | null; status: string; started_at: string; ended_at: string | null }[];
        for (const r of batch) {
          if (!r.driver_id) continue;
          const arr = segsByDriver.get(r.driver_id) ?? [];
          arr.push({
            driverId: r.driver_id,
            status: r.status as HosStatus,
            startMs: Date.parse(r.started_at),
            endMs: r.ended_at ? Date.parse(r.ended_at) : null,
          });
          segsByDriver.set(r.driver_id, arr);
        }
        if (batch.length < PAGE) break;
      }

      // 2) Idle events in range → bucket each event's seconds by the driver's duty status at that time.
      const out = new Map<string, DutyIdleSplit>();
      const add = (vid: string, k: keyof DutyIdleSplit, sec: number) => {
        const e = out.get(vid) ?? { restH: 0, workH: 0, otherH: 0 };
        e[k] += sec;
        out.set(vid, e);
      };
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from("idle_events")
          .select("vehicle_id, driver_id, started_at, duration_sec")
          .gte("started_at", fromIso)
          .lte("started_at", toIso)
          // (started_at, id) is a stable total order (no dropped/duplicated rows across pages) that the
          // time index can serve directly; grouping below is map-based, so row order doesn't matter.
          .order("started_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as { vehicle_id: string | null; driver_id: string | null; started_at: string; duration_sec: number }[];
        for (const ev of batch) {
          if (!ev.vehicle_id) continue;
          const dur = Number(ev.duration_sec) || 0;
          if (dur <= 0) continue;
          const segs = ev.driver_id ? segsByDriver.get(ev.driver_id) : undefined;
          if (!segs || segs.length === 0) {
            add(ev.vehicle_id, "otherH", dur); // no driver / no HOS → not attributed to rest or work
            continue;
          }
          const start = Date.parse(ev.started_at);
          const o = hosOverlapSeconds(segs, start, start + dur * 1000);
          add(ev.vehicle_id, "restH", o.restSec);
          add(ev.vehicle_id, "workH", o.workSec);
          // driving + excluded + unknown + any uncovered remainder → other.
          add(ev.vehicle_id, "otherH", o.drivingSec + o.excludedSec + o.unknownSec + Math.max(0, dur - o.coveredSec));
        }
        if (batch.length < PAGE) break;
      }

      // seconds → hours
      for (const [vid, e] of out) out.set(vid, { restH: hrs(e.restH), workH: hrs(e.workH), otherH: hrs(e.otherH) });
      return out;
    },
  });
}
