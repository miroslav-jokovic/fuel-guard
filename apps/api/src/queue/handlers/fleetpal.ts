import {
  FleetpalClient,
  getApiKey,
  recordSweep,
  resolveStagedUnits,
  sweepRepairRecord,
} from "../../modules/fleetpal/index.js";
import type { JobHandler } from "../types.js";

/**
 * One FleetPal sweep for one org (FLEETPAL-INTEGRATION-PLAN.md F8).
 *
 * Order: **units first, then the repair record, then resolve.** Staging units before the repair
 * record means a work order arriving for a truck FleetPal added this morning already has its unit
 * row; resolving last means the resolution sees every unit this sweep brought in. The resolve pass
 * is cheap and idempotent — it writes only where the answer changed (F5) — so running it every
 * sweep costs nothing and keeps the unmatched worklist D-FP14 requires honest.
 *
 * ── ⚠ THE KEY IS UNSEALED HERE AND NOWHERE ELSE IN A SWEEP ────────────────────────────────────
 * `getApiKey` opens the secretBox envelope with an AAD bound to this org. A null answer means
 * unconfigured, disabled, or an envelope that will not open under the current
 * `SECRETS_ENCRYPTION_KEY` — and all three mean STOP, rather than sending an empty bearer token and
 * reading the resulting 401 as a revoked key.
 *
 * ── ONE RESOURCE'S FAILURE IS RECORDED, NOT THROWN ────────────────────────────────────────────
 * `sweepRepairRecord` returns a result per resource and each records its own failure against its
 * own `fleetpal_sync_state` row. The job fails only when EVERY resource failed, which is the shape
 * that distinguishes "FleetPal is down" from "job-items had a bad page" — the second must not
 * freeze the watermark of the other seven behind a red job nobody can read.
 */
export const fleetpalSyncHandler: JobHandler = async (ctx, job) => {
  const { admin, env } = ctx;
  const orgId = job.org_id;

  const credential = await getApiKey(admin, env, orgId);
  if (!credential) {
    // Not an error the operator should chase: an org with the integration off, or without a key, is
    // a configuration state. The scheduler does not dispatch for one; a manual run says so plainly.
    return { ok: true, detail: "FleetPal is not configured for this organization" };
  }

  const client = new FleetpalClient({ apiKey: credential.apiKey, baseUrl: credential.baseUrl });
  const results = await sweepRepairRecord({ admin, client, orgId });
  const resolved = await resolveStagedUnits(admin, orgId);

  const failed = results.filter((r) => r.error !== null);
  const fetched = results.reduce((n, r) => n + r.fetched, 0);
  const staged = results.reduce((n, r) => n + r.staged, 0);
  const error = failed.length === results.length && results.length > 0
    ? `every FleetPal resource failed: ${failed[0]!.error}`
    : null;

  // The credential row is where an operator looks first, so the outcome lands there as well as on
  // each resource's own position.
  await recordSweep(admin, orgId, { at: new Date().toISOString(), error });

  if (error) throw new Error(error);

  return {
    ok: true,
    fetched,
    staged,
    failedResources: failed.map((r) => `${r.resource}: ${r.error}`),
    unitsResolved: "error" in resolved ? 0 : resolved.updated,
    unmatched: "error" in resolved ? null : resolved.stillUnmatched,
  };
};
