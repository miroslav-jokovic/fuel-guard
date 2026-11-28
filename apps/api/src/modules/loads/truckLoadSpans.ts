/**
 * Every load one truck has run, as a time span, for "which load was this truck on at that moment"
 * (OUT-OF-ROUTE-MAP-ANALYSIS-2026-11-27 D-ORM2). The span rule is shared `loadSpanOf`; the choice is
 * shared `loadAtInstant`. This only reads.
 *
 * Canceled loads are left out: a McLeod load McLeod voided (`V`, 122 of 12,570 on 2026-11-27) was never
 * driven. Stops McLeod removed are left out the way `readLoadForRoute` leaves them out. Paged twice — the
 * loads (106 at most on one truck today, and it only grows) and their stops in chunks of 50 ids, the
 * two ceilings `fetchAllPagedIn` exists for. Org-scoped on both tables.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSpanOf, type LoadSpan, type SpanStop } from "@silvicom/shared";
import { fetchAllPaged, fetchAllPagedIn } from "../../lib/paging.js";

interface StopRow {
  load_id: string;
  seq: number | null;
  actual_arrival_at: string | null;
  actual_departure_at: string | null;
  appointment_start: string | null;
  appointment_end: string | null;
  completed_at: string | null;
}

export async function readTruckLoadSpans(admin: SupabaseClient, orgId: string, vehicleId: string): Promise<LoadSpan[]> {
  const loads = await fetchAllPaged<{ id: string }>((from, to) =>
    admin.from("loads").select("id").eq("org_id", orgId).eq("vehicle_id", vehicleId).neq("status", "canceled").order("id").range(from, to),
  );
  const stops = await fetchAllPagedIn<StopRow>(
    loads.map((l) => l.id),
    (ids) => (from, to) =>
      admin
        .from("load_stops")
        .select("load_id, seq, actual_arrival_at, actual_departure_at, appointment_start, appointment_end, completed_at")
        .eq("org_id", orgId)
        .is("mcleod_removed_at", null)
        .in("load_id", [...ids])
        .order("load_id")
        .order("seq")
        .range(from, to),
  );
  const byLoad = new Map<string, SpanStop[]>();
  for (const s of stops) {
    if (s.seq === null) continue;
    const list = byLoad.get(s.load_id) ?? [];
    list.push({
      seq: s.seq,
      actualArrivalAt: s.actual_arrival_at,
      actualDepartureAt: s.actual_departure_at,
      appointmentStart: s.appointment_start,
      appointmentEnd: s.appointment_end,
      completedAt: s.completed_at,
    });
    byLoad.set(s.load_id, list);
  }
  return loads.map((l) => loadSpanOf(l.id, byLoad.get(l.id) ?? []));
}
