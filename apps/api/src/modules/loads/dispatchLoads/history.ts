import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssignmentHistoryQuery, AssignmentHistoryRow } from "@silvicom/shared";

/**
 * The attribution trail (loads plan L5, D-L6).
 *
 * §14.9 designates this the audit record behind every evidence panel the detection engine renders —
 * "who was in this truck at 14:20 on the 3rd" is the question an anomaly investigation opens with,
 * and until now it could only be answered by someone with SQL access. The engine has been citing a
 * trail nobody could open.
 *
 * Reads `driver_equipment_timeline` (0150), so the rule for what counts as a holding — a segment
 * closed by its own shift, a segment that cannot predate it — is the same one the load detail page
 * uses. A second query shape here would be a second answer to the same question.
 */

const PAGE_MAX = 200;

interface TimelineRow {
  session_id: string;
  segment_id: string;
  driver_id: string;
  vehicle_id: string | null;
  trailer_id: string | null;
  seat: string;
  confirmed_by: string;
  session_source: string;
  from_at: string;
  to_at: string | null;
}

/**
 * Segments overlapping [from, to). Filtering happens in the database, not after the fetch: an
 * attribution trail over a year of a hundred-truck fleet is not something to page through in memory.
 */
export async function listAssignmentHistory(
  admin: SupabaseClient,
  orgId: string,
  q: AssignmentHistoryQuery,
): Promise<{ rows: AssignmentHistoryRow[]; nextCursor: string | null }> {
  const limit = Math.min(q.limit, PAGE_MAX);

  let query = admin
    .from("driver_equipment_timeline")
    .select("session_id, segment_id, driver_id, vehicle_id, trailer_id, seat, confirmed_by, session_source, from_at, to_at")
    .eq("org_id", orgId)
    // Overlap, not containment: a segment that started before the window and is still open belongs
    // in it. Asking for containment would hide exactly the long shift an investigation is chasing.
    .lt("from_at", q.to)
    .or(`to_at.is.null,to_at.gt.${q.from}`);

  if (q.driverId) query = query.eq("driver_id", q.driverId);
  if (q.vehicleId) query = query.eq("vehicle_id", q.vehicleId);
  if (q.trailerId) query = query.eq("trailer_id", q.trailerId);
  // Keyset, not offset: an offset page over a table that is still being written skips rows.
  if (q.cursor) query = query.lt("from_at", q.cursor);

  const { data, error } = await query.order("from_at", { ascending: false }).limit(limit + 1);
  if (error) throw new Error(error.message);

  const all = (data ?? []) as unknown as TimelineRow[];
  const hasMore = all.length > limit;
  const page = hasMore ? all.slice(0, limit) : all;
  const nextCursor = hasMore && page.length > 0 ? (page[page.length - 1]!.from_at ?? null) : null;

  const names = await resolveNames(admin, orgId, page);

  return {
    rows: page.map((r) => ({
      session_id: r.session_id,
      segment_id: r.segment_id,
      driver_id: r.driver_id,
      driver_name: names.drivers.get(r.driver_id) ?? null,
      vehicle_id: r.vehicle_id,
      vehicle_unit: r.vehicle_id ? (names.vehicles.get(r.vehicle_id) ?? null) : null,
      trailer_id: r.trailer_id,
      trailer_unit: r.trailer_id ? (names.trailers.get(r.trailer_id) ?? null) : null,
      seat: r.seat,
      confirmed_by: r.confirmed_by,
      session_source: r.session_source,
      from_at: r.from_at,
      to_at: r.to_at,
    })),
    nextCursor,
  };
}

/** Three lookups for the whole page, never one per row. */
async function resolveNames(
  admin: SupabaseClient,
  orgId: string,
  rows: readonly TimelineRow[],
): Promise<{ drivers: Map<string, string>; vehicles: Map<string, string>; trailers: Map<string, string> }> {
  const driverIds = [...new Set(rows.map((r) => r.driver_id))];
  const vehicleIds = [...new Set(rows.map((r) => r.vehicle_id).filter((v): v is string => !!v))];
  const trailerIds = [...new Set(rows.map((r) => r.trailer_id).filter((v): v is string => !!v))];

  const fetch = (table: string, ids: string[], column: string) =>
    ids.length
      ? admin.from(table).select(`id, ${column}`).eq("org_id", orgId).in("id", ids)
      : Promise.resolve({ data: [] });

  const [d, v, t] = await Promise.all([
    fetch("drivers", driverIds, "full_name"),
    fetch("vehicles", vehicleIds, "unit_number"),
    fetch("trailers", trailerIds, "unit_number"),
  ]);

  const toMap = (rowsIn: unknown, column: string): Map<string, string> => {
    const m = new Map<string, string>();
    for (const r of (rowsIn ?? []) as Record<string, string | null>[]) {
      const value = r[column];
      if (r.id && value) m.set(r.id, value);
    }
    return m;
  };

  return {
    drivers: toMap(d.data, "full_name"),
    vehicles: toMap(v.data, "unit_number"),
    trailers: toMap(t.data, "unit_number"),
  };
}
