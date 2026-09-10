import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Where each FleetPal collection got to (FLEETPAL-INTEGRATION-PLAN.md F2, §2.7).
 *
 * ── TWO POSITIONS, NOT ONE, AND CONFLATING THEM IS THE BUG THIS FILE EXISTS TO PREVENT ─────────
 * Most FleetPal resources carry an `updated` field and accept an **exclusive** `updated_after`
 * filter, so storing the highest `updated` seen resumes exactly where the last sweep stopped
 * without re-delivering its own row. That is `watermark`.
 *
 * But `defects`, `expirations`, `shops` and the purchase-order receipts have **no `updated` column
 * at all** — the vendor's documentation says so, and their endpoints expose `detected_after` /
 * `created_after` instead, which are about when a thing came into existence and NOT about when it
 * last changed. That is `windowEnd`.
 *
 * ⚠ Writing a window position into `watermark` would make a later reader treat it as one and skip
 * everything that CHANGED without being re-created — a defect that was resolved after the last
 * sweep would never be seen to have resolved. Two columns is the schema refusing to let that
 * happen; `advance` below takes one or the other and never both.
 */

export type SyncPosition =
  | { kind: "watermark"; at: string }
  | { kind: "window"; to: string };

export interface FleetpalSyncState {
  resource: string;
  watermark: string | null;
  windowEnd: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  rowsSeen: number;
}

interface StateRow {
  resource: string;
  watermark: string | null;
  window_end: string | null;
  last_run_at: string | null;
  last_error: string | null;
  rows_seen: number;
}

const toState = (row: StateRow): FleetpalSyncState => ({
  resource: row.resource,
  watermark: row.watermark,
  windowEnd: row.window_end,
  lastRunAt: row.last_run_at,
  lastError: row.last_error,
  rowsSeen: row.rows_seen,
});

/** Every resource's position, for the collector's own status read. */
export async function listSyncState(
  admin: SupabaseClient,
  orgId: string,
): Promise<FleetpalSyncState[]> {
  const { data, error } = await admin
    .from("fleetpal_sync_state")
    .select("resource, watermark, window_end, last_run_at, last_error, rows_seen")
    .eq("org_id", orgId)
    .order("resource");
  if (error || !data) return [];
  return (data as StateRow[]).map(toState);
}

/**
 * One resource's position. A missing row is not an error — it means "never run", which is what
 * makes the first sweep a full walk. Returning null and letting the caller read that as "no
 * filter" is the whole first-run design.
 */
export async function getSyncState(
  admin: SupabaseClient,
  orgId: string,
  resource: string,
): Promise<FleetpalSyncState | null> {
  const { data, error } = await admin
    .from("fleetpal_sync_state")
    .select("resource, watermark, window_end, last_run_at, last_error, rows_seen")
    .eq("org_id", orgId)
    .eq("resource", resource)
    .maybeSingle();
  if (error || !data) return null;
  return toState(data as StateRow);
}

/**
 * Move a resource forward after a successful sweep.
 *
 * ⚠ **Only on success.** A failed sweep records the error and leaves the position where it was, so
 * the next run re-reads the same window. Advancing past a window we failed to process is how a
 * collector loses data while reporting itself healthy — and it is silent, because the next sweep
 * looks perfectly normal.
 *
 * UPDATE-then-INSERT rather than `.upsert()` (`lint:upserts`): `resource` is part of the primary
 * key and `rows_seen` is NOT NULL, and Postgres checks NOT NULL before it arbitrates the conflict.
 */
export async function advance(
  admin: SupabaseClient,
  orgId: string,
  resource: string,
  position: SyncPosition,
  rowsSeen: number,
): Promise<{ ok: true } | { error: string }> {
  const moved =
    position.kind === "watermark"
      ? { watermark: position.at }
      : { window_end: position.to };
  const patch = { ...moved, rows_seen: rowsSeen, last_run_at: new Date().toISOString(), last_error: null };

  const { data, error } = await admin
    .from("fleetpal_sync_state")
    .update(patch)
    .eq("org_id", orgId)
    .eq("resource", resource)
    .select("resource");
  if (error) return { error: error.message };
  if (data && data.length > 0) return { ok: true };

  const { error: insertError } = await admin
    .from("fleetpal_sync_state")
    .insert({ org_id: orgId, resource, ...patch });
  if (insertError) return { error: insertError.message };
  return { ok: true };
}

/**
 * A sweep failed. The position is deliberately untouched — see `advance`. This exists so a failure
 * is visible on the collector's status read rather than only in a log nobody greps.
 */
export async function recordFailure(
  admin: SupabaseClient,
  orgId: string,
  resource: string,
  message: string,
): Promise<void> {
  const patch = { last_run_at: new Date().toISOString(), last_error: message };
  const { data } = await admin
    .from("fleetpal_sync_state")
    .update(patch)
    .eq("org_id", orgId)
    .eq("resource", resource)
    .select("resource");
  if (data && data.length > 0) return;
  await admin.from("fleetpal_sync_state").insert({ org_id: orgId, resource, ...patch });
}
