/** Card-identity context for scoring one fill (WP3) — the true-card vehicle count + fuel_cards assignment.
 *
 * Counted by the TRUE CARD, never by driver: candidate fills are fetched by card_ref or control_id, then
 * filtered with sameCardFill — a digit-tolerant ref match (full PAN vs masked last-4) with control-id
 * disambiguation, so two drivers sharing a last-4 are never conflated and a slip-seat driver's DIFFERENT
 * per-truck cards never inflate one card's count. A bare last-4 with no control id stays uncounted
 * (unidentifiable — surfaced in detection coverage, never guessed at).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cardIdentityKey, sameCardFill, type TxnView } from "@fuelguard/shared";
import { lookupCardAssignment } from "../cardAssignments.js";

export interface CardContext {
  /** Distinct vehicles this CARD fueled within the window (incl. this fill). 0 when unidentifiable. */
  cardVehicleCountInWindow: number;
  /** The vehicle the card is assigned to (fuel_cards), or null. */
  cardAssignedVehicleId: string | null;
}

export async function resolveCardContext(
  admin: SupabaseClient,
  orgId: string,
  txn: TxnView,
  winStartIso: string,
  fueledAt: string,
): Promise<CardContext> {
  if (!cardIdentityKey(txn.cardRef, txn.controlId)) {
    return { cardVehicleCountInWindow: 0, cardAssignedVehicleId: null };
  }
  const me = { cardRef: txn.cardRef ?? null, controlId: txn.controlId ?? null };
  const seen = new Map<string, { card_ref: string | null; control_id: string | null; vehicle_id: string | null }>();
  for (const col of ["card_ref", "control_id"] as const) {
    const val = col === "card_ref" ? txn.cardRef : txn.controlId;
    if (!val) continue;
    const { data: rows } = await admin
      .from("fuel_transactions")
      .select("id, card_ref, control_id, vehicle_id")
      .eq("org_id", orgId)
      .eq(col, val)
      .gte("fueled_at", winStartIso)
      .lte("fueled_at", fueledAt);
    for (const x of (rows ?? []) as { id: string; card_ref: string | null; control_id: string | null; vehicle_id: string | null }[]) {
      seen.set(x.id, x);
    }
  }
  const cardVehicleCountInWindow = new Set(
    [...seen.values()]
      .filter((x) => sameCardFill({ cardRef: x.card_ref, controlId: x.control_id }, me))
      .map((x) => x.vehicle_id)
      .filter(Boolean),
  ).size;
  const cardAssignedVehicleId = await lookupCardAssignment(admin, orgId, txn.cardRef ?? null, txn.controlId ?? null);
  return { cardVehicleCountInWindow, cardAssignedVehicleId };
}
