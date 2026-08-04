import type { SupabaseClient } from "@supabase/supabase-js";
import { planDriverMerges, type ReconcileDriver } from "@fuelguard/shared";

export interface DriverMergePair {
  sourceId: string;
  sourceName: string | null;
  canonicalId: string;
  canonicalName: string | null;
  matchedBy: "phone" | "name";
  key: string;
}

export interface DriverReconcileResult {
  dryRun: boolean;
  unmatched: number; // drivers with no samsara_driver_id (the pool we tried to fold)
  planned: number; // confident merge pairs found
  merged: number; // pairs actually applied (0 on a dry run)
  pairs: DriverMergePair[];
}

/**
 * Reconcile duplicate/name-only drivers: pair each unmatched (no samsara_driver_id) driver to its Samsara
 * twin via planDriverMerges (phone or unambiguous 2-token name only), then — when apply=true — fold each
 * source into its canonical with the atomic merge_driver() SQL function (moves ALL history, deletes source).
 * Default is a DRY RUN that only returns the pairs, so the exact merges can be reviewed before anything is
 * changed. Idempotent: after a successful apply the sources are gone, so a re-run finds nothing to do.
 */
export async function reconcileDrivers(
  admin: SupabaseClient,
  orgId: string,
  opts: { apply?: boolean } = {},
): Promise<DriverReconcileResult> {
  const { data, error } = await admin
    .from("drivers")
    .select("id, full_name, samsara_driver_id, efs_driver_id, phone")
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);
  const drivers = (data ?? []) as ReconcileDriver[];

  const nameById = new Map(drivers.map((d) => [d.id, d.full_name]));
  const plans = planDriverMerges(drivers);
  const pairs: DriverMergePair[] = plans.map((p) => ({
    sourceId: p.sourceId,
    sourceName: nameById.get(p.sourceId) ?? null,
    canonicalId: p.canonicalId,
    canonicalName: nameById.get(p.canonicalId) ?? null,
    matchedBy: p.matchedBy,
    key: p.key,
  }));
  const unmatched = drivers.filter((d) => !d.samsara_driver_id).length;

  let merged = 0;
  if (opts.apply) {
    for (const p of plans) {
      const { error: mErr } = await admin.rpc("merge_driver", {
        p_org: orgId,
        p_source: p.sourceId,
        p_canonical: p.canonicalId,
      });
      if (mErr) throw new Error(`merge_driver ${p.sourceId}→${p.canonicalId} failed: ${mErr.message}`);
      merged++;
    }
  }

  return { dryRun: !opts.apply, unmatched, planned: plans.length, merged, pairs };
}

/**
 * Manually link ONE driver to a Samsara driver (the residual single-name / unmatchable cases the auto-plan
 * won't touch). An admin picks the canonical Samsara driver; we fold the source into it with merge_driver.
 * Validates both ids belong to the org and that they differ; the SQL function is the atomic primitive.
 */
export async function mergeDriverPair(
  admin: SupabaseClient,
  orgId: string,
  sourceId: string,
  canonicalId: string,
): Promise<void> {
  if (sourceId === canonicalId) throw new Error("source and canonical are the same driver");
  const { data, error } = await admin
    .from("drivers")
    .select("id")
    .eq("org_id", orgId)
    .in("id", [sourceId, canonicalId]);
  if (error) throw new Error(error.message);
  if ((data ?? []).length !== 2) throw new Error("driver not found in this org");
  const { error: mErr } = await admin.rpc("merge_driver", { p_org: orgId, p_source: sourceId, p_canonical: canonicalId });
  if (mErr) throw new Error(mErr.message);
}
