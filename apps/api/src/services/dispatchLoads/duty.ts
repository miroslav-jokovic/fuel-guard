import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the driver was ACTUALLY in, per stop (loads plan LD5).
 *
 * `loads.vehicle_id` and `loads.trailer_id` are dispatch's plan (D47). The duty segment is the
 * truth, and until now the load detail page could only show the plan — so a swapped truck was
 * invisible to the office unless D47 happened to have fired an `equipment_mismatch` at accept time.
 * A driver who swapped mid-run produced no event at all.
 *
 * The attribution rule itself lives in the `driver_equipment_timeline` view (0150), not here: two
 * implementations of "which segment covers this instant" will eventually disagree, and the one that
 * disagrees quietly mis-attributes a week of fuel.
 *
 * ONE QUERY REGARDLESS OF STOP COUNT. The driver's segments over the load's span are read once and
 * matched in memory; a per-stop round trip would make a twelve-stop load twelve queries for
 * information that is a handful of rows.
 */

export interface StopEquipment {
  /** The instant attribution was resolved at — when the stop was completed, else when it was reached. */
  at: string;
  vehicle_id: string | null;
  vehicle_unit: string | null;
  trailer_id: string | null;
  trailer_unit: string | null;
  seat: string;
  /** True when this differs from what dispatch planned — the D47 flag, computed per stop. */
  differs_from_plan: boolean;
}

interface TimelineRow {
  vehicle_id: string | null;
  trailer_id: string | null;
  seat: string;
  from_at: string;
  to_at: string | null;
}

interface StopLike {
  id: string;
  arrived_at?: string | null;
  completed_at?: string | null;
}

/**
 * When to attribute a stop. Completion is preferred over arrival because the equipment that matters
 * is what the work was done with; a stop that has neither has not been worked, and guessing at
 * "now" would attribute a future stop to the truck the driver happens to be in today.
 */
export function attributionInstant(stop: StopLike): string | null {
  return stop.completed_at ?? stop.arrived_at ?? null;
}

/** The segment covering an instant. Half-open [from_at, to_at) so a handover instant belongs to
 *  exactly one segment rather than to both sides of it. */
export function segmentAt(rows: readonly TimelineRow[], instant: string): TimelineRow | null {
  const t = Date.parse(instant);
  if (Number.isNaN(t)) return null;
  for (const r of rows) {
    const from = Date.parse(r.from_at);
    if (Number.isNaN(from) || from > t) continue;
    if (r.to_at !== null && Date.parse(r.to_at) <= t) continue;
    return r;
  }
  return null;
}

/**
 * Resolve the equipment actually in use at each stop of one load.
 *
 * Returns an empty map when the load has no driver or no stop has been worked — both are ordinary
 * states for a load that has not started, not errors.
 */
export async function stopEquipment(
  admin: SupabaseClient,
  orgId: string,
  driverId: string | null,
  stops: readonly StopLike[],
  planned: { vehicle_id: string | null; trailer_id: string | null },
): Promise<Map<string, StopEquipment>> {
  const out = new Map<string, StopEquipment>();
  if (!driverId) return out;

  const instants = stops
    .map((s) => ({ id: s.id, at: attributionInstant(s) }))
    .filter((s): s is { id: string; at: string } => s.at !== null);
  if (instants.length === 0) return out;

  const times = instants.map((s) => Date.parse(s.at)).filter((n) => !Number.isNaN(n));
  if (times.length === 0) return out;
  const earliest = new Date(Math.min(...times)).toISOString();
  const latest = new Date(Math.max(...times)).toISOString();

  // Segments that overlap the worked span: they started before the last stop, and had not ended
  // before the first. An open segment (`to_at is null`) always qualifies.
  const { data, error } = await admin
    .from("driver_equipment_timeline")
    .select("vehicle_id, trailer_id, seat, from_at, to_at")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .lte("from_at", latest)
    .or(`to_at.is.null,to_at.gt.${earliest}`)
    .order("from_at", { ascending: false });
  // Attribution is context, not the page. A failure here must not take the stops, the photos and the
  // timeline down with it — the same rule the photo read follows.
  if (error || !data) return out;

  const rows = data as unknown as TimelineRow[];
  if (rows.length === 0) return out;

  const units = await unitNumbers(admin, orgId, rows);

  for (const { id, at } of instants) {
    const seg = segmentAt(rows, at);
    if (!seg) continue;
    out.set(id, {
      at,
      vehicle_id: seg.vehicle_id,
      vehicle_unit: seg.vehicle_id ? (units.vehicles.get(seg.vehicle_id) ?? null) : null,
      trailer_id: seg.trailer_id,
      trailer_unit: seg.trailer_id ? (units.trailers.get(seg.trailer_id) ?? null) : null,
      seat: seg.seat,
      // A plan with no equipment on it is not a mismatch — dispatch simply did not say.
      differs_from_plan:
        (planned.vehicle_id !== null && seg.vehicle_id !== planned.vehicle_id)
        || (planned.trailer_id !== null && seg.trailer_id !== planned.trailer_id),
    });
  }
  return out;
}

async function unitNumbers(
  admin: SupabaseClient,
  orgId: string,
  rows: readonly TimelineRow[],
): Promise<{ vehicles: Map<string, string>; trailers: Map<string, string> }> {
  const vehicleIds = [...new Set(rows.map((r) => r.vehicle_id).filter((v): v is string => !!v))];
  const trailerIds = [...new Set(rows.map((r) => r.trailer_id).filter((v): v is string => !!v))];

  const [v, t] = await Promise.all([
    vehicleIds.length
      ? admin.from("vehicles").select("id, unit_number").eq("org_id", orgId).in("id", vehicleIds)
      : Promise.resolve({ data: [] }),
    trailerIds.length
      ? admin.from("trailers").select("id, unit_number").eq("org_id", orgId).in("id", trailerIds)
      : Promise.resolve({ data: [] }),
  ]);

  const toMap = (rowsIn: unknown): Map<string, string> => {
    const m = new Map<string, string>();
    for (const r of (rowsIn ?? []) as { id: string; unit_number: string | null }[]) {
      if (r.unit_number) m.set(r.id, r.unit_number);
    }
    return m;
  };
  return { vehicles: toMap(v.data), trailers: toMap(t.data) };
}

export interface ExternalProvenance {
  provider: string;
  raw: Record<string, unknown>;
  synced_at: string;
}

/**
 * The last payload the TMS sent for this load. Office-only at the database (0150) AND fetched only
 * for a caller the route has already gated — belt and braces, because this can carry rates.
 */
export async function externalPayload(
  admin: SupabaseClient,
  orgId: string,
  loadId: string,
): Promise<ExternalProvenance | null> {
  const { data, error } = await admin
    .from("load_external_payloads")
    .select("provider, raw, synced_at")
    .eq("org_id", orgId)
    .eq("load_id", loadId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as ExternalProvenance;
}
