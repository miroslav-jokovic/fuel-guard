import type { SupabaseClient } from "@supabase/supabase-js";
import type { PartMovementDto, PartMovementInput } from "@silvicom/shared";
import { traced } from "../inspections/serviceError.js";
import { PAGE_MAX } from "./parts.js";
import type { ServiceError } from "./types.js";

/**
 * The movement ledger, and the one function that writes it (INVENTORY-PLAN.md step I2, D-INV4).
 *
 * ── WHY THIS CALLS AN RPC AND NOT THREE STATEMENTS ─────────────────────────────────────────────
 * A movement is a ledger row AND a projection move AND, for a transfer, a second pair of both. Doing
 * that from here would be several round trips with no transaction around them, so a network blip
 * between two of them leaves the shelf disagreeing with its own history — the one failure this whole
 * design exists to prevent. `record_part_movement` is `security definer` and does all of it inside
 * one statement's transaction.
 *
 * ── THE SQLSTATES ARE MAPPED, NOT SWALLOWED ────────────────────────────────────────────────────
 * 0331 raises named `IV0xx` codes for the five things a technician can actually do wrong. Letting
 * them fall through as a generic 500 would put "Something went wrong" in front of somebody holding
 * a filter and a phone, when the honest sentence is "there is one of these left, not two".
 */

const COLUMNS =
  "id, part_id, location_id, reason, adjust_reason, quantity_delta, counted_total, count_session_id, " +
  "unit_cost, supplier, vehicle_id, trailer_id, work_order_ref, note, actor_user_id, transfer_group_id, " +
  "blind, occurred_at, received_at";

interface MovementRow {
  id: string;
  part_id: string;
  location_id: string;
  reason: PartMovementDto["reason"];
  adjust_reason: PartMovementDto["adjustReason"];
  quantity_delta: number;
  counted_total: number | null;
  count_session_id: string | null;
  unit_cost: number | string | null;
  supplier: string | null;
  vehicle_id: string | null;
  trailer_id: string | null;
  work_order_ref: string | null;
  note: string | null;
  actor_user_id: string | null;
  transfer_group_id: string | null;
  blind: boolean | null;
  occurred_at: string;
  received_at: string;
}

export const toMovementDto = (r: MovementRow, actorName: string | null = null): PartMovementDto => ({
  id: r.id,
  partId: r.part_id,
  locationId: r.location_id,
  reason: r.reason,
  adjustReason: r.adjust_reason,
  quantityDelta: Number(r.quantity_delta),
  countedTotal: r.counted_total === null ? null : Number(r.counted_total),
  countSessionId: r.count_session_id,
  unitCost: r.unit_cost === null ? null : Number(r.unit_cost),
  vehicleId: r.vehicle_id,
  trailerId: r.trailer_id,
  workOrderRef: r.work_order_ref,
  note: r.note,
  actorUserId: r.actor_user_id,
  actorName,
  blind: r.blind,
  occurredAt: r.occurred_at,
  receivedAt: r.received_at,
});

/**
 * What the shop is told when the database refuses.
 *
 * `IV016` is deliberately phrased as a wait rather than a failure: it means an identical movement is
 * mid-insert on another connection, which happens when a queued write and a foreground retry race.
 * Telling somebody to try again is correct there and telling them it failed is not — the movement is
 * about to exist.
 */
const MESSAGES: Record<string, string> = {
  IV010: "There is not enough of this part on the shelf for that.",
  IV011: "The movement history cannot be edited — record a correction instead.",
  IV012: "That stock location is not available.",
  IV013: "That part is not available.",
  IV014: "This device's clock looks wrong — check the date and try again.",
  IV015: "That movement is incomplete.",
  IV016: "That movement is already being recorded — try again in a moment.",
};

export interface ListMovementsOptions {
  partId?: string;
  locationId?: string;
  vehicleId?: string;
  trailerId?: string;
  countSessionId?: string;
  /** ISO instants, inclusive. */
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export async function listMovements(
  admin: SupabaseClient,
  orgId: string,
  opts: ListMovementsOptions = {},
): Promise<{ movements: PartMovementDto[]; total: number } | ServiceError> {
  const limit = Math.min(opts.limit ?? PAGE_MAX, PAGE_MAX);
  const offset = Math.max(opts.offset ?? 0, 0);

  let q = admin.from("part_movements").select(COLUMNS, { count: "exact" }).eq("org_id", orgId);
  if (opts.partId) q = q.eq("part_id", opts.partId);
  if (opts.locationId) q = q.eq("location_id", opts.locationId);
  if (opts.vehicleId) q = q.eq("vehicle_id", opts.vehicleId);
  if (opts.trailerId) q = q.eq("trailer_id", opts.trailerId);
  if (opts.countSessionId) q = q.eq("count_session_id", opts.countSessionId);
  if (opts.since) q = q.gte("occurred_at", opts.since);
  if (opts.until) q = q.lte("occurred_at", opts.until);

  const { data, error, count } = await q
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return traced("listMovements", "db_error", "Could not load the movement history", error);
  return { movements: ((data ?? []) as unknown as MovementRow[]).map((r) => toMovementDto(r)), total: count ?? 0 };
}

/**
 * The only writer. `input` is a validated `PartMovementInput` and is passed to the RPC very nearly
 * verbatim: the sign of the delta, the count's variance and the transfer's second leg are all
 * decided in SQL, so there is no arithmetic in this function to get wrong.
 *
 * The `id` comes from the CLIENT (D-INV27) and is the idempotency key. It is not generated here, and
 * a caller that generates one per attempt rather than per movement has broken the offline queue's
 * server half without breaking any test — which is why the route that builds it takes the id from
 * the request body.
 */
export async function recordMovement(
  admin: SupabaseClient,
  orgId: string,
  actorUserId: string | null,
  input: PartMovementInput,
): Promise<PartMovementDto | ServiceError> {
  const { data, error } = await admin.rpc("record_part_movement", {
    p_org: orgId,
    p_actor: actorUserId,
    p_row: input,
  });

  if (error) {
    const known = error.code && MESSAGES[error.code];
    if (known) return { error: known, code: error.code as string };
    return traced("recordMovement", "db_error", "Could not record the movement", error);
  }
  // `returns part_movements` gives PostgREST a composite, which it renders as a single object.
  const row = (Array.isArray(data) ? data[0] : data) as unknown as MovementRow | null;
  if (!row) return traced("recordMovement", "db_error", "The movement was not recorded", null);
  return toMovementDto(row);
}
