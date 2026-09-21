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
 *   2. The page is staged in ONE set-based call (0349's `stage_fleetpal_*`), idempotent on
 *      `(org_id, fleetpal_id)`, so re-running a window rewrites the same rows and creates nothing.
 *   3. The watermark moves to the highest `updated` SEEN, and only after the stage succeeded.
 *   4. A failure is recorded against the resource and the position is left exactly where it was.
 *
 * ── A MANGLED PAYLOAD IS A NAMED ERROR, NOT A 500 ─────────────────────────────────────────────
 * The client parses each row through its F1 contract and throws `FleetpalError('validation')` when
 * the vendor sends a shape we do not model. That arrives here as `error` on the result and as
 * `last_error` on the sync state, where an operator reads it — rather than as an unhandled throw in
 * a scheduler tick, which is the version that shows up as "the sync stopped" with nothing to read.
 */
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

    const payload = rows.map(spec.map);
    const { data, error } = await admin.rpc(spec.rpc, { p_org: orgId, p_rows: payload });
    if (error) {
      await recordFailure(admin, orgId, spec.resource, error.message);
      return { resource: spec.resource, fetched: rows.length, staged: 0, advancedTo: null, error: error.message };
    }

    const highest = rows
      .map(spec.updatedOf)
      .filter((u): u is string => typeof u === "string" && u !== "")
      .sort()
      .at(-1);
    const staged = typeof data === "number" ? data : rows.length;

    if (highest) {
      const moved = await advance(admin, orgId, spec.resource, { kind: "watermark", at: highest }, rows.length);
      if ("error" in moved) {
        return { resource: spec.resource, fetched: rows.length, staged, advancedTo: null, error: moved.error };
      }
    }
    return { resource: spec.resource, fetched: rows.length, staged, advancedTo: highest ?? null, error: null };
  } catch (e) {
    const message = e instanceof FleetpalError ? `${e.kind}: ${e.message}` : String(e);
    await recordFailure(admin, orgId, spec.resource, message);
    return { resource: spec.resource, fetched: 0, staged: 0, advancedTo: null, error: message };
  }
}
