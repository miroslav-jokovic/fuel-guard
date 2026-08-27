import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Outcome bookkeeping for `pattern_sweep_requests` — anomalies-owned (D-ARC3), so the queue
 * handler records a sweep's fate through this interface instead of writing the table itself.
 * Keyed by the request's UUID primary key, no org filter, exactly as the handler always did:
 * the id came out of this module's own dispatch path, and a UUID miss updates zero rows.
 */
export async function markPatternSweepOutcome(
  admin: SupabaseClient,
  requestId: string,
  outcome: { ok: true } | { ok: false; error: string },
): Promise<void> {
  if (outcome.ok) {
    await admin
      .from("pattern_sweep_requests")
      .update({ status: "succeeded", last_error: null, updated_at: new Date().toISOString() })
      .eq("id", requestId);
    return;
  }
  await admin
    .from("pattern_sweep_requests")
    .update({
      status: "failed",
      next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
      last_error: outcome.error,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);
}
