import { z } from "zod";
import { STOP_KINDS } from "./loadsContract.js";

/**
 * Dispatch API contract (Phase 3D, D49). The web dashboard's write surface for the load lifecycle.
 *
 * Every transition is its OWN endpoint rather than a `PATCH status` — the same rule the driver side
 * follows (D45). That keeps the audited action explicit ("who released this?") instead of inferring
 * intent from a diff, and it means the API can require a reason exactly where one matters.
 */

// ── stops ─────────────────────────────────────────────────────────────────────
export const stopInputSchema = z.object({
  id: z.uuid().optional(), // present when editing an existing stop
  seq: z.number().int().min(1).max(50),
  kind: z.enum(STOP_KINDS),
  name: z.string().min(1).max(200),
  address_line: z.string().max(300).nullish(),
  city: z.string().max(120).nullish(),
  state: z.string().max(60).nullish(),
  postal_code: z.string().max(20).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lon: z.number().min(-180).max(180).nullish(),
  appointment_start: z.string().nullish(),
  appointment_end: z.string().nullish(),
  /** Named photo slots the driver must capture here — free-form so dispatch can add one. */
  required_photos: z.array(z.string().min(1).max(40)).max(12).default([]),
  notes: z.string().max(500).nullish(),
});
export type StopInput = z.infer<typeof stopInputSchema>;

// ── loads ─────────────────────────────────────────────────────────────────────
const loadFields = {
  ref: z.string().min(1).max(60),
  driver_id: z.uuid().nullish(),
  vehicle_id: z.uuid().nullish(),
  trailer_id: z.uuid().nullish(),
  equipment: z.string().max(60).nullish(),
  commodity: z.string().max(200).nullish(),
  hazmat: z.boolean().default(false),
  total_miles: z.number().nonnegative().max(99_999).nullish(),
  notes: z.string().max(2000).nullish(),
};

/** `POST /api/dispatch/loads` — always lands as `draft`; the status is never client-supplied. */
export const createLoadRequestSchema = z.object({
  ...loadFields,
  stops: z.array(stopInputSchema).max(50).default([]),
});
export type CreateLoadRequest = z.infer<typeof createLoadRequestSchema>;

/** `PATCH /api/dispatch/loads/:id` — edit the load and, when given, replace its whole stop list. */
export const updateLoadRequestSchema = z.object({
  ref: loadFields.ref.optional(),
  driver_id: loadFields.driver_id,
  vehicle_id: loadFields.vehicle_id,
  trailer_id: loadFields.trailer_id,
  equipment: loadFields.equipment,
  commodity: loadFields.commodity,
  hazmat: z.boolean().optional(),
  total_miles: loadFields.total_miles,
  notes: loadFields.notes,
  stops: z.array(stopInputSchema).max(50).optional(),
});
export type UpdateLoadRequest = z.infer<typeof updateLoadRequestSchema>;

/** `POST …/assign` — reassignment is its own action so the timeline shows who moved the load. */
export const assignLoadRequestSchema = z.object({
  driver_id: z.uuid(),
  vehicle_id: z.uuid().nullish(),
  trailer_id: z.uuid().nullish(),
});
export type AssignLoadRequest = z.infer<typeof assignLoadRequestSchema>;

/** A reason is mandatory on the two actions a driver or an auditor will ask about later. */
export const reasonRequestSchema = z.object({ reason: z.string().min(1).max(500) });
export type ReasonRequest = z.infer<typeof reasonRequestSchema>;

/** `POST …/approve` and `…/release` carry no body — the actor comes from the verified JWT. */
export const emptyRequestSchema = z.object({}).loose();

// ── the assignments board (D49) ───────────────────────────────────────────────
export const assignmentRowSchema = z.object({
  driver_id: z.uuid(),
  driver_name: z.string(),
  driver_status: z.string().nullable().default(null),
  session_id: z.uuid().nullable(),
  started_at: z.string().nullable(),
  vehicle_id: z.uuid().nullable(),
  vehicle_unit: z.string().nullable(),
  trailer_id: z.uuid().nullable(),
  trailer_unit: z.string().nullable(),
  /** The load they are actively working, if any. */
  load_id: z.uuid().nullable(),
  load_ref: z.string().nullable(),
  load_status: z.string().nullable(),
});
export type AssignmentRow = z.infer<typeof assignmentRowSchema>;

export const assignmentsResponseSchema = z.object({ assignments: z.array(assignmentRowSchema) });
export type AssignmentsResponse = z.infer<typeof assignmentsResponseSchema>;

/** How long a shift has run, for the board's "on duty 11h 20m" column. */
export function shiftDuration(startedAt: string | null, nowMs: number): string {
  if (!startedAt) return "—";
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return "—";
  const mins = Math.max(0, Math.round((nowMs - start) / 60_000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
}
