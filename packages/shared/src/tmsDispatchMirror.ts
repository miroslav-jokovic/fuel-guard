import { z } from "zod";

/**
 * The dispatch mirror's wire contract — `POST /api/tms/dispatch-movements` (LOADS-MIRROR-PLAN.md LR3,
 * D-LMR3). What McLeod said about a movement on the board, verbatim, for `mcleod_dispatch_movements` /
 * `mcleod_dispatch_stops` (0364, 0367).
 *
 * A sibling of `tms.ts` rather than a section of it only because that file is at 468 of its 500 lines;
 * it is the same contract family and is exported beside it.
 *
 * ── EVERY KEY IS REQUIRED, NULL IS THE ONLY WAY TO SAY "NONE" ──────────────────────────────────────
 * The ingest writes COMPLETE rows (`lint:upserts`), and a complete row can only be built from a payload
 * that states every column. So nothing here is optional: an agent that forgets a field fails at this
 * door with the field's name, instead of the ingest silently writing null over a value McLeod still has.
 *
 * ── TIMES ARE INSTANTS, ALREADY ZONED ────────────────────────────────────────────────────────────
 * `z.iso.datetime()` accepts `…Z` only. McLeod's own shape — `2026-09-30T17:00:00`, zoneless Central —
 * is REFUSED here, because a zoneless string written to `timestamptz` is read as UTC and lands five
 * hours early (the load feed did exactly that until 2026-09-24). The agent's `centralToIso` is the
 * only thing that may give a McLeod time its zone.
 */

const text = z.string().trim().min(1).nullable();
const instant = z.iso.datetime().nullable();

export const tmsDispatchStopSchema = z.object({
  stop_id: z.string().trim().min(1),
  movement_sequence: z.number().int().nullable(),
  // Verbatim, with no enum: VA/SP are the stops the load feed drops, and a closed list here would
  // drop them again one layer down.
  stop_type: text,
  status: text,
  location_id: text,
  location_name: text,
  address: text,
  city_name: text,
  state: text,
  zip_code: text,
  latitude: z.number().min(-90).max(90).nullable(),
  // West-negative, as the raw table's CHECK requires; refused here with a message a person can read.
  longitude: z.number().min(-180).max(0, "longitude must be west-negative — McLeod's west-positive value was not negated").nullable(),
  sched_arrive_early: instant,
  sched_arrive_late: instant,
  actual_arrival: instant,
  actual_departure: instant,
  eta: instant,
  contact_name: text,
  phone: text,
  ponum: text,
});
export type TmsDispatchStop = z.infer<typeof tmsDispatchStopSchema>;

export const tmsDispatchMovementSchema = z.object({
  movement_id: z.string().trim().min(1),
  order_id: text,
  blnum: text,
  movement_status: text,
  loaded: text,
  dispatcher_user_id: text,
  driver_codes: z.array(z.string().trim().min(1)).max(10),
  tractor_id: text,
  trailer_id: text,
  trailer_type: text,
  commodity: text,
  customer_id: text,
  // Q-LMR5 (0383): `customer.name`, joined on company and id. Required like every key here — a
  // connector older than the join fails at this door by name rather than blanking a stored name.
  customer_name: text,
  weight: z.number().nonnegative().nullable(),
  weight_um: text,
  pieces: z.number().int().nonnegative().nullable(),
  pallets_how_many: z.number().int().nonnegative().nullable(),
  consignee_refno: text,
  move_distance: z.number().nonnegative().nullable(),
  // 12 is the most measured on one movement (2026-09-24); 50 bounds a malformed payload, not a real one.
  stops: z.array(tmsDispatchStopSchema).max(50),
  ...orderChargeShape(),
});
export type TmsDispatchMovement = z.infer<typeof tmsDispatchMovementSchema>;

/**
 * What McLeod says the movement's ORDER pays (LOAD-RATES-PLAN.md D-RATE1; raw columns 0638).
 *
 * ⚠ OPTIONAL, against this file's every-key-required rule, and on purpose (D-RATE9). The Board VM runs a
 * connector that does not read these yet, and a required key would refuse its whole board at this door.
 * So the seven travel together or not at all:
 *  · ABSENT — this connector does not read charges. The ingest leaves the stored values exactly as they
 *    are; it never writes null over a figure a newer connector stored.
 *  · PRESENT (null allowed) — McLeod's own statement, blanks included.
 *  · SOME but not all, on a movement or across a batch — refused with 400 (`orderChargeProblem`): no
 *    connector we ship sends that, and storing half would mix two readings of one order.
 * Removed by plan step R5, once the VM runs the new connector: the keys become required.
 *
 * Money and miles are not sign-checked: McLeod records negative other charges (10 orders since
 * 2026-01-01, as low as −$1,000), and refusing one would refuse the whole board. `z.number()` already
 * refuses NaN and ±Infinity.
 */
function orderChargeShape() {
  return {
    total_charge: z.number().nullable().optional(),
    freight_charge: z.number().nullable().optional(),
    otherchargetotal: z.number().nullable().optional(),
    total_charge_c: text.optional(),
    bill_distance: z.number().nullable().optional(),
    bill_distance_um: text.optional(),
    // The connector's own count of the order's non-void loaded movements, never McLeod's column.
    order_loaded_movements: z.number().int().nonnegative().nullable().optional(),
  };
}

export const ORDER_CHARGE_KEYS = [
  "total_charge", "freight_charge", "otherchargetotal", "total_charge_c", "bill_distance", "bill_distance_um",
  "order_loaded_movements",
] as const satisfies readonly (keyof TmsDispatchMovement)[];
export type OrderChargeKey = (typeof ORDER_CHARGE_KEYS)[number];

/** Whether a movement carries the order's charges: all seven keys present (null counts as present). */
export const carriesOrderCharges = (m: Partial<Record<OrderChargeKey, unknown>>): boolean =>
  ORDER_CHARGE_KEYS.every((k) => m[k] !== undefined);

/**
 * Why a batch's charges cannot be stored, or null when they can: every movement carries all seven keys,
 * or every movement carries none (D-RATE9).
 */
export function orderChargeProblem(movements: readonly Partial<Record<OrderChargeKey, unknown>>[]): string | null {
  let carrying = 0;
  for (const [i, m] of movements.entries()) {
    const present = ORDER_CHARGE_KEYS.filter((k) => m[k] !== undefined);
    if (present.length > 0 && present.length < ORDER_CHARGE_KEYS.length) {
      const missing = ORDER_CHARGE_KEYS.filter((k) => m[k] === undefined);
      return `movements.${i}: order charges must be sent together — missing ${missing.join(", ")}`;
    }
    if (present.length > 0) carrying++;
  }
  if (carrying > 0 && carrying < movements.length) {
    return `order charges must be sent for every movement in a batch or for none — ${carrying} of ${movements.length} carry them`;
  }
  return null;
}

export const tmsDispatchMovementsPayloadSchema = z.object({
  // McLeod's company (`TMS`). Part of every key: ids repeat across companies.
  company_id: z.string().trim().min(1).max(10),
  movements: z.array(tmsDispatchMovementSchema).max(500),
}).superRefine((p, ctx) => {
  const problem = orderChargeProblem(p.movements);
  if (problem) ctx.addIssue({ code: "custom", path: ["movements"], message: problem });
});
export type TmsDispatchMovementsPayload = z.infer<typeof tmsDispatchMovementsPayloadSchema>;
