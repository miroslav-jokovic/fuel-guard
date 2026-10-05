import { FleetpalError } from "../errors.js";
import { advance, getSyncState, recordFailure } from "../syncState.js";
import type { IngestContext, IngestResult, ResourceIngest } from "./types.js";

/**
 * Walk one FleetPal collection from where the last sweep stopped, and stage what comes back
 * (FLEETPAL-INTEGRATION-PLAN.md F6).
 *
 * Every watermarked resource runs through here, so the four properties that make a sweep safe are
 * asserted once rather than per resource:
 *
 *   1. The position is READ first, and a missing row means "never run", which is what makes the
 *      first sweep a full walk rather than a special path.
 *   2. The rows are staged in set-based calls of at most `STAGE_BATCH` (0349's `stage_fleetpal_*`),
 *      idempotent on `(org_id, fleetpal_id)`, so re-running a window rewrites the same rows and
 *      creates nothing — which is also what makes a failure after some batches harmless.
 *   3. The watermark moves to the highest `updated` SEEN, and only after the stage succeeded.
 *   4. A failure is recorded against the resource and the position is left exactly where it was.
 *
 * ── A MANGLED PAYLOAD IS A NAMED ERROR, NOT A 500 ─────────────────────────────────────────────
 * The client parses each row through its F1 contract and throws `FleetpalError('validation')` when
 * the vendor sends a shape we do not model. That arrives here as `error` on the result and as
 * `last_error` on the sync state, where an operator reads it — rather than as an unhandled throw in
 * a scheduler tick, which is the version that shows up as "the sync stopped" with nothing to read.
 */
/**
 * Rows per staging call.
 *
 * ⚠ Until 2026-10-04 the whole walk went in ONE call. The first production sweep (that day) staged
 * 13,090 jobs that way and then failed job items — 35,121 rows — with "canceling statement due to
 * statement timeout", staging none; meters (135,631, F4) would follow. Since the watermark only
 * moves after success, every hourly sweep would have retried the same full walk and failed the same
 * way, for ever. 1,000 is well under the 13,090 that one call was measured to manage.
 */
export const STAGE_BATCH = 1_000;
// ⚠ And the position moves after EVERY batch, oldest first (2026-10-05). Until then it moved only
// after the last one: meters walked 139,609 rows every two hours, one batch timed out on a
// database short of memory, and the sweep kept nothing and started from zero the next time.

export async function runIngest<T>(
  ctx: IngestContext,
  spec: ResourceIngest<T>,
): Promise<IngestResult> {
  const { admin, client, orgId } = ctx;
  const state = await getSyncState(admin, orgId, spec.resource);
  const since = state?.watermark ?? null;

  try {
    const rows = await client.walk(spec.path, spec.schema, since ? { updated_after: since } : {});
    if (rows.length === 0) {
      // Nothing changed. The position is deliberately NOT touched: moving it to "now" would skip
      // anything the vendor stamped between our last page and this read.
      return { resource: spec.resource, fetched: 0, staged: 0, advancedTo: null, error: null };
    }

    // Oldest first, so every batch that succeeds is a prefix the position can safely move past. A
    // row with no `updated` cannot be a position; it goes first and moves nothing.
    const ordered = rows
      .map((row) => ({ row, updated: spec.updatedOf(row) }))
      .map(({ row, updated }) => ({ row, updated: typeof updated === "string" && updated !== "" ? updated : null }))
      .sort((a, b) => (a.updated ?? "").localeCompare(b.updated ?? ""));
    const payload = ordered.map(({ row }) => spec.map(row));
    let staged = 0;
    let advancedTo: string | null = null;
    for (let i = 0; i < payload.length; i += STAGE_BATCH) {
      const end = Math.min(i + STAGE_BATCH, payload.length);
      const { data, error } = await admin.rpc(spec.rpc, { p_org: orgId, p_rows: payload.slice(i, end) });
      if (error) {
        // Stop at the first refusal. The position already moved past every batch that succeeded,
        // so the next sweep asks only for what this one did not keep. Recorded AFTER the last
        // move, because `advance` clears `last_error`.
        await recordFailure(admin, orgId, spec.resource, error.message);
        return { resource: spec.resource, fetched: rows.length, staged, advancedTo, error: error.message };
      }
      staged += typeof data === "number" ? data : end - i;

      // `updated_after` is EXCLUSIVE: moving to a timestamp skips every row stamped with it. So the
      // position may only move to a timestamp none of whose rows are still unstaged.
      const next = ordered[end]?.updated ?? null;
      let safe: string | null = null;
      for (let j = end - 1; j >= 0; j--) {
        const u = ordered[j]!.updated;
        if (u !== null && u !== next) { safe = u; break; }
      }
      if (safe !== null && safe !== advancedTo && (since === null || safe > since)) {
        const moved = await advance(admin, orgId, spec.resource, { kind: "watermark", at: safe }, end);
        if ("error" in moved) {
          return { resource: spec.resource, fetched: rows.length, staged, advancedTo, error: moved.error };
        }
        advancedTo = safe;
      }
    }
    return { resource: spec.resource, fetched: rows.length, staged, advancedTo, error: null };
  } catch (e) {
    const message = e instanceof FleetpalError ? `${e.kind}: ${e.message}` : String(e);
    await recordFailure(admin, orgId, spec.resource, message);
    return { resource: spec.resource, fetched: 0, staged: 0, advancedTo: null, error: message };
  }
}
