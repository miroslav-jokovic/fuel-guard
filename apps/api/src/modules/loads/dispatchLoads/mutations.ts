import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolveExceptionRequest } from "@silvicom/shared";
import { writeEvent, type DispatchResult } from "./shared.js";

/**
 * The dispatch-side writes that survive LR6 (LOADS-MIRROR-PLAN.md §3.2).
 *
 * This file used to hold the office's whole authoring surface: create and edit a load, reassign it,
 * and drive it through submit → approve → release (or reject / cancel), singly and in bulk. Every
 * load is McLeod's now and is overwritten on every sync (D-LMR2), and a load reaches its driver by
 * Dispatch (`dispatchToDriver.ts`, D-LMR5), so all of that went. So did the §40.25(j) return-to-duty
 * gate that create, edit and assign carried: it moved to Dispatch, the one act left that puts a driver
 * on a load, rather than leave with its doors.
 *
 * What is left writes no `loads` column: an exception is closed by appending an event, and a stuck
 * shift is closed through its own RPC.
 */

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
