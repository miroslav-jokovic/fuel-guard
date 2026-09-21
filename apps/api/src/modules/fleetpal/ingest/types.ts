import type { SupabaseClient } from "@supabase/supabase-js";
import type { FleetpalClient } from "../client.js";

/**
 * What every FleetPal ingest is made of (FLEETPAL-INTEGRATION-PLAN.md F6, §2.7).
 *
 * The four steps are the same for all of them and are written once here: read the position, walk
 * the collection from it, map each row onto its staging shape, and stage the whole page in ONE
 * set-based call. What differs per resource is the path, the filter it takes, and the mapping —
 * which is exactly what `ResourceIngest` carries.
 *
 * ── ⚠ THE WATERMARK ADVANCES ONLY ON SUCCESS ──────────────────────────────────────────────────
 * `runIngest` advances the position after the stage call returns, never before and never on a
 * failure. A collector that moved its watermark past a window it failed to process loses that
 * window permanently and reports itself healthy while doing it — the failure `syncState.advance`
 * is written to prevent, arriving here as the code that actually calls it.
 *
 * ── ⚠ AND IT COMES FROM THE ROWS, NOT FROM THE CLOCK ──────────────────────────────────────────
 * The new watermark is the highest `updated` value SEEN in this sweep. Using `now()` instead would
 * skip every row the vendor wrote while we were walking: the filter is exclusive, so anything
 * stamped between the last page and the clock read would never be delivered again.
 */

export interface IngestContext {
  admin: SupabaseClient;
  client: FleetpalClient;
  orgId: string;
}

export interface IngestResult {
  resource: string;
  fetched: number;
  staged: number;
  /** The position the sweep moved to, or null when nothing was fetched and nothing moved. */
  advancedTo: string | null;
  error: string | null;
}

/**
 * One resource's ingest, described rather than implemented.
 *
 * `rpc` is the `stage_fleetpal_*` function from 0349; `map` turns one parsed vendor row into the
 * flat record that function's `jsonb_to_recordset` expects. Nothing else in the module knows the
 * column names, which is what keeps a staging rename to one file.
 */
export interface ResourceIngest<T> {
  /** The name this resource has in `fleetpal_sync_state`. */
  resource: string;
  path: string;
  rpc: string;
  /** The vendor's own contract for one row. */
  schema: import("zod").ZodType<T>;
  /** Highest `updated` in a row, for the watermark. Null for a resource that has none (§2.7). */
  updatedOf: (row: T) => string | null;
  map: (row: T) => Record<string, unknown>;
}
