/**
 * WP1 D4 — populate `fuel_cards` (card → assigned vehicle) from approved-fill history.
 *
 * The standard EFS reject export carries no card-assigned truck (verified), so this learned table IS
 * the card→truck ground truth the decline scorer checks against. Learning rules live in
 * @fuelguard/shared (learnCardAssignments): ≥5 attributed fills in the window AND a ≥70% majority on
 * one vehicle — a floating/slip-seat card yields NO assignment rather than a wrong one. Manual rows
 * (assignment_source = 'manual') are authoritative and never overwritten.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { learnCardAssignments, cardIdentityKey, cardLast4, isFullCardNumber, type CardFillRow } from "@fuelguard/shared";

/**
 * The vehicle a card is ASSIGNED to (fuel_cards), or null. Shared by decline scoring and the
 * card_multi_vehicle rule context.
 *
 * WP3c — the last-4 fallback is now gated. It used to run whenever the exact-key lookup missed, and
 * returned a truck whenever exactly one KNOWN card carried that last-4. That guard is an illusion
 * once EFS masks the PAN: a second physical card sharing the last-4 that simply isn't in `fuel_cards`
 * yet is invisible to the `limit(2)` check, so the lookup happily returned another driver's truck —
 * which the decline scorer then raised as a weight-75 "card assigned to a different truck" signal.
 *
 * The fallback now runs only when the CALLER's ref is an unmasked full card number AND the matched
 * row's own ref is a full number ending in the same digits, i.e. when the match is provable. Anything
 * ambiguous returns null (stay silent, don't guess) — the same posture as the rest of the engine.
 */
export async function lookupCardAssignment(
  admin: SupabaseClient,
  orgId: string,
  cardRef: string | null,
  controlId: string | null = null,
): Promise<string | null> {
  const key = cardIdentityKey(cardRef, controlId);
  if (key) {
    const { data } = await admin.from("fuel_cards").select("vehicle_id").eq("org_id", orgId).eq("card_ref", key).maybeSingle();
    if (data?.vehicle_id) return data.vehicle_id as string;
  }
  if (!isFullCardNumber(cardRef)) return null; // masked/short ref → the last-4 cannot name a card
  const last4 = cardLast4(cardRef);
  if (!last4) return null;
  const { data: byLast4 } = await admin
    .from("fuel_cards")
    .select("card_ref, vehicle_id")
    .eq("org_id", orgId)
    .eq("card_last4", last4)
    .not("vehicle_id", "is", null)
    .limit(2);
  const cands = (byLast4 ?? []) as { card_ref: string | null; vehicle_id: string | null }[];
  if (cands.length !== 1) return null;
  const only = cands[0]!;
  // The stored ref must itself be a full number that agrees with ours — a row keyed by "1234|CTRL"
  // or by a bare last-4 proves nothing about which physical card it is.
  if (!isFullCardNumber(only.card_ref) || cardLast4(only.card_ref) !== last4) return null;
  return only.vehicle_id;
}

/** Trailing window of fill history the assignment is learned from. */
const WINDOW_DAYS = 60;
const PAGE = 1000;

export interface CardAssignmentSyncResult {
  cardsSeen: number;
  assigned: number;
  skippedManual: number;
}

/** Learn + persist card→vehicle assignments for one org. Idempotent; safe to run nightly. */
export async function syncCardAssignments(admin: SupabaseClient, orgId: string): Promise<CardAssignmentSyncResult> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  // Attributed fills in the window (paged past PostgREST's 1000-row cap, like collectTxnIds).
  const rows: CardFillRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await admin
      .from("fuel_transactions")
      .select("card_ref, control_id, vehicle_id")
      .eq("org_id", orgId)
      .gte("fueled_at", since)
      .not("vehicle_id", "is", null)
      .order("fueled_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    const batch = (data ?? []) as { card_ref: string | null; control_id: string | null; vehicle_id: string | null }[];
    rows.push(...batch.map((r) => ({ cardRef: r.card_ref, controlId: r.control_id, vehicleId: r.vehicle_id })));
    if (batch.length < PAGE) break;
  }

  const learned = learnCardAssignments(rows);
  if (learned.length === 0) return { cardsSeen: 0, assigned: 0, skippedManual: 0 };

  // Existing rows — to honor manual assignments and avoid churn on unchanged learned ones.
  const { data: existingRows } = await admin
    .from("fuel_cards")
    .select("id, card_ref, vehicle_id, assignment_source")
    .eq("org_id", orgId);
  const existing = new Map(
    ((existingRows ?? []) as { id: string; card_ref: string; vehicle_id: string | null; assignment_source: string | null }[]).map(
      (r) => [r.card_ref, r],
    ),
  );

  let assigned = 0;
  let skippedManual = 0;
  for (const l of learned) {
    const cur = existing.get(l.cardKey);
    if (cur?.assignment_source === "manual") {
      skippedManual += 1;
      continue; // a human set this — authoritative
    }
    if (cur && cur.vehicle_id === l.vehicleId) continue; // unchanged
    const { error } = await admin.from("fuel_cards").upsert(
      {
        org_id: orgId,
        provider: "efs",
        card_ref: l.cardKey,
        card_last4: l.cardLast4,
        vehicle_id: l.vehicleId,
        assignment_source: "learned",
        status: "active",
      },
      { onConflict: "org_id,provider,card_ref" },
    );
    if (error) throw new Error(error.message);
    assigned += 1;
  }
  return { cardsSeen: learned.length, assigned, skippedManual };
}
