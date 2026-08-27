import type { SupabaseClient } from "@supabase/supabase-js";
import { notify, loginForDriver } from "../../messaging/index.js";
import {
  isTerminal,
  type AssignLoadRequest,
  type CreateLoadRequest,
  type LoadStatus,
  type ResolveExceptionRequest,
  type UpdateLoadRequest,
  RETURN_TO_DUTY_BLOCK,
} from "@silvicom/shared";
import { toDispatchError, replaceStops, writeEvent, type DispatchResult } from "./shared.js";
import { returnToDutyBlocked } from "../../recruiting/index.js";

/**
 * Dispatch-side writes + lifecycle transitions (P2 split). Each transition names its action, stamps its
 * actor columns, and lets the `loads_status_guard` trigger decide legality — so a caller cannot skip the
 * gate by writing `status` directly. Reads live in `./queries.ts`; shared helpers in `./shared.ts`.
 */

/**
 * §40.25(j): may this driver be put on a load at all? (0237.)
 *
 * A driver whose application admitted a positive or refused pre-employment test in the preceding two
 * years may not perform a safety-sensitive function until §40.305 return-to-duty documentation is on
 * file. Driving a commercial motor vehicle is a safety-sensitive function (§382.107), and in this
 * product the act that puts somebody behind the wheel is a load assignment — so this is where the
 * regulation's "must not use the employee" becomes a refusal.
 *
 * ⚠ **Three call sites, not one.** `assignLoad` is the obvious one and it is not the only way a
 * `driver_id` reaches a load: `createLoad` accepts one on the new load, and `updateLoad` accepts one
 * in its patch. A gate on the action named "assign" would have been trivially walked around by the
 * PATCH the board already uses. Each caller passes the driver it is about to write, and a call with
 * no driver is not gated because unassigning is never the act the regulation forbids.
 *
 * ⚠ The message names no regulation and does not say what the driver admitted (D-UI9). Whoever is
 * assigning the load needs to know it cannot be done and who can undo that; the underlying fact is a
 * §382.401(a) testing record and a dispatcher is not entitled to read it.
 */
async function refuseUnlessReturnToDutyClear<T>(
  admin: SupabaseClient,
  orgId: string,
  driverId: string | null | undefined,
): Promise<DispatchResult<T> | null> {
  if (!driverId) return null;
  if (!(await returnToDutyBlocked(admin, orgId, driverId))) return null;
  return {
    ok: false,
    status: 409,
    code: RETURN_TO_DUTY_BLOCK.code,
    message: RETURN_TO_DUTY_BLOCK.dispatch,
  };
}

export async function createLoad(
  admin: SupabaseClient,
  orgId: string,
  actor: { userId: string; role: string | null },
  input: CreateLoadRequest,
): Promise<DispatchResult<{ id: string }>> {
  const blocked = await refuseUnlessReturnToDutyClear<{ id: string }>(admin, orgId, input.driver_id);
  if (blocked) return blocked;
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
/**
 * The facts a driver can SEE on their phone (D-L8). Changing one of these on a load that is already
 * out there makes the copy in the cab silently wrong — the divergence D53 exists to prevent. Notes and
 * billing references are deliberately absent: emitting on every field would train drivers to ignore
 * the category, which is worse than not emitting at all.
 */
const DRIVER_VISIBLE_FIELDS = ["equipment", "commodity", "hazmat", "total_miles"] as const;
/** A load is "out there" once it has been offered — before that, an edit is just authoring. */
const RELEASED_STATUSES = new Set(["offered", "accepted", "in_transit"]);

export async function updateLoad(
  admin: SupabaseClient,
  orgId: string,
  loadId: string,
  input: UpdateLoadRequest,
  actor?: { userId: string; role: string | null },
): Promise<DispatchResult<{ id: string }>> {
  const { stops, ...fields } = input;
  // Before the patch is built, so a refused assignment never reaches `replaceStops` either.
  const blocked = await refuseUnlessReturnToDutyClear<{ id: string }>(admin, orgId, fields.driver_id);
  if (blocked) return blocked;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) patch[k] = v;
  }

  // Read before writing, so the diff below compares against what the driver was actually shown.
  const { data: before } = await admin
    .from("loads")
    .select(`status, ${DRIVER_VISIBLE_FIELDS.join(", ")}`)
    .eq("org_id", orgId)
    .eq("id", loadId)
    .maybeSingle();

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

  // D-L8: warn that a released load diverged from the copy on the phone. Stops count as a change
  // wholesale — `replaceStops` rewrites them, and a driver reads the stop list as one thing.
  const prior = (before ?? {}) as Record<string, unknown>;
  if (before && RELEASED_STATUSES.has(String(prior.status))) {
    const changed: string[] = DRIVER_VISIBLE_FIELDS.filter(
      (f) => fields[f] !== undefined && fields[f] !== prior[f],
    );
    if (stops) changed.push("stops");
    if (changed.length > 0) {
      await writeEvent(admin, orgId, loadId, {
        actorUserId: actor?.userId ?? null,
        actorRole: actor?.role ?? null,
        kind: "load_changed",
        payload: {
          changed,
          diff: Object.fromEntries(
            changed
              .filter((f) => f !== "stops")
              .map((f) => [f, { from: prior[f], to: (fields as Record<string, unknown>)[f] }]),
          ),
        },
      });
    }
  }
  return { ok: true, data: { id: loadId } };
}

/**
 * Close an exception. `load_events` is append-only — it is the record an auditor reads — so an
 * exception is resolved by a later event naming it, never by editing history. The payload carries the
 * id being resolved and the action taken, so "who cleared this and on what basis" stays answerable.
 */
export async function resolveException(
  admin: SupabaseClient,
  orgId: string,
  loadId: string,
  actor: { userId: string; role: string | null },
  input: ResolveExceptionRequest,
): Promise<DispatchResult<{ id: string }>> {
  const resolves = input.event_id ?? `${input.kind}:${loadId}`;
  await writeEvent(admin, orgId, loadId, {
    actorUserId: actor.userId,
    actorRole: actor.role,
    kind: "exception_resolved",
    payload: { resolves, kind: input.kind, action: input.action, note: input.note ?? null },
  });
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
  const { driver_id: previous, status } = before as { driver_id: string | null; status: LoadStatus };

  // A delivered or canceled load must not be reassignable. This path deliberately never writes
  // `status`, so it never trips `loads_status_guard` — the trigger that refuses every other illegal
  // move on a terminal load simply does not see this one. The UI hid the button
  // (`LoadDetailPanel.vue:60`) and that was the whole enforcement, which is no enforcement at all
  // for anything that is not the UI.
  if (isTerminal(status)) {
    return {
      ok: false,
      status: 409,
      code: "illegal_transition",
      message: `A ${status} load cannot be reassigned`,
    };
  }

  const blocked = await refuseUnlessReturnToDutyClear<{ id: string }>(admin, orgId, input.driver_id);
  if (blocked) return blocked;

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
 * Close a stuck shift from the board — releases the truck for the next driver (D44.5).
 *
 * Targets the SESSION, not the driver (L5). The board is a snapshot refetched every sixty seconds; a
 * driver who signs off and checks into another truck inside that window would otherwise turn a click
 * on a stale row into a close of the shift that just started, reported as success. Closing a session
 * that has already ended is a no-op; a session id from another org is a 404.
 */
export async function endDutySession(
  admin: SupabaseClient,
  orgId: string,
  sessionId: string,
): Promise<DispatchResult<{ id: string }>> {
  const { error } = await admin.rpc("end_duty_session_by_id", {
    p_org: orgId,
    p_session_id: sessionId,
    p_ended_at: null,
    p_odometer: null,
    p_reason: "dispatch",
  });
  if (error) {
    if (error.code === "DG010") {
      return { ok: false, status: 404, code: "not_found", message: "That shift no longer exists" };
    }
    throw new Error(error.message);
  }
  return { ok: true, data: { id: sessionId } };
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
