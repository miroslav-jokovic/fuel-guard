import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AssignLoadRequest,
  AssignmentRow,
  CreateLoadRequest,
  StopInput,
  UpdateLoadRequest,
} from "@fuelguard/shared";

/**
 * Dispatch-side load operations (Phase 3D, D49).
 *
 * The counterpart to `driverLoads.ts`. Reads are wide (dispatch sees every status); writes are the
 * lifecycle transitions from D45, each one audited and each one writing a `load_events` row so the
 * timeline answers "who approved this, and when" without anybody reconstructing it from a diff.
 *
 * The transition gates themselves live in the `loads_status_guard` trigger (0087) — this layer names
 * the action and records the actor; the database decides whether it is legal.
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

function toDispatchError<T>(error: PgLikeError): DispatchResult<T> | null {
  const mapped = PG_TO_API[error.code ?? ""];
  if (!mapped) return null;
  // The trigger's message names the exact unmet gate ("2 stop(s) missing an appointment window") —
  // that string is the whole reason an operator can fix the load instead of guessing.
  return { ok: false, ...mapped, ...(error.message ? { detail: error.message } : {}) };
}

const LOAD_COLUMNS =
  "id, ref, status, equipment, commodity, hazmat, total_miles, driver_id, vehicle_id, trailer_id, " +
  "source, provider, external_id, created_by, submitted_at, approved_by, approved_at, released_at, " +
  "assigned_by, assigned_at, declined_at, decline_reason, cancel_reason, accepted_at, completed_at, " +
  "notes, created_at, updated_at, drivers(full_name), vehicles(unit_number), trailers(unit_number)";

const STOP_COLUMNS =
  "id, load_id, seq, kind, name, address_line, city, state, postal_code, lat, lon, " +
  "appointment_start, appointment_end, status, arrived_at, completed_at, required_photos, skip_reason, notes";

type Join = { unit_number?: string; full_name?: string } | { unit_number?: string; full_name?: string }[] | null;
const one = (j: Join): { unit_number?: string; full_name?: string } | null =>
  Array.isArray(j) ? (j[0] ?? null) : j;

/** Every load in the org with stops nested — dispatch's queue, all statuses. */
export async function listLoads(admin: SupabaseClient, orgId: string): Promise<unknown[]> {
  const { data: loads, error } = await admin
    .from("loads")
    .select(LOAD_COLUMNS)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (loads ?? []) as unknown as (Record<string, unknown> & { id: string })[];
  if (rows.length === 0) return [];

  const { data: stops } = await admin
    .from("load_stops")
    .select(STOP_COLUMNS)
    .in("load_id", rows.map((r) => r.id))
    .order("seq", { ascending: true });

  const byLoad = new Map<string, unknown[]>();
  for (const s of (stops ?? []) as unknown as { load_id: string }[]) {
    const list = byLoad.get(s.load_id) ?? [];
    list.push(s);
    byLoad.set(s.load_id, list);
  }

  return rows.map((r) => {
    const { drivers, vehicles, trailers, ...rest } = r as unknown as Record<string, unknown> & {
      drivers: Join;
      vehicles: Join;
      trailers: Join;
    };
    return {
      ...rest,
      driver_name: one(drivers)?.full_name ?? null,
      vehicle_unit: one(vehicles)?.unit_number ?? null,
      trailer_unit: one(trailers)?.unit_number ?? null,
      stops: byLoad.get(r.id) ?? [],
    };
  });
}

/** The append-only timeline for one load, newest first, with the actor's name resolved. */
export async function listEvents(admin: SupabaseClient, orgId: string, loadId: string): Promise<unknown[]> {
  const { data } = await admin
    .from("load_events")
    .select("id, kind, from_status, to_status, actor_role, payload, occurred_at, recorded_at, drivers(full_name)")
    .eq("org_id", orgId)
    .eq("load_id", loadId)
    .order("occurred_at", { ascending: false });

  return ((data ?? []) as unknown as (Record<string, unknown> & { drivers: Join })[]).map((e) => {
    const { drivers, ...rest } = e;
    return { ...rest, actor_name: one(drivers)?.full_name ?? null };
  });
}

/** Replace a load's stops wholesale — simpler and safer than diffing an ordered list. */
async function replaceStops(
  admin: SupabaseClient,
  orgId: string,
  loadId: string,
  stops: StopInput[],
): Promise<void> {
  // Only stops the driver has not touched may be dropped; a completed stop carries evidence.
  await admin.from("load_stops").delete().eq("load_id", loadId).eq("status", "pending");
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
async function writeEvent(
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

export async function createLoad(
  admin: SupabaseClient,
  orgId: string,
  actor: { userId: string; role: string | null },
  input: CreateLoadRequest,
): Promise<DispatchResult<{ id: string }>> {
  // `status` is never client-supplied — a new load is a draft, full stop (D45).
  const { data, error } = await admin
    .from("loads")
    .insert({
      org_id: orgId,
      ref: input.ref,
      driver_id: input.driver_id ?? null,
      vehicle_id: input.vehicle_id ?? null,
      trailer_id: input.trailer_id ?? null,
      equipment: input.equipment ?? null,
      commodity: input.commodity ?? null,
      hazmat: input.hazmat,
      total_miles: input.total_miles ?? null,
      notes: input.notes ?? null,
      source: "manual",
      status: "draft",
      created_by: actor.userId,
      ...(input.driver_id ? { assigned_by: actor.userId, assigned_at: new Date().toISOString() } : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const id = (data as { id: string }).id;
  if (input.stops.length > 0) await replaceStops(admin, orgId, id, input.stops);
  await writeEvent(admin, orgId, id, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    kind: "created",
    toStatus: "draft",
    payload: { ref: input.ref, stops: input.stops.length },
  });
  return { ok: true, data: { id } };
}

/**
 * Field edits only. Deliberately writes NO `load_events` row: an edit is not a lifecycle move, and
 * filling the timeline with keystroke-level noise would bury the entries that matter (who approved,
 * who released, who declined). The audit log still records that the load was updated and by whom.
 */
export async function updateLoad(
  admin: SupabaseClient,
  orgId: string,
  loadId: string,
  input: UpdateLoadRequest,
): Promise<DispatchResult<{ id: string }>> {
  const { stops, ...fields } = input;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) patch[k] = v;
  }

  const { error } = await admin.from("loads").update(patch).eq("org_id", orgId).eq("id", loadId);
  if (error) {
    const mapped = toDispatchError<{ id: string }>(error);
    if (mapped) return mapped;
    throw new Error(error.message);
  }
  if (stops) await replaceStops(admin, orgId, loadId, stops);
  return { ok: true, data: { id: loadId } };
}

/**
 * The lifecycle transitions. Each names its action, stamps its actor columns, and lets the trigger
 * decide legality — so a caller cannot skip the gate by writing `status` directly.
 */
export async function transitionLoad(
  admin: SupabaseClient,
  orgId: string,
  loadId: string,
  actor: { userId: string; role: string | null },
  action: "submit" | "approve" | "reject" | "release" | "cancel",
  reason?: string,
): Promise<DispatchResult<{ id: string }>> {
  const { data: before } = await admin
    .from("loads")
    .select("status")
    .eq("org_id", orgId)
    .eq("id", loadId)
    .maybeSingle();
  if (!before) {
    return { ok: false, status: 404, code: "not_found", message: "That load no longer exists" };
  }
  const from = (before as { status: string }).status;

  const now = new Date().toISOString();
  const PATCH: Record<typeof action, Record<string, unknown>> = {
    submit: { status: "pending_approval", submitted_at: now },
    approve: { status: "approved", approved_by: actor.userId, approved_at: now },
    reject: { status: "draft", approved_by: null, approved_at: null, cancel_reason: reason ?? null },
    release: { status: "offered", released_at: now },
    cancel: { status: "canceled", cancel_reason: reason ?? null },
  };
  const EVENT: Record<typeof action, string> = {
    submit: "submitted",
    approve: "approved",
    reject: "rejected",
    release: "released",
    cancel: "canceled",
  };

  const { error } = await admin.from("loads").update(PATCH[action]).eq("org_id", orgId).eq("id", loadId);
  if (error) {
    const mapped = toDispatchError<{ id: string }>(error);
    if (mapped) return mapped;
    throw new Error(error.message);
  }

  await writeEvent(admin, orgId, loadId, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    kind: EVENT[action],
    fromStatus: from,
    toStatus: PATCH[action].status as string,
    ...(reason ? { payload: { reason } } : {}),
  });
  return { ok: true, data: { id: loadId } };
}

/** Assign or reassign — separate from `PATCH` so the timeline distinguishes the two. */
export async function assignLoad(
  admin: SupabaseClient,
  orgId: string,
  loadId: string,
  actor: { userId: string; role: string | null },
  input: AssignLoadRequest,
): Promise<DispatchResult<{ id: string }>> {
  const { data: before } = await admin
    .from("loads")
    .select("driver_id, status")
    .eq("org_id", orgId)
    .eq("id", loadId)
    .maybeSingle();
  if (!before) {
    return { ok: false, status: 404, code: "not_found", message: "That load no longer exists" };
  }
  const previous = (before as { driver_id: string | null }).driver_id;

  const { error } = await admin
    .from("loads")
    .update({
      driver_id: input.driver_id,
      ...(input.vehicle_id !== undefined ? { vehicle_id: input.vehicle_id } : {}),
      ...(input.trailer_id !== undefined ? { trailer_id: input.trailer_id } : {}),
      assigned_by: actor.userId,
      assigned_at: new Date().toISOString(),
    })
    .eq("org_id", orgId)
    .eq("id", loadId);
  if (error) throw new Error(error.message);

  await writeEvent(admin, orgId, loadId, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    kind: previous && previous !== input.driver_id ? "reassigned" : "assigned",
    payload: { from: previous, to: input.driver_id },
  });
  return { ok: true, data: { id: loadId } };
}

/**
 * The Assignments board (D49): every driver, whether they are on duty, in which truck and trailer,
 * since when, and what they are working. This is the surface that makes duty sessions useful to
 * dispatch rather than only to the attribution engine.
 */
export async function listAssignments(admin: SupabaseClient, orgId: string): Promise<AssignmentRow[]> {
  const [driversRes, sessionsRes, loadsRes] = await Promise.all([
    admin.from("drivers").select("id, full_name, status").eq("org_id", orgId).order("full_name"),
    admin
      .from("driver_duty_sessions")
      .select("id, driver_id, started_at, duty_equipment_segments!inner(vehicle_id, trailer_id, to_at, vehicles(unit_number), trailers(unit_number))")
      .eq("org_id", orgId)
      .is("ended_at", null),
    admin
      .from("loads")
      .select("id, ref, status, driver_id")
      .eq("org_id", orgId)
      .in("status", ["offered", "accepted", "in_transit"]),
  ]);

  type SegJoin = { vehicle_id: string | null; trailer_id: string | null; to_at: string | null; vehicles: Join; trailers: Join };
  type SessionRow = { id: string; driver_id: string; started_at: string; duty_equipment_segments: SegJoin[] };

  const byDriver = new Map<string, SessionRow>();
  for (const s of (sessionsRes.data ?? []) as unknown as SessionRow[]) byDriver.set(s.driver_id, s);

  const loadByDriver = new Map<string, { id: string; ref: string; status: string }>();
  for (const l of (loadsRes.data ?? []) as unknown as { id: string; ref: string; status: string; driver_id: string | null }[]) {
    if (!l.driver_id) continue;
    // in_transit outranks accepted outranks offered — show what they are actually doing.
    const held = loadByDriver.get(l.driver_id);
    const rank = (s: string) => (s === "in_transit" ? 3 : s === "accepted" ? 2 : 1);
    if (!held || rank(l.status) > rank(held.status)) {
      loadByDriver.set(l.driver_id, { id: l.id, ref: l.ref, status: l.status });
    }
  }

  return ((driversRes.data ?? []) as { id: string; full_name: string; status: string | null }[]).map((d) => {
    const session = byDriver.get(d.id);
    const seg = session?.duty_equipment_segments.find((s) => s.to_at === null) ?? null;
    const load = loadByDriver.get(d.id) ?? null;
    return {
      driver_id: d.id,
      driver_name: d.full_name,
      driver_status: d.status,
      session_id: session?.id ?? null,
      started_at: session?.started_at ?? null,
      vehicle_id: seg?.vehicle_id ?? null,
      vehicle_unit: one(seg?.vehicles ?? null)?.unit_number ?? null,
      trailer_id: seg?.trailer_id ?? null,
      trailer_unit: one(seg?.trailers ?? null)?.unit_number ?? null,
      load_id: load?.id ?? null,
      load_ref: load?.ref ?? null,
      load_status: load?.status ?? null,
    };
  });
}

/** Close a stuck shift from the board — releases the truck for the next driver (D44.5). */
export async function endDutySession(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<void> {
  const { error } = await admin.rpc("end_duty_session", {
    p_org: orgId,
    p_driver: driverId,
    p_ended_at: null,
    p_odometer: null,
    p_reason: "dispatch",
  });
  if (error) throw new Error(error.message);
}

/**
 * Approve (and optionally release) many loads at once — the TMS batch case (D49).
 *
 * The per-row gate is NOT relaxed: each load goes through the same transition, so the trigger
 * enforces the same preconditions it would for a single click. Outcomes are reported PER ROW and a
 * failure never aborts the batch — "23 approved, 2 need a driver" is actionable; a single 422 for the
 * whole batch is not, and silently approving 23 while dropping 2 on the floor is worse than either.
 */
export interface BulkOutcome {
  id: string;
  ref: string;
  ok: boolean;
  code?: string;
  message?: string;
}

export async function bulkTransition(
  admin: SupabaseClient,
  orgId: string,
  ids: string[],
  actor: { userId: string; role: string | null },
  action: "approve" | "release",
): Promise<{ succeeded: number; failed: number; outcomes: BulkOutcome[] }> {
  const { data } = await admin.from("loads").select("id, ref").eq("org_id", orgId).in("id", ids);
  const refs = new Map<string, string>();
  for (const r of (data ?? []) as { id: string; ref: string }[]) refs.set(r.id, r.ref);

  const outcomes: BulkOutcome[] = [];
  for (const id of ids) {
    const ref = refs.get(id) ?? id;
    try {
      const result = await transitionLoad(admin, orgId, id, actor, action);
      outcomes.push(
        result.ok
          ? { id, ref, ok: true }
          : { id, ref, ok: false, code: result.code, message: result.detail ?? result.message },
      );
    } catch (e) {
      outcomes.push({ id, ref, ok: false, code: "error", message: e instanceof Error ? e.message : "failed" });
    }
  }
  const succeeded = outcomes.filter((o) => o.ok).length;
  return { succeeded, failed: outcomes.length - succeeded, outcomes };
}
