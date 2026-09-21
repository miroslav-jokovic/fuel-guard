import { type Ref, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  aggregateDriverIdle,
  type IdleRow,
  type IdleSummary,
  type IdleClassification,
  type CalendarDay,
  dayRangeInstants,
  todayInZone,
  shiftDay,
} from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { useOrgTimezone } from "@/composables/useOrgTimezone";

const PAGE = 1000;
const WINDOW_DAYS = 30;

/** Date window for the idle views. Both bounds optional; unset `from` defaults to the last 30 days. */
export interface IdleDateFilter {
  /**
   * A CALENDAR day, `YYYY-MM-DD` — never an instant (D-PREC5, queue item 4).
   *
   * It used to be "ISO (inclusive), pass an end-of-day time for a timestamp column", and the
   * consequence was the round trip the audit named: `useIdlingPage` decorated the picker's day with
   * `T00:00:00`/`T23:59:59`, and `rangeBounds` here immediately did `f.to.slice(0, 10)` to get the
   * day back. Two consumers wanted a day, two wanted an instant, and the type could not say which —
   * so it carried the one shape that is wrong for both. The day travels; whichever consumer needs
   * instants resolves them in the carrier's zone at the query.
   */
  from?: CalendarDay;
  to?: CalendarDay;
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

/*
 * `idle_events.started_at` is a `timestamptz`, so the picked days become an instant interval here
 * (D-PREC5 case 2) — in the carrier's zone. The default was
 * `new Date(Date.now() - 30 * 86_400_000).toISOString()`, an instant 30×24h back from NOW, which is
 * not the same as "thirty days ago" on either side of a DST boundary and never began at a midnight.
 */

/**
 * Load idle events in the selected date range (RLS-scoped) and aggregate into the driver leaderboard +
 * fleet idle-$ summary. Read-only; the heavy lifting is the shared pure aggregator.
 */
export function useIdleScores(filters: Ref<IdleDateFilter>) {
  const { zone } = useOrgTimezone();
  return useQuery({
    queryKey: ["idle_scores", filters, zone],
    queryFn: async (): Promise<IdleSummary> => {
      const f = toValue(filters);
      const toDay = f.to ?? todayInZone(new Date(), zone.value);
      const fromDay = f.from ?? shiftDay(toDay, -WINDOW_DAYS);
      const { start: fromIso, endExclusive } = dayRangeInstants(fromDay, toDay, zone.value);
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
        q = q.lt("started_at", endExclusive);
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
