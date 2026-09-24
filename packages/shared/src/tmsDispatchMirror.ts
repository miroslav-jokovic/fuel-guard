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
  weight: z.number().nonnegative().nullable(),
  weight_um: text,
  pieces: z.number().int().nonnegative().nullable(),
  pallets_how_many: z.number().int().nonnegative().nullable(),
  consignee_refno: text,
  move_distance: z.number().nonnegative().nullable(),
  // 12 is the most measured on one movement (2026-09-24); 50 bounds a malformed payload, not a real one.
  stops: z.array(tmsDispatchStopSchema).max(50),
});
export type TmsDispatchMovement = z.infer<typeof tmsDispatchMovementSchema>;

export const tmsDispatchMovementsPayloadSchema = z.object({
  // McLeod's company (`TMS`). Part of every key: ids repeat across companies.
  company_id: z.string().trim().min(1).max(10),
  movements: z.array(tmsDispatchMovementSchema).max(500),
});
export type TmsDispatchMovementsPayload = z.infer<typeof tmsDispatchMovementsPayloadSchema>;
