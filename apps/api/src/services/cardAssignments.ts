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
import { learnCardAssignments, type CardFillRow } from "@fuelguard/shared";

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
