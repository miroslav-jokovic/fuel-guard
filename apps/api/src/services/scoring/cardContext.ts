/** Card-identity context for scoring one fill (WP3, hardened WP3b) — true-card vehicle count, the
 * AS-OF-FILL-TIME learned assignment, and any manual (human) assignment.
 *
 * Counted by the TRUE CARD, never by driver: candidate fills are fetched by card_ref or control_id,
 * then filtered with sameCardFill — a digit-tolerant ref match (full PAN vs masked last-4) with
 * control-id disambiguation, so two drivers sharing a last-4 are never conflated and a slip-seat
 * driver's DIFFERENT per-truck cards never inflate one card's count. A bare last-4 with no control id
 * stays uncounted (unidentifiable — surfaced in detection coverage, never guessed at).
 *
 * WP3b (169-false-alarm fix): the learned assignment is computed AS OF THE FILL — the dominant vehicle
 * over the 60 days BEFORE it — so a rebuild judges each fill against the assignment true THEN, never
 * today's. It is evidence-only (never fires alone). fuel_cards' current state is consulted ONLY for
 * MANUAL assignments (human ground truth), and only for fills recent enough for the record to apply.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cardIdentityKey, sameCardFill, dominantVehicle, type TxnView } from "@fuelguard/shared";

/** As-of learning window (days before the fill) — matches the nightly learner's window. */
const ASSIGN_WINDOW_DAYS = 60;
/** A manual fuel_cards assignment is applied only to fills within this many days of NOW — we don't
 *  track when a human set it, so applying it deep into history would recreate the era-change bug. */
const MANUAL_APPLICABLE_DAYS = 60;

export interface CardContext {
  /** Distinct vehicles this CARD fueled within the window (incl. this fill). 0 when unidentifiable. */
  cardVehicleCountInWindow: number;
  /** As-of-fill-time learned assignment (evidence-only), or null. */
  cardAssignedVehicleId: string | null;
  /** Manual (human-declared) assignment applicable to this fill, or null. */
  cardManualAssignedVehicleId: string | null;
}

export async function resolveCardContext(
  admin: SupabaseClient,
  orgId: string,
  txn: TxnView,
  winStartIso: string,
  fueledAt: string,
): Promise<CardContext> {
  if (!cardIdentityKey(txn.cardRef, txn.controlId)) {
    return { cardVehicleCountInWindow: 0, cardAssignedVehicleId: null, cardManualAssignedVehicleId: null };
  }
  const me = { cardRef: txn.cardRef ?? null, controlId: txn.controlId ?? null };
  const assignStartIso = new Date(Date.parse(fueledAt) - ASSIGN_WINDOW_DAYS * 86_400_000).toISOString();

  // ONE fetch covers both needs: the card's fills over the trailing 60 days (as-of assignment) — the
  // short misuse window (count) is a subset filtered in code.
  const seen = new Map<string, { card_ref: string | null; control_id: string | null; vehicle_id: string | null; fueled_at: string; id: string }>();
  for (const col of ["card_ref", "control_id"] as const) {
    const val = col === "card_ref" ? txn.cardRef : txn.controlId;
    if (!val) continue;
    const { data: rows } = await admin
      .from("fuel_transactions")
      .select("id, card_ref, control_id, vehicle_id, fueled_at")
      .eq("org_id", orgId)
      .eq(col, val)
      .gte("fueled_at", assignStartIso)
      .lte("fueled_at", fueledAt)
      .order("fueled_at", { ascending: false })
      .limit(400);
    for (const x of (rows ?? []) as { id: string; card_ref: string | null; control_id: string | null; vehicle_id: string | null; fueled_at: string }[]) {
      seen.set(x.id, x);
    }
  }
  const mine = [...seen.values()].filter((x) => sameCardFill({ cardRef: x.card_ref, controlId: x.control_id }, me));

  const cardVehicleCountInWindow = new Set(
    mine.filter((x) => x.fueled_at >= winStartIso).map((x) => x.vehicle_id).filter(Boolean),
  ).size;

  // As-of assignment: dominant vehicle over the trailing window, EXCLUDING the fill being scored (a
  // fill must never vote for its own legitimacy).
  const cardAssignedVehicleId = dominantVehicle(mine.filter((x) => x.id !== txn.id).map((x) => x.vehicle_id));

  // Manual assignment (current state, human ground truth) — applied only to recent-era fills.
  let cardManualAssignedVehicleId: string | null = null;
  const fillAgeDays = (Date.now() - Date.parse(fueledAt)) / 86_400_000;
  if (fillAgeDays <= MANUAL_APPLICABLE_DAYS) {
    const key = cardIdentityKey(txn.cardRef, txn.controlId);
    if (key) {
      const { data: manualRow } = await admin
        .from("fuel_cards")
        .select("vehicle_id")
        .eq("org_id", orgId)
        .eq("card_ref", key)
        .eq("assignment_source", "manual")
        .not("vehicle_id", "is", null)
        .maybeSingle();
      cardManualAssignedVehicleId = (manualRow?.vehicle_id as string | null) ?? null;
    }
  }

  return { cardVehicleCountInWindow, cardAssignedVehicleId, cardManualAssignedVehicleId };
}
