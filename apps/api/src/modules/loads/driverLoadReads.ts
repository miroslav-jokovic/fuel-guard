import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DRIVER_VISIBLE_STATUSES,
  TMS_DRIVER_VISIBLE_STATUSES,
  resolveDriverType,
  type DriverType,
  type Load,
} from "@silvicom/shared";
import { fetchAllPagedIn } from "../../lib/paging.js";

/**
 * The driver's own loads, as `GET /api/me/loads` answers them (Driver App Phase 3B; T1 N-9). Split from
 * `driverLoads.ts`, which keeps the actions, at N-9 when the read grew its McLeod half.
 *
 * Reads go through the service role so the response can join unit numbers and nest stops in one
 * round trip (D29 — no launch waterfall). So this file restates no rule RLS would apply: it asks the
 * database's own definition (`driver_visible_tms_load_ids`, 0661) which McLeod loads are this driver's,
 * and org-filters every read itself.
 */

const LOAD_COLUMNS =
  "id, ref, status, equipment, commodity, hazmat, total_miles, accepted_at, completed_at, notes, created_at, " +
  "source, customer_name, vehicles(unit_number), trailers(unit_number)";

const STOP_COLUMNS =
  "id, seq, kind, name, address_line, city, state, postal_code, lat, lon, appointment_start, " +
  "appointment_end, status, arrived_at, completed_at, required_photos, skip_reason, notes, load_id, " +
  // McLeod's account of the stop, shown beside the driver's and never merged into it (Q-MK3), and the
  // stamp of a stop McLeod stopped listing — it stays on the load, behind the driver (D-MK15).
  "external_status, actual_arrival_at, actual_departure_at, mcleod_removed_at";

/**
 * How long a delivered or canceled load stays in the driver's list (D-MK25, T1 Q-8's default), keyed
 * on McLeod's close, else the driver's completion. Applied to the LIST only, never to
 * `driver_load_access`: a phone that comes back after three weeks with a BOL photo still lands it.
 */
export const DRIVER_CLOSED_LOAD_DAYS = 14;
const CLOSED_STATUSES = ["delivered", "canceled"] as const;

type UnitJoin = { unit_number: string } | { unit_number: string }[] | null;
const unit = (u: UnitJoin): string | null =>
  Array.isArray(u) ? (u[0]?.unit_number ?? null) : (u?.unit_number ?? null);

/**
 * The McLeod loads this driver may see, as the database defines it: `driver_visible_tms_load_ids` (0661)
 * is the body every driver policy and the action door read, so this list cannot drift from them. It
 * replaced a TypeScript restatement of 0655's rule (N-9). An error THROWS: answering an empty list is
 * how a driver silently loses the load they are hauling.
 */
async function sentTmsLoadIds(admin: SupabaseClient, orgId: string, driverId: string): Promise<string[]> {
  const { data, error } = await admin.rpc("driver_visible_tms_load_ids", { p_org: orgId, p_driver: driverId });
  if (error) throw new Error(`driver_visible_tms_load_ids: ${error.message}`);
  // `returns setof uuid`: PostgREST answers an array of the values.
  return ((data ?? []) as string[]).filter((id) => typeof id === "string");
}

type LoadRow = Record<string, unknown> & { id: string; source: string; vehicles: UnitJoin; trailers: UnitJoin };

/**
 * D-MK25 as a PostgREST filter: a load is listed unless it is delivered or canceled and closed more
 * than `DRIVER_CLOSED_LOAD_DAYS` ago. `coalesce(external_closed_at, completed_at)` is spelled out: McLeod's
 * close when there is one, else the driver's completion. A closed load with neither is not listed.
 */
function openOrRecentlyClosed(cutoffIso: string): string {
  return [
    `status.not.in.(${CLOSED_STATUSES.join(",")})`,
    `external_closed_at.gte.${cutoffIso}`,
    `and(external_closed_at.is.null,completed_at.gte.${cutoffIso})`,
  ].join(",");
}

/**
 * This driver's "Got it" on each McLeod load's CURRENT dispatch (0661 writes one `acknowledged` event
 * per dispatch per driver). An acknowledgement of an earlier dispatch does not count: the office
 * re-sending a load is a new question.
 */
async function acknowledgedAt(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  tmsIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (tmsIds.length === 0) return out;
  const dispatches = await fetchAllPagedIn<{ id: string; load_id: string }>(tmsIds, (chunk) => (from, to) =>
    admin
      .from("load_dispatches")
      .select("id, load_id")
      .eq("org_id", orgId)
      .in("load_id", chunk)
      // The current dispatch is the newest by `sent_at`, then `id` — exactly 0661's order.
      .order("sent_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );
  const current = new Map<string, string>();
  for (const d of dispatches) if (!current.has(d.load_id)) current.set(d.load_id, d.id);
  if (current.size === 0) return out;

  const acks = await fetchAllPagedIn<{ load_id: string; occurred_at: string; payload: Record<string, unknown> | null }>(
    [...current.keys()],
    (chunk) => (from, to) =>
      admin
        .from("load_events")
        .select("load_id, occurred_at, payload")
        .eq("org_id", orgId)
        .eq("kind", "acknowledged")
        .in("load_id", chunk)
        .eq("payload->>driver_id", driverId)
        .order("id")
        .range(from, to),
  );
  for (const a of acks) {
    if (a.payload?.dispatch_id === current.get(a.load_id)) out.set(a.load_id, a.occurred_at);
  }
  return out;
}

/**
 * Every load the driver may see, stops and photos nested — one payload, no waterfall (D29).
 *
 * Two reads, one per source:
 *   · a manual load — 0087's rule: the driver's own, in the five driver statuses;
 *   · a McLeod load — the ids the database answers above, at any McLeod status but draft. Its
 *     `driver_id` is McLeod's and is deliberately not required: the office's dispatch decides
 *     (D-LMR6), and a co-driver is never `driver_id`.
 * Both drop a load closed more than 14 days ago (D-MK25). The McLeod ids are read in chunks, so a
 * driver with a year of sent loads never builds a URL PostgREST refuses.
 */
export async function getDriverLoads(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  now: Date = new Date(),
): Promise<Load[]> {
  const cutoff = new Date(now.getTime() - DRIVER_CLOSED_LOAD_DAYS * 86_400_000).toISOString();
  const sent = await sentTmsLoadIds(admin, orgId, driverId);

  const [manualRes, tmsRows] = await Promise.all([
    admin
      .from("loads")
      .select(LOAD_COLUMNS)
      .eq("org_id", orgId)
      .neq("source", "tms")
      .eq("driver_id", driverId)
      .in("status", [...DRIVER_VISIBLE_STATUSES])
      .or(openOrRecentlyClosed(cutoff)),
    fetchAllPagedIn<LoadRow>(sent, (chunk) => (from, to) =>
      admin
        .from("loads")
        .select(LOAD_COLUMNS)
        .eq("org_id", orgId)
        .eq("source", "tms")
        .in("status", [...TMS_DRIVER_VISIBLE_STATUSES])
        .in("id", chunk)
        .or(openOrRecentlyClosed(cutoff))
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: LoadRow[] | null; error: { message: string } | null }>,
    ),
  ]);
  if (manualRes.error) throw new Error(`driver loads: ${manualRes.error.message}`);

  const rows = [...((manualRes.data ?? []) as unknown as LoadRow[]), ...tmsRows].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  );
  if (rows.length === 0) return [];

  const loadIds = rows.map((r) => r.id);
  type StopRow = { id: string; load_id: string; seq: number } & Record<string, unknown>;
  type PhotoRow = { stop_id: string; uploaded_at: string } & Record<string, unknown>;
  const [stops, photos, acks] = await Promise.all([
    fetchAllPagedIn<StopRow>(loadIds, (chunk) => (from, to) =>
      admin
        .from("load_stops")
        .select(STOP_COLUMNS)
        .eq("org_id", orgId)
        .in("load_id", chunk)
        .order("load_id")
        .order("seq", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: StopRow[] | null; error: { message: string } | null }>,
    ),
    fetchAllPagedIn<PhotoRow>(loadIds, (chunk) => (from, to) =>
      admin
        .from("load_stop_photos")
        .select("id, slot, storage_path, captured_at, uploaded_at, stop_id")
        .eq("org_id", orgId)
        .in("load_id", chunk)
        .order("uploaded_at", { ascending: true })
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: PhotoRow[] | null; error: { message: string } | null }>,
    ),
    acknowledgedAt(admin, orgId, driverId, rows.filter((r) => r.source === "tms").map((r) => r.id)),
  ]);

  const photosByStop = new Map<string, Record<string, unknown>[]>();
  for (const p of photos) {
    const { stop_id, ...rest } = p;
    const list = photosByStop.get(stop_id) ?? [];
    list.push(rest);
    photosByStop.set(stop_id, list);
  }

  const stopsByLoad = new Map<string, Record<string, unknown>[]>();
  for (const s of stops) {
    const { load_id, ...rest } = s;
    const list = stopsByLoad.get(load_id) ?? [];
    list.push({ ...rest, photos: photosByStop.get(s.id) ?? [] });
    stopsByLoad.set(load_id, list);
  }

  return rows.map((r) => {
    const { vehicles, trailers, ...rest } = r;
    return {
      ...rest,
      vehicle_unit: unit(vehicles),
      trailer_unit: unit(trailers),
      acknowledged_at: acks.get(r.id) ?? null,
      stops: (stopsByLoad.get(r.id) ?? []).sort((a, b) => (a.seq as number) - (b.seq as number)),
    } as unknown as Load;
  });
}

/** One load, or null when the driver may not see it — used to return fresh state after a mutation. */
export async function getDriverLoad(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  loadId: string,
): Promise<Load | null> {
  const all = await getDriverLoads(admin, orgId, driverId);
  return all.find((l) => l.id === loadId) ?? null;
}

/** Company driver or owner-operator — decides the accept copy and the decline behaviour (D46). */
export async function getDriverType(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<DriverType> {
  const [driver, org] = await Promise.all([
    admin.from("drivers").select("driver_type").eq("id", driverId).maybeSingle(),
    admin.from("organizations").select("default_driver_type").eq("id", orgId).maybeSingle(),
  ]);
  return resolveDriverType(
    (driver.data as { driver_type?: string | null } | null)?.driver_type,
    (org.data as { default_driver_type?: string | null } | null)?.default_driver_type,
  );
}
