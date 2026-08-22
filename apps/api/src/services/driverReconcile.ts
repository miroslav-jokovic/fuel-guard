import type { SupabaseClient } from "@supabase/supabase-js";
import { planDriverMerges, type ReconcileDriver } from "@fuelguard/shared";

/**
 * `merge_driver` refuses a source that carries immutable evidence (migration 0234). Named here rather
 * than inlined so the one place that interprets it is greppable from the migration and back.
 */
const MERGE_REFUSED_SQLSTATE = "MD010";

export interface DriverMergePair {
  sourceId: string;
  sourceName: string | null;
  canonicalId: string;
  canonicalName: string | null;
  matchedBy: "phone" | "name";
  key: string;
}

/** A pair the database refused to fold, and why — see `skipped` below. */
export interface DriverMergeSkip {
  sourceId: string;
  canonicalId: string;
  reason: string;
}

export interface DriverReconcileResult {
  dryRun: boolean;
  unmatched: number; // drivers with no samsara_driver_id (the pool we tried to fold)
  planned: number; // confident merge pairs found
  merged: number; // pairs actually applied (0 on a dry run)
  /**
   * Pairs `merge_driver` REFUSED with MD010 (migration 0234): the source carries a certified
   * application, an e-sign consent or an SMS consent, none of which may be moved or deleted. They are
   * reported rather than thrown, because one applicant with a signed application must not abort a
   * fleet-wide dedup halfway — a throw here loses the count of everything that already succeeded.
   * Anything OTHER than MD010 still throws: an unexpected database error is not a skip.
   */
  skipped: DriverMergeSkip[];
  pairs: DriverMergePair[];
}

/**
 * Reconcile duplicate/name-only drivers: pair each unmatched (no samsara_driver_id) driver to its Samsara
 * twin via planDriverMerges (phone or unambiguous 2-token name only), then — when apply=true — fold each
 * source into its canonical with the atomic merge_driver() SQL function (moves ALL history, deletes source).
 * Default is a DRY RUN that only returns the pairs, so the exact merges can be reviewed before anything is
 * changed. Idempotent: after a successful apply the sources are gone, so a re-run finds nothing to do.
 *
 * ⚠ Since 0234 a pair can be REFUSED rather than merged — a duplicate that carries signed evidence is
 * not foldable, and the answer for it is to archive the duplicate. Those land in `skipped`, and a
 * re-run will report them again, which is correct: nothing changed about them.
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
  const skipped: DriverMergeSkip[] = [];
  if (opts.apply) {
    for (const p of plans) {
      const { error: mErr } = await admin.rpc("merge_driver", {
        p_org: orgId,
        p_source: p.sourceId,
        p_canonical: p.canonicalId,
      });
      if (mErr) {
        // MD010 is a decision, not a fault: the source holds evidence that may never be moved, so the
        // pair is reported and the sweep goes on. Matched on the SQLSTATE rather than the message —
        // the message is written for a person and will be reworded.
        if (mErr.code === MERGE_REFUSED_SQLSTATE) {
          skipped.push({ sourceId: p.sourceId, canonicalId: p.canonicalId, reason: mErr.message });
          continue;
        }
        throw new Error(`merge_driver ${p.sourceId}→${p.canonicalId} failed: ${mErr.message}`);
      }
      merged++;
    }
  }

  return { dryRun: !opts.apply, unmatched, planned: plans.length, merged, skipped, pairs };
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
