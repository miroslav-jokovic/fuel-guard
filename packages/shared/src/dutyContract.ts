import { z } from "zod";

/**
 * Driver App — duty sessions & equipment contract (Phase 3A, migration 0086, decisions D43/D44).
 *
 * A DUTY SESSION is one driver's shift. Within it, EQUIPMENT SEGMENTS record the truck and trailer
 * they were in over a half-open window `[from_at, to_at)`. Changing either closes the current segment
 * and opens a new one WITHOUT ending the shift, so equipment is exact at any instant — which is what
 * makes fuel/idle/MPG attribution precise rather than inferred (plan §14.3).
 *
 * The app PARSES every response with these schemas rather than casting (D24), so a drifted server
 * shape fails loudly at the boundary instead of poisoning a cache that lives on the device for days.
 * PostgREST returns `numeric` as a string, hence `z.coerce.number()` on the numeric columns.
 */

// ── enums (mirror the CHECK constraints in 0086) ──────────────────────────────
export const DUTY_SOURCES = ["driver_app", "dispatch", "telematics"] as const;
export type DutySource = (typeof DUTY_SOURCES)[number];

export const DUTY_END_REASONS = ["driver", "taken_over", "auto_timeout", "dispatch"] as const;
export type DutyEndReason = (typeof DUTY_END_REASONS)[number];

export const DUTY_SEATS = ["driver", "co_driver"] as const;
export type DutySeat = (typeof DUTY_SEATS)[number];

export const EQUIPMENT_CONFIRMED_BY = ["driver", "dispatch"] as const;
export type EquipmentConfirmedBy = (typeof EQUIPMENT_CONFIRMED_BY)[number];

/** Human labels for the sign-off reason, so a driver never sees a raw enum. */
export const DUTY_END_REASON_LABELS: Record<DutyEndReason, string> = {
  driver: "Ended by driver",
  taken_over: "Truck taken over",
  auto_timeout: "Closed automatically",
  dispatch: "Ended by dispatch",
};

// ── the pick list (`GET /api/me/equipment`) ───────────────────────────────────
/**
 * Deliberately minimal. RLS keeps the vehicle/trailer roster closed to drivers (0086), so this list
 * is served by the API with the service role and carries ONLY what the picker renders — never
 * odometers, tank capacities or cost data. `in_use_by` is the display name of the driver currently
 * holding the unit, or null when it is free; the sheet uses it to warn BEFORE the 409 rather than
 * after.
 */
export const equipmentOptionSchema = z.object({
  id: z.uuid(),
  unit_number: z.string(),
  make: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  in_use_by: z.string().nullable().default(null),
  in_use_since: z.string().nullable().default(null),
  /** True for the driver's domicile truck (`vehicles.assigned_driver_id`) — pinned as "Your truck". */
  is_default: z.boolean().default(false),
});
export type EquipmentOption = z.infer<typeof equipmentOptionSchema>;

export const meEquipmentResponseSchema = z.object({
  vehicles: z.array(equipmentOptionSchema),
  trailers: z.array(equipmentOptionSchema),
});
export type MeEquipmentResponse = z.infer<typeof meEquipmentResponseSchema>;

// ── read shapes ───────────────────────────────────────────────────────────────
export const dutySegmentSchema = z.object({
  id: z.uuid(),
  vehicle_id: z.uuid(),
  vehicle_unit: z.string().nullable().default(null),
  trailer_id: z.uuid().nullable(),
  trailer_unit: z.string().nullable().default(null),
  seat: z.enum(DUTY_SEATS),
  from_at: z.string(),
  to_at: z.string().nullable(),
  confirmed_by: z.enum(EQUIPMENT_CONFIRMED_BY),
  note: z.string().nullable().default(null),
});
export type DutySegment = z.infer<typeof dutySegmentSchema>;

export const dutySessionSchema = z.object({
  id: z.uuid(),
  driver_id: z.uuid(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  ended_reason: z.enum(DUTY_END_REASONS).nullable(),
  start_odometer: z.coerce.number().nullable(),
  end_odometer: z.coerce.number().nullable(),
  source: z.enum(DUTY_SOURCES),
  /** Ordered oldest-first, so the last entry is the current one while the shift is open. */
  segments: z.array(dutySegmentSchema).default([]),
});
export type DutySession = z.infer<typeof dutySessionSchema>;

/** `GET /api/me/shift` — the active shift, or null when the driver has not checked in. */
export const meShiftResponseSchema = z.object({
  session: dutySessionSchema.nullable(),
});
export type MeShiftResponse = z.infer<typeof meShiftResponseSchema>;

// ── write shapes ──────────────────────────────────────────────────────────────
/**
 * `POST /api/me/shift/start`. Both ids are CLIENT UUIDs and become the row primary keys, so a queued
 * offline check-in that drains twice collides and no-ops (the idempotency contract, plan §13.3).
 * `started_at` records when the driver actually tapped — they may have been offline for hours — while
 * the server still stamps its own authoritative timestamps.
 */
export const startShiftRequestSchema = z.object({
  session_id: z.uuid(),
  segment_id: z.uuid(),
  vehicle_id: z.uuid(),
  trailer_id: z.uuid().nullish(),
  start_odometer: z.number().nonnegative().max(9_999_999).optional(),
  started_at: z.string().optional(),
  device_id: z.string().max(200).optional(),
  /** Set only after the driver was shown who holds the unit and chose to take it (D44.6). */
  take_over: z.boolean().default(false),
});
export type StartShiftRequest = z.infer<typeof startShiftRequestSchema>;

/**
 * `POST /api/me/shift/equipment` — the drop-and-hook / truck-swap path. Does NOT end the shift.
 * Omitting a field keeps the current value; `clear_trailer` is how a driver says "I dropped it and
 * I'm bobtail", which is different from "unchanged" and cannot be expressed by a null alone.
 */
export const changeEquipmentRequestSchema = z
  .object({
    segment_id: z.uuid(),
    vehicle_id: z.uuid().optional(),
    trailer_id: z.uuid().optional(),
    clear_trailer: z.boolean().default(false),
    from_at: z.string().optional(),
    note: z.string().max(500).optional(),
    take_over: z.boolean().default(false),
  })
  .refine((v) => !(v.clear_trailer && v.trailer_id), {
    message: "clear_trailer and trailer_id are mutually exclusive",
    path: ["clear_trailer"],
  })
  .refine((v) => Boolean(v.vehicle_id) || Boolean(v.trailer_id) || v.clear_trailer, {
    message: "Nothing to change — provide vehicle_id, trailer_id, or clear_trailer",
    path: ["segment_id"],
  });
export type ChangeEquipmentRequest = z.infer<typeof changeEquipmentRequestSchema>;

/** `POST /api/me/shift/end`. */
export const endShiftRequestSchema = z.object({
  ended_at: z.string().optional(),
  end_odometer: z.number().nonnegative().max(9_999_999).optional(),
});
export type EndShiftRequest = z.infer<typeof endShiftRequestSchema>;

/**
 * The 409 body when a unit is already checked out. The sheet renders this verbatim — who has it and
 * since when — because a silent take-over would corrupt a week of attribution for two drivers at once
 * (D44.6).
 */
export const EQUIPMENT_CONFLICT_CODES = ["vehicle_in_use", "trailer_in_use", "shift_already_open"] as const;
export type EquipmentConflictCode = (typeof EQUIPMENT_CONFLICT_CODES)[number];

export const equipmentConflictSchema = z.object({
  code: z.enum(EQUIPMENT_CONFLICT_CODES),
  unit_number: z.string().nullable().default(null),
  held_by: z.string().nullable().default(null),
  held_since: z.string().nullable().default(null),
});
export type EquipmentConflict = z.infer<typeof equipmentConflictSchema>;

// ── derivations shared by the app, the API and the dispatch board ─────────────
/** The segment in force right now — the open one. Null when the shift has ended. */
export function currentSegment(session: DutySession | null | undefined): DutySegment | null {
  if (!session) return null;
  return session.segments.find((s) => s.to_at === null) ?? null;
}

/**
 * The segment covering an instant — THE attribution primitive (plan §14.4). Half-open
 * `[from_at, to_at)` so back-to-back segments never both match the changeover moment.
 */
export function segmentAt(
  session: Pick<DutySession, "segments">,
  instantIso: string,
): DutySegment | null {
  const t = Date.parse(instantIso);
  if (Number.isNaN(t)) return null;
  return (
    session.segments.find((s) => {
      const from = Date.parse(s.from_at);
      if (Number.isNaN(from) || t < from) return false;
      if (s.to_at === null) return true;
      const to = Date.parse(s.to_at);
      return !Number.isNaN(to) && t < to;
    }) ?? null
  );
}

/** Is this driver checked in right now? */
export function isOnDuty(session: DutySession | null | undefined): boolean {
  return Boolean(session && session.ended_at === null);
}

/**
 * Equipment strings are free-form (`'Dry van'`, `'Reefer'`, `'Flatbed'`, …) so dispatch can add one
 * without a migration. Only an explicit no-trailer value clears the requirement; an UNKNOWN value
 * returns false, because guessing "yes" would block a driver at a dock over a typo — the gate is a
 * prompt, never a dead-end (D21/D44).
 */
const NO_TRAILER_EQUIPMENT = new Set(["bobtail", "none", "n/a", "na", "-"]);

export function equipmentRequiresTrailer(equipment: string | null | undefined): boolean {
  if (!equipment) return false;
  return !NO_TRAILER_EQUIPMENT.has(equipment.trim().toLowerCase());
}

export const DUTY_GATES = ["ok", "no_shift", "no_trailer"] as const;
export type DutyGate = (typeof DUTY_GATES)[number];

/**
 * The staged soft gate (D44). Vehicle is required to be on duty at all; a trailer is only required
 * once the work actually needs one — completing a pickup on a trailer-equipment load. Everything
 * else stays open, because a driver may legitimately open the app before hooking anything.
 */
export function dutyGate(
  session: DutySession | null | undefined,
  opts: { requiresTrailer?: boolean } = {},
): DutyGate {
  if (!isOnDuty(session)) return "no_shift";
  if (opts.requiresTrailer && !currentSegment(session)?.trailer_id) return "no_trailer";
  return "ok";
}

/** Copy for each gate state — one place, so the app and the web tell the driver the same thing. */
export const DUTY_GATE_MESSAGES: Record<DutyGate, string> = {
  ok: "",
  no_shift: "Confirm your truck first",
  no_trailer: "Add the trailer you're pulling",
};

/** How long the shift has been open, in hours. */
export function sessionHours(
  session: Pick<DutySession, "started_at" | "ended_at">,
  nowMs: number,
): number {
  const start = Date.parse(session.started_at);
  if (Number.isNaN(start)) return 0;
  const end = session.ended_at ? Date.parse(session.ended_at) : nowMs;
  return Math.max(0, (end - start) / 3_600_000);
}

/**
 * Would the sweeper close this shift? Mirrors `close_stale_duty_sessions()` in 0086 so the app can
 * warn ("you've been on duty 15h — still driving?") before the server closes it out from under them.
 */
export function isStaleSession(
  session: Pick<DutySession, "started_at" | "ended_at">,
  timeoutHours: number,
  nowMs: number,
): boolean {
  if (session.ended_at !== null) return false;
  return sessionHours(session, nowMs) >= timeoutHours;
}

/** "Unit 214 · Trailer 5521" / "Unit 214 · Bobtail" — the Home duty card's one-liner. */
export function dutyEquipmentLabel(session: DutySession | null | undefined): string | null {
  const seg = currentSegment(session);
  if (!seg) return null;
  const truck = `Unit ${seg.vehicle_unit ?? "—"}`;
  return seg.trailer_id ? `${truck} · Trailer ${seg.trailer_unit ?? "—"}` : `${truck} · Bobtail`;
}

/**
 * Does the driver's actual equipment match what dispatch planned for a load (D47)? A mismatch is
 * flagged and logged — never blocked, never silently overwritten — so this returns the difference
 * rather than a boolean verdict.
 */
export interface EquipmentMismatch {
  vehicle: boolean;
  trailer: boolean;
}

export function equipmentMismatch(
  session: DutySession | null | undefined,
  planned: { vehicle_id?: string | null; trailer_id?: string | null },
): EquipmentMismatch | null {
  const seg = currentSegment(session);
  if (!seg) return null;
  const vehicle = Boolean(planned.vehicle_id) && planned.vehicle_id !== seg.vehicle_id;
  const trailer = Boolean(planned.trailer_id) && planned.trailer_id !== seg.trailer_id;
  return vehicle || trailer ? { vehicle, trailer } : null;
}
