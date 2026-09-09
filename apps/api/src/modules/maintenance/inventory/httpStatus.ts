/**
 * Which HTTP status a service failure deserves (INVENTORY-PLAN.md step I3).
 *
 * The plan says the `IV0xx` SQLSTATEs "map to 409/422 with the code in the body", and the split is
 * not arbitrary — it is the difference between two sentences a technician can tell apart:
 *
 *   **409** — the payload is fine and the SHELF refuses it. There is one filter left, not two; the
 *   ledger cannot be edited; an identical movement is already landing. Nothing to fix in the form;
 *   the answer is to look, or to wait, or to count.
 *
 *   **422** — the payload NAMES something unusable. A location that is closed or not ours, a part
 *   that is retired, a clock a day out, a body missing the quantity for its own reason. The request
 *   has to change before it can succeed.
 *
 * A 500 is reserved for what it means everywhere else: we do not know. Every code below is a case we
 * do know, and answering any of them with 500 would put "Something went wrong" in front of somebody
 * holding a part and a phone.
 */
const STATUS: Record<string, number> = {
  // The shelf's own state.
  IV010: 409, // insufficient_stock
  IV011: 409, // part_movements_append_only
  IV016: 409, // movement_in_flight — a retry, and the message says so
  IV017: 409, // count_session_closed — 0332's trigger; the walk is over, a correction is a new count
  duplicate_part_number: 409,
  duplicate_location_code: 409,
  // The payload names something unusable.
  IV012: 422, // unknown_location
  IV013: 422, // part_inactive
  IV014: 422, // occurred_at_out_of_range
  IV015: 422, // malformed_movement
  // A CHECK on `stock_count_sessions` refused the row — two holders, none, or a `kind` that
  // disagrees with the one that is set. Not an `IV0xx`: no migration raises it, `countSessions.ts`
  // synthesises it from 23514, and a fictional SQLSTATE is worse than a named condition.
  malformed_session: 422,
  // The request is malformed in a way the schema could not catch.
  empty_patch: 400,
  unsupported_type: 415,
  not_found: 404,
};

export const statusForServiceError = (code: string): number => STATUS[code] ?? 500;
