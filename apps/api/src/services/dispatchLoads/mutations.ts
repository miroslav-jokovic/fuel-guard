import type { SupabaseClient } from "@supabase/supabase-js";
import { notify, loginForDriver } from "../notify.js";
import type { AssignLoadRequest, CreateLoadRequest, UpdateLoadRequest } from "@fuelguard/shared";
import { toDispatchError, replaceStops, writeEvent, type DispatchResult } from "./shared.js";

/**
 * Dispatch-side writes + lifecycle transitions (P2 split). Each transition names its action, stamps its
 * actor columns, and lets the `loads_status_guard` trigger decide legality — so a caller cannot skip the
 * gate by writing `status` directly. Reads live in `./queries.ts`; shared helpers in `./shared.ts`.
 */

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

  const { data: updated, error } = await admin
    .from("loads")
    .update(patch)
    .eq("org_id", orgId)
    .eq("id", loadId)
    .select("id")
    .maybeSingle();
  if (error) {
    const mapped = toDispatchError<{ id: string }>(error);
    if (mapped) return mapped;
    throw new Error(error.message);
  }
  // Ownership gate: a 0-row update is NOT an error, so without this a caller could PATCH another
  // org's load id, fall through to replaceStops, and delete that org's pending stops (audit P1-A).
  if (!updated) {
    return { ok: false, status: 404, code: "not_found", message: "That load no longer exists" };
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

  // The whole point of 5N: releasing a load is otherwise invisible until the driver happens to open
  // the app, and a cancellation reaches a truck that may already be rolling. Both are told, now.
  if (action === "release" || action === "cancel") {
    const { data: load } = await admin
      .from("loads")
      .select("ref, driver_id, released_at")
      .eq("id", loadId)
      .maybeSingle();
    const row = load as { ref: string; driver_id: string | null; released_at: string | null } | null;
    if (row?.driver_id) {
      const userId = await loginForDriver(admin, orgId, row.driver_id);
      if (userId) {
        await notify(admin, {
          orgId,
          userId,
          entityType: "load",
          entityId: loadId,
          ...(action === "release"
            ? {
                category: "load_offered" as const,
                title: `New load ${row.ref}`,
                body: "Dispatch sent you a load. Open it to accept.",
                // The release stamp makes the key specific to THIS release: a decline followed by a
                // re-release is a genuinely new fact and notifies again, while a retry does not.
                dedupeKey: `load_offered:${loadId}:${row.released_at ?? now}`,
              }
            : {
                category: "load_canceled" as const,
                title: `${row.ref} was canceled`,
                body: reason ?? "Dispatch canceled this load.",
                // Critical: a load canceled under a driver already driving toward it beats quiet hours.
                severity: "critical" as const,
                dedupeKey: `load_canceled:${loadId}:${now}`,
              }),
        });
      }
    }
  }

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
