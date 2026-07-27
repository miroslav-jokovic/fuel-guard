import { z } from "zod";
import type { LoadStatus, LoadStop } from "./loadsContract.js";

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
  pending_approval: "Needs approval",
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

// ── the approval checklist ────────────────────────────────────────────────────
/**
 * What makes approval a real control rather than a rubber stamp: dispatch sees NAMED requirements,
 * `Approve` stays disabled until every required one passes, and each failing item is click-to-fix.
 * Mirrors gate 1 of `loads_status_guard`.
 */
export const APPROVAL_CHECKS = [
  "driver_assigned",
  "vehicle_assigned",
  "trailer_assigned",
  "has_pickup",
  "has_dropoff",
  "appointments_set",
  "hazmat_consistent",
  "photo_slots_set",
] as const;
export type ApprovalCheckId = (typeof APPROVAL_CHECKS)[number];

export interface ApprovalCheck {
  id: ApprovalCheckId;
  label: string;
  /** `false` blocks approval; a failing optional check is a warning dispatch may approve past. */
  required: boolean;
  passed: boolean;
  /** Present when the check failed — what exactly is wrong, in dispatch's words. */
  detail?: string;
}

export interface ApprovalChecklist {
  checks: ApprovalCheck[];
  /** True when every REQUIRED check passes — this is what enables the Approve button. */
  canApprove: boolean;
  blockers: ApprovalCheck[];
  warnings: ApprovalCheck[];
}

/** The shape dispatch holds while editing — a load that may still be missing almost everything. */
export interface ApprovableLoad {
  driver_id?: string | null;
  vehicle_id?: string | null;
  trailer_id?: string | null;
  equipment?: string | null;
  commodity?: string | null;
  hazmat?: boolean | null;
  stops: readonly Pick<
    LoadStop,
    "kind" | "seq" | "name" | "appointment_start" | "appointment_end" | "required_photos"
  >[];
}

/** Commodity words that should force the hazmat flag on — a cheap consistency net, not a DOT oracle. */
const HAZMAT_HINTS = [
  "hazmat",
  "hazardous",
  "flammable",
  "corrosive",
  "explosive",
  "propane",
  "gasoline",
  "diesel fuel",
  "chemical",
  "acid",
  "un1", // UN numbers — UN1203, UN1993, …
  "un2",
  "un3",
];

export function approvalChecklist(load: ApprovableLoad): ApprovalChecklist {
  const stops = load.stops ?? [];
  const pickups = stops.filter((s) => s.kind === "pickup").length;
  const drops = stops.filter((s) => s.kind === "dropoff").length;
  const noAppt = stops.filter((s) => !s.appointment_start || !s.appointment_end);
  const noSlots = stops.filter((s) => (s.required_photos ?? []).length === 0);

  const commodity = (load.commodity ?? "").toLowerCase();
  const hintsHazmat = HAZMAT_HINTS.some((h) => commodity.includes(h));
  const needsTrailer = equipmentRequiresTrailerForLoad(load.equipment);

  const checks: ApprovalCheck[] = [
    {
      id: "driver_assigned",
      label: "Driver assigned",
      required: true,
      passed: Boolean(load.driver_id),
      ...(load.driver_id ? {} : { detail: "Pick the driver this load goes to" }),
    },
    {
      id: "vehicle_assigned",
      label: "Truck assigned",
      required: true,
      passed: Boolean(load.vehicle_id),
      ...(load.vehicle_id ? {} : { detail: "Pick the planned truck" }),
    },
    {
      id: "trailer_assigned",
      label: "Trailer assigned",
      // A warning, not a blocker: the trailer is often unknown until the driver reaches the shipper,
      // and D44 makes the driver confirm it there anyway.
      required: false,
      passed: !needsTrailer || Boolean(load.trailer_id),
      ...(needsTrailer && !load.trailer_id
        ? { detail: `${load.equipment ?? "This equipment"} normally pulls a trailer — none planned` }
        : {}),
    },
    {
      id: "has_pickup",
      label: "At least one pickup",
      required: true,
      passed: pickups >= 1,
      ...(pickups >= 1 ? {} : { detail: "Add a pickup stop" }),
    },
    {
      id: "has_dropoff",
      label: "At least one dropoff",
      required: true,
      passed: drops >= 1,
      ...(drops >= 1 ? {} : { detail: "Add a dropoff stop" }),
    },
    {
      id: "appointments_set",
      label: "Appointment window on every stop",
      required: true,
      passed: stops.length > 0 && noAppt.length === 0,
      ...(stops.length === 0
        ? { detail: "This load has no stops" }
        : noAppt.length > 0
          ? { detail: `${noAppt.length} stop(s) missing a window: ${noAppt.map((s) => s.name).join(", ")}` }
          : {}),
    },
    {
      id: "hazmat_consistent",
      label: "Hazmat flag matches the commodity",
      required: true,
      passed: !hintsHazmat || Boolean(load.hazmat),
      ...(hintsHazmat && !load.hazmat
        ? { detail: `"${load.commodity}" reads as hazardous but the hazmat flag is off` }
        : {}),
    },
    {
      id: "photo_slots_set",
      label: "Proof-of-work photos requested",
      required: false,
      passed: stops.length > 0 && noSlots.length === 0,
      ...(noSlots.length > 0 && stops.length > 0
        ? { detail: `${noSlots.length} stop(s) ask for no photos — the driver will capture nothing there` }
        : {}),
    },
  ];

  const blockers = checks.filter((c) => c.required && !c.passed);
  const warnings = checks.filter((c) => !c.required && !c.passed);
  return { checks, canApprove: blockers.length === 0, blockers, warnings };
}

/**
 * Local copy of the trailer rule so `loadsContract` does not import `dutyContract` — features never
 * reach into each other (D56). Both are one-liners over the same small vocabulary.
 */
const NO_TRAILER_EQUIPMENT = new Set(["bobtail", "none", "n/a", "na", "-"]);
function equipmentRequiresTrailerForLoad(equipment: string | null | undefined): boolean {
  if (!equipment) return false;
  return !NO_TRAILER_EQUIPMENT.has(equipment.trim().toLowerCase());
}

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
  amended: "Amended by the TMS feed",
  canceled: "Canceled",
  completed: "Delivered",
};
