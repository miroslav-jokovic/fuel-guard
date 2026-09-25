import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared internals for the dispatch-side load operations (P2 split of dispatchLoads.ts): the result
 * type, the column lists the read modules share, and `writeEvent`.
 *
 * LR6 took out the trigger-error mapping and `replaceStops`: both served the office's create, edit and
 * transition writes, which no longer exist. The approval gate in `loads_status_guard` (0142) is still
 * in the database, and still refuses an unready manual load, but nothing in the API asks it to.
 */

export type DispatchResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: 404 | 409 | 422; code: string; message: string; detail?: string };

export const LOAD_COLUMNS =
  "id, ref, status, equipment, commodity, hazmat, total_miles, driver_id, vehicle_id, trailer_id, " +
  "source, provider, external_id, created_by, submitted_at, approved_by, approved_at, released_at, " +
  "assigned_by, assigned_at, declined_at, decline_reason, cancel_reason, accepted_at, completed_at, " +
  "notes, external_status, external_synced_at, dispatcher_external_id, created_at, updated_at, " +
  "drivers(full_name), vehicles(unit_number), trailers(unit_number)";

export const STOP_COLUMNS =
  "id, load_id, seq, kind, name, address_line, city, state, postal_code, lat, lon, " +
  "appointment_start, appointment_end, status, arrived_at, completed_at, required_photos, skip_reason, notes, " +
  // McLeod's own view of the stop (LR2 columns, written by the LR4b projection): the real place name,
  // what McLeod saw happen, and its ETA — beside the driver app's `arrived_at`, never in it (Q-LMR2).
  "location_name, external_status, actual_arrival_at, actual_departure_at, eta_at";

export type Join = { unit_number?: string; full_name?: string } | { unit_number?: string; full_name?: string }[] | null;
export const one = (j: Join): { unit_number?: string; full_name?: string } | null =>
  Array.isArray(j) ? (j[0] ?? null) : j;

/** Append a timeline entry. Best-effort in the same sense as the audit log — never blocks the action. */
export async function writeEvent(
  admin: SupabaseClient,
  orgId: string,
  loadId: string,
  entry: {
    /** Null for a system event — a TMS amendment, an auto-close. The role still says who. */
    actorUserId: string | null;
    actorRole: string | null;
    kind: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await admin.from("load_events").insert({
    org_id: orgId,
    load_id: loadId,
    actor_user_id: entry.actorUserId,
    actor_role: entry.actorRole,
    kind: entry.kind,
    from_status: entry.fromStatus ?? null,
    to_status: entry.toStatus ?? null,
    payload: entry.payload ?? {},
  });
  if (error) console.error(`[dispatch] event '${entry.kind}' failed: ${error.message}`);
}
