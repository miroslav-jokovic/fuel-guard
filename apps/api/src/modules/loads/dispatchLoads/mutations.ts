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
 * What is left writes no `loads` column: an exception is closed by appending an event.
 *
 * Closing a driver's stuck in-app shift from the office went too (DISPATCH-BOARD-PLAN.md Q-DB10,
 * ruled (b) 2026-10-16): the board remodel had already dropped its button, production had never
 * opened a duty session, and the 16-hour sweeper (`dutySessionSweeper.ts`) closes any shift left open.
 * The RPC it called, `end_duty_session_by_id` (0151), stays in the schema for option (a) — End shift
 * in the truck drawer — when the driver app's duty check-in is in use.
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
