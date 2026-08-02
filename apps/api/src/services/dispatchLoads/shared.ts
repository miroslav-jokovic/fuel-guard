import type { SupabaseClient } from "@supabase/supabase-js";
import type { StopInput } from "@fuelguard/shared";

/**
 * Shared internals for the dispatch-side load operations (P2 split of dispatchLoads.ts). Column lists,
 * the trigger-error → API-result mapping, and the two private write helpers (`replaceStops`, `writeEvent`)
 * live here so the read module (`queries`) and the write module (`mutations`) share one definition.
 *
 * The transition gates themselves live in the `loads_status_guard` trigger (0087) — this layer names the
 * action and records the actor; the database decides whether it is legal.
 */

const PG_TO_API: Record<string, { status: 404 | 409 | 422; code: string; message: string }> = {
  DL010: { status: 409, code: "illegal_transition", message: "That is not a step this load can take" },
  DL011: { status: 422, code: "not_ready", message: "This load is not ready for that yet" },
};

export type DispatchResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: 404 | 409 | 422; code: string; message: string; detail?: string };

interface PgLikeError {
  code?: string | null;
  message?: string | null;
}

export function toDispatchError<T>(error: PgLikeError): DispatchResult<T> | null {
  const mapped = PG_TO_API[error.code ?? ""];
  if (!mapped) return null;
  // The trigger's message names the exact unmet gate ("2 stop(s) missing an appointment window") —
  // that string is the whole reason an operator can fix the load instead of guessing.
  return { ok: false, ...mapped, ...(error.message ? { detail: error.message } : {}) };
}

export const LOAD_COLUMNS =
  "id, ref, status, equipment, commodity, hazmat, total_miles, driver_id, vehicle_id, trailer_id, " +
  "source, provider, external_id, created_by, submitted_at, approved_by, approved_at, released_at, " +
  "assigned_by, assigned_at, declined_at, decline_reason, cancel_reason, accepted_at, completed_at, " +
  "notes, created_at, updated_at, drivers(full_name), vehicles(unit_number), trailers(unit_number)";

export const STOP_COLUMNS =
  "id, load_id, seq, kind, name, address_line, city, state, postal_code, lat, lon, " +
  "appointment_start, appointment_end, status, arrived_at, completed_at, required_photos, skip_reason, notes";

export type Join = { unit_number?: string; full_name?: string } | { unit_number?: string; full_name?: string }[] | null;
export const one = (j: Join): { unit_number?: string; full_name?: string } | null =>
  Array.isArray(j) ? (j[0] ?? null) : j;

/** Replace a load's stops wholesale — simpler and safer than diffing an ordered list. */
export async function replaceStops(
  admin: SupabaseClient,
  orgId: string,
  loadId: string,
  stops: StopInput[],
): Promise<void> {
  // Only stops the driver has not touched may be dropped; a completed stop carries evidence.
  await admin.from("load_stops").delete().eq("org_id", orgId).eq("load_id", loadId).eq("status", "pending");
  if (stops.length === 0) return;
  const { error } = await admin.from("load_stops").upsert(
    stops.map((s) => ({
      ...(s.id ? { id: s.id } : {}),
      org_id: orgId,
      load_id: loadId,
      seq: s.seq,
      kind: s.kind,
      name: s.name,
      address_line: s.address_line ?? null,
      city: s.city ?? null,
      state: s.state ?? null,
      postal_code: s.postal_code ?? null,
      lat: s.lat ?? null,
      lon: s.lon ?? null,
      appointment_start: s.appointment_start ?? null,
      appointment_end: s.appointment_end ?? null,
      required_photos: s.required_photos,
      notes: s.notes ?? null,
    })),
    { onConflict: "load_id,seq" },
  );
  if (error) throw new Error(error.message);
}

/** Append a timeline entry. Best-effort in the same sense as the audit log — never blocks the action. */
export async function writeEvent(
  admin: SupabaseClient,
  orgId: string,
  loadId: string,
  entry: {
    actorUserId: string;
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
