import { z } from "zod";
import type { LoadStatus } from "./loadsContract.js";

/**
 * Driver App — load lifecycle, the dispatch approval gate, and the event timeline
 * (Phase 3B, migration 0087, decisions D45–D47).
 *
 * Split from `loadsContract.ts` (which holds the read/write shapes) to stay inside the repo's
 * 500-line file budget and to keep the *shapes* separable from the *rules* — the dispatch web app
 * imports mostly rules, the driver app imports mostly shapes.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Lifecycle & the approval gate (Phase 3B, migration 0087, decisions D45–D47)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The statuses a DRIVER may ever see. Identical to the predicate in `loads_driver_scope` (0087) —
 * if these two ever drift, the app will render a load the database will not return. The RLS matrix
 * asserts the database half; `driverVisibleStatuses` keeps the client half honest.
 */
export const DRIVER_VISIBLE_STATUSES = [
  "offered",
  "accepted",
  "in_transit",
  "delivered",
  "canceled",
] as const satisfies readonly LoadStatus[];

export function isDriverVisible(status: LoadStatus): boolean {
  return (DRIVER_VISIBLE_STATUSES as readonly LoadStatus[]).includes(status);
}

/** Human labels for every state — dispatch reads these, drivers only ever see the visible subset. */
export const LOAD_STATUS_LABELS: Record<LoadStatus, string> = {
  draft: "Draft",
  // McLeod's `A` projects here (LR4b), and since LR6 nobody approves anything, so the old "Needs
  // approval" named a step that does not exist. "Available" is McLeod's own word for `A`.
  pending_approval: "Available",
  approved: "Approved",
  offered: "Sent to driver",
  accepted: "Accepted",
  in_transit: "In transit",
  delivered: "Delivered",
  canceled: "Canceled",
};

/**
 * The legal state machine, mirrored by the `loads_status_guard` trigger in 0087. The duplication is
 * deliberate (plan §14.5): this map lets the dispatch UI disable an impossible action and explain
 * why, while the trigger is the backstop that holds against a direct PostgREST write.
 */
export const LOAD_TRANSITIONS: Record<LoadStatus, readonly LoadStatus[]> = {
  draft: ["pending_approval", "canceled"],
  pending_approval: ["approved", "draft", "canceled"],
  // → pending_approval is dispatch un-approving; a driver decline also lands back on `approved`.
  approved: ["offered", "pending_approval", "canceled"],
  offered: ["accepted", "approved", "canceled"],
  accepted: ["in_transit", "approved", "canceled"],
  in_transit: ["delivered", "canceled"],
  delivered: [],
  canceled: [],
};

export function canTransition(from: LoadStatus, to: LoadStatus): boolean {
  return LOAD_TRANSITIONS[from].includes(to);
}

/** Terminal states have no outgoing transition — useful for disabling a whole action row at once. */
export function isTerminal(status: LoadStatus): boolean {
  return LOAD_TRANSITIONS[status].length === 0;
}

// ── the approval checklist — retired in LR6 ───────────────────────────────────
// `approvalChecklist()` was the client half of gate 1 of `loads_status_guard`: named requirements a
// dispatcher had to meet before Approve lit up. Nothing is approved any more (LOADS-MIRROR-PLAN.md
// D-LMR5, LR6), and on every McLeod load it showed red blockers that meant nothing. The database gate
// is still there for a manual load; no path in the product creates one.

// ── acceptance semantics (D46) ────────────────────────────────────────────────
export const DRIVER_TYPES = ["company", "owner_operator"] as const;
export type DriverType = (typeof DRIVER_TYPES)[number];

/** Driver override wins, else the org default, else `company`. Mirrors `resolve_driver_type()`. */
export function resolveDriverType(
  driverType: string | null | undefined,
  orgDefault: string | null | undefined,
): DriverType {
  const pick = driverType ?? orgDefault ?? "company";
  return (DRIVER_TYPES as readonly string[]).includes(pick) ? (pick as DriverType) : "company";
}

export const DECLINE_REASONS = ["hours_of_service", "equipment", "rate_distance", "personal", "other"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export const DECLINE_REASON_LABELS: Record<DeclineReason, string> = {
  hours_of_service: "Hours of service",
  equipment: "Equipment",
  rate_distance: "Rate or distance",
  personal: "Personal",
  other: "Other",
};

export interface AcceptanceCopy {
  primary: string;
  secondary: string;
  /** Reasons offered in the picker — rate/distance only means something to an owner-operator. */
  reasons: readonly DeclineReason[];
  /** Whether declining returns the load to the dispatch queue, or just raises an exception. */
  unassignsOnDecline: boolean;
}

/**
 * The ONLY thing that differs between the two populations: labels, one reason, and whether a decline
 * auto-unassigns. One mechanism, one state machine, one pair of endpoints (D46).
 */
export function acceptanceCopy(type: DriverType): AcceptanceCopy {
  return type === "owner_operator"
    ? {
        primary: "Accept",
        secondary: "Decline",
        reasons: DECLINE_REASONS,
        unassignsOnDecline: true,
      }
    : {
        primary: "I'm ready",
        secondary: "Can't take this",
        reasons: DECLINE_REASONS.filter((r) => r !== "rate_distance"),
        unassignsOnDecline: false,
      };
}

// ── request shapes for the remaining driver endpoints ─────────────────────────
/** `POST /api/me/loads/:id/decline` — a reason is always required; the note is optional colour. */
export const declineLoadRequestSchema = z.object({
  reason: z.enum(DECLINE_REASONS),
  note: z.string().max(500).optional(),
  occurred_at: z.string().optional(),
});
export type DeclineLoadRequest = z.infer<typeof declineLoadRequestSchema>;

/** `POST /api/me/loads/:id/start` — explicit "rolling"; the first worked stop does this implicitly. */
export const startLoadRequestSchema = z.object({
  occurred_at: z.string().optional(),
});
export type StartLoadRequest = z.infer<typeof startLoadRequestSchema>;

// ── the dispatch timeline ─────────────────────────────────────────────────────
export const LOAD_EVENT_KINDS = [
  "created", "submitted", "approved", "rejected", "assigned", "reassigned", "released",
  "accepted", "declined", "started", "stop_arrived", "stop_completed", "stop_skipped",
  "equipment_mismatch", "amended", "canceled", "completed",
  // D-L8 / D-L2 — see migration 0145. `load_changed` warns that a released load diverged from the
  // copy on a driver's phone; `exception_resolved` is how an append-only log closes an exception.
  "load_changed", "exception_resolved",
] as const;
export type LoadEventKind = (typeof LOAD_EVENT_KINDS)[number];

export const loadEventSchema = z.object({
  id: z.uuid(),
  kind: z.enum(LOAD_EVENT_KINDS),
  from_status: z.string().nullable(),
  to_status: z.string().nullable(),
  actor_role: z.string().nullable(),
  actor_name: z.string().nullable().default(null),
  payload: z.record(z.string(), z.unknown()).default({}),
  occurred_at: z.string(),
  recorded_at: z.string(),
});
export type LoadEvent = z.infer<typeof loadEventSchema>;

export const LOAD_EVENT_LABELS: Record<LoadEventKind, string> = {
  created: "Created",
  submitted: "Submitted for approval",
  approved: "Approved",
  rejected: "Sent back",
  assigned: "Driver assigned",
  reassigned: "Driver changed",
  released: "Released to driver",
  accepted: "Accepted by driver",
  declined: "Declined by driver",
  started: "Trip started",
  stop_arrived: "Arrived at stop",
  stop_completed: "Stop completed",
  stop_skipped: "Stop skipped",
  equipment_mismatch: "Equipment differs from plan",
  load_changed: "Changed after release",
  exception_resolved: "Exception resolved",
  amended: "Amended by the TMS feed",
  canceled: "Canceled",
  completed: "Delivered",
};
