import { z } from "zod";
import { recordId } from "./recordId.js";

/**
 * Dispatch API contract (Phase 3D, D49): the assignment history and the exceptions feed. The
 * assignments board's row went with its route (DISPATCH-BOARD-PLAN.md Q-DB10, ruled (b) 2026-10-16).
 *
 * The request shapes for creating, editing, reassigning and transitioning a load lived here until
 * LOADS-MIRROR-PLAN.md LR6 removed those routes: every load is McLeod's (D-LMR2) and reaches its driver
 * by Dispatch (`loadDispatchContract.ts`, D-LMR5), so the office no longer writes one.
 */

// ── assignment history (L5 / D-L6) — the attribution trail ────────────────────────────

/**
 * `GET /api/dispatch/assignments/history`. §14.9 designates this the audit record behind every
 * evidence panel the detection engine renders; until L5 it could only be read with SQL access.
 *
 * `from`/`to` are required rather than defaulted. An unbounded attribution query over a hundred-truck
 * fleet is a table scan, and a silent default would be a different question from the one asked.
 */
/**
 * The attribution trail's query (DISPATCH-LOADS-COUNTS-PLAN D-DLC5, 2026-10-20): a range and a
 * driver or a truck. No trailer: the trail is Samsara's driver↔vehicle assignments, which name no
 * trailer. The duty-session fields (seat, confirmed by, source) went with that source.
 */
export const assignmentHistoryQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  driverId: recordId().optional(),
  vehicleId: recordId().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Keyset cursor — the `from_at` of the last row seen. Offset paging skips rows on a live table. */
  cursor: z.string().optional(),
});
export type AssignmentHistoryQuery = z.infer<typeof assignmentHistoryQuerySchema>;

export const assignmentHistoryRowSchema = z.object({
  /** Samsara's own segment, stable across pages: truck, driver and start. */
  segment_id: z.string(),
  /** Null when the Samsara driver is not on the roster; `driver_samsara_id` still names them. */
  driver_id: recordId().nullable(),
  driver_name: z.string().nullable(),
  driver_samsara_id: z.string(),
  vehicle_id: recordId().nullable(),
  vehicle_unit: z.string().nullable(),
  vehicle_samsara_id: z.string(),
  /** McLeod loads this truck was on while the segment ran, by load number; empty when none. */
  load_refs: z.array(z.string()),
  /** An open segment the sync still sees: held right now. Open and NOT still held = ended, time not recorded. */
  still_held: z.boolean(),
  /** When the sync last saw the segment — an ended-but-unrecorded segment's best-known end. */
  last_seen_at: z.string(),
  from_at: z.string(),
  /** Null means still held — the driver has not signed off and the shift has not timed out. */
  to_at: z.string().nullable(),
});
export type AssignmentHistoryRow = z.infer<typeof assignmentHistoryRowSchema>;

export const assignmentHistoryResponseSchema = z.object({
  segments: z.array(assignmentHistoryRowSchema),
  nextCursor: z.string().nullable(),
});
export type AssignmentHistoryResponse = z.infer<typeof assignmentHistoryResponseSchema>;

/** How long a shift has run, for the board's "on duty 11h 20m" column. */
export function shiftDuration(startedAt: string | null, nowMs: number): string {
  if (!startedAt) return "—";
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return "—";
  const mins = Math.max(0, Math.round((nowMs - start) / 60_000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
}

// ── exceptions (D-L2) ─────────────────────────────────────────────────────────
/**
 * The things that go wrong on a load and need a human, per §14.9 (five until LR6).
 *
 * The old client-side `isException()` derived from `loads` columns, which is why it could only ever
 * see two of these — the other three exist only as events. Deriving the feed from the event log is
 * also what makes it complete by construction: a new event kind shows up rather than being silently
 * excluded by a filter nobody remembered to widen.
 */
// `stale_approval` and `load_changed` left in LR6: nothing is approved any more (D-LMR5), and the
// only edit of a released load that raised the second is gone (see `dispatchLoads/exceptions.ts`).
export const EXCEPTION_KINDS = ["declined", "equipment_mismatch", "amended", "auto_timeout"] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

/** The single action that resolves each kind — stated by the server so the UI cannot invent one. */
export const EXCEPTION_ACTIONS = ["review_diff", "adopt_equipment", "acknowledge", "reassign"] as const;
export type ExceptionAction = (typeof EXCEPTION_ACTIONS)[number];

export const EXCEPTION_LABELS: Record<ExceptionKind, string> = {
  declined: "Driver declined",
  equipment_mismatch: "Equipment differs from plan",
  amended: "Amended by the TMS",
  auto_timeout: "Shift auto-closed",
};

export const dispatchExceptionSchema = z.object({
  /** The event id, or a synthetic id for the two derived (non-event) kinds. */
  id: z.string(),
  kind: z.enum(EXCEPTION_KINDS),
  load_id: recordId().nullable(),
  load_ref: z.string().nullable(),
  driver_name: z.string().nullable(),
  /** One sentence: what happened, in the words a dispatcher would use. */
  summary: z.string(),
  /** Kind-specific context — the field diff for an amendment, planned vs actual for a mismatch. */
  detail: z.record(z.string(), z.unknown()).default({}),
  action: z.enum(EXCEPTION_ACTIONS),
  occurred_at: z.string(),
});
export type DispatchException = z.infer<typeof dispatchExceptionSchema>;

export const exceptionsResponseSchema = z.object({ exceptions: z.array(dispatchExceptionSchema) });
export type ExceptionsResponse = z.infer<typeof exceptionsResponseSchema>;

/** Resolving an exception is itself an event (`exception_resolved`) — the log is append-only. */
export const resolveExceptionRequestSchema = z.object({
  /** The `load_events.id` being resolved, absent for the two derived kinds. */
  event_id: recordId().nullish(),
  kind: z.enum(EXCEPTION_KINDS),
  action: z.enum(EXCEPTION_ACTIONS),
  note: z.string().max(500).nullish(),
});
export type ResolveExceptionRequest = z.infer<typeof resolveExceptionRequestSchema>;
