import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The webhook delivery ledger (FLEETPAL-INTEGRATION-PLAN.md F2, D-FP10).
 *
 * FleetPal delivers at-least-once and out of order. Three header facts decide how a receiver must
 * behave, and two of them are easy to swap:
 *
 *   • `X-Fleetpal-Delivery`   — stable across retries → the IDEMPOTENCY key. That is this table.
 *   • `X-Fleetpal-Event-Timestamp` — when the business event HAPPENED, fixed across retries → the
 *     ORDERING key. Stored as `event_at`.
 *   • `X-Fleetpal-Timestamp`  — when THIS ATTEMPT was signed. Neither of the above, and
 *     deliberately not stored: keeping it would invite somebody to order by it, and a retried old
 *     event signs newer than an event that succeeded first time. That is the vendor's own warning,
 *     and it would silently overwrite newer work-order state with older.
 *
 * ── A WEBHOOK IS A WAKE-UP SIGNAL, NEVER A SOURCE OF TRUTH ─────────────────────────────────────
 * The house rule: authenticate, then fetch the referenced resource through the authenticated API.
 * Nothing in a payload is written to a staging table directly, so a forged body that somehow passed
 * signature verification still cannot plant a repair cost — it can only cause us to re-read a
 * resource we were entitled to read anyway.
 */

/**
 * Claim a delivery. Returns `false` when this id has been seen, which is what makes a retry a
 * no-op.
 *
 * ⚠ The claim is the INSERT itself, not a read-then-write. Two concurrent deliveries of the same
 * id — which at-least-once delivery makes ordinary, not exotic — would both pass a "have we seen
 * this?" SELECT and both proceed. The unique constraint on `(org_id, delivery_id)` is the only
 * thing that can arbitrate that, so 23505 is read as "already claimed" and is a success path here
 * rather than an error.
 */
export async function claimDelivery(
  admin: SupabaseClient,
  orgId: string,
  delivery: { deliveryId: string; eventKey: string; eventAt: string },
): Promise<{ claimed: boolean; error?: string }> {
  const { error } = await admin.from("fleetpal_webhook_deliveries").insert({
    org_id: orgId,
    delivery_id: delivery.deliveryId,
    event_key: delivery.eventKey,
    event_at: delivery.eventAt,
  });
  if (!error) return { claimed: true };
  // 23505 — unique_violation. Somebody else has this delivery; we are the duplicate.
  if (error.code === "23505") return { claimed: false };
  return { claimed: false, error: error.message };
}

/** Close out a claimed delivery. `ignored` is a real outcome: an event we subscribe to but do not act on. */
export async function finishDelivery(
  admin: SupabaseClient,
  orgId: string,
  deliveryId: string,
  outcome: { status: "processed" | "ignored" | "failed"; note?: string },
): Promise<void> {
  await admin
    .from("fleetpal_webhook_deliveries")
    .update({
      status: outcome.status,
      processed_at: new Date().toISOString(),
      note: outcome.note ?? null,
    })
    .eq("org_id", orgId)
    .eq("delivery_id", deliveryId);
}

/**
 * Recent deliveries, newest business-event first.
 *
 * ⚠ Ordered by `event_at` and NOT by `received_at`. They differ exactly when a delivery was
 * retried, which is the case an operator is looking at the list to understand — sorting by arrival
 * would put the retried older event at the top and read as though it happened last.
 */
export async function listRecentDeliveries(
  admin: SupabaseClient,
  orgId: string,
  limit = 50,
): Promise<
  { deliveryId: string; eventKey: string; eventAt: string; status: string; note: string | null }[]
> {
  const { data, error } = await admin
    .from("fleetpal_webhook_deliveries")
    .select("delivery_id, event_key, event_at, status, note")
    .eq("org_id", orgId)
    .order("event_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as { delivery_id: string; event_key: string; event_at: string; status: string; note: string | null }[])
    .map((r) => ({
      deliveryId: r.delivery_id,
      eventKey: r.event_key,
      eventAt: r.event_at,
      status: r.status,
      note: r.note,
    }));
}
