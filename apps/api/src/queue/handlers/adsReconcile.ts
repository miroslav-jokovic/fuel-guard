import { reconcileConnection } from "../../modules/ads/index.js";
import type { JobHandler } from "../types.js";

/**
 * One connection's daily reconcile (B5c): 28 days of insights re-read, then what Meta holds against what we
 * hold, each mismatch recorded once as `external_change` and rung (`modules/ads/monitor/reconcile.ts`).
 *
 * The job THROWS when anything could not be compared — an object Meta would not read for a reason other than
 * "does not exist", the account's campaign list, an insights day — so it is failed and listed; tomorrow's run
 * compares again. A campaign already recorded as gone does not fail it again (Q-AD35). A mismatch is not a failure: it is the job's answer, recorded and rung, and the job is done.
 */
export const adsReconcileHandler: JobHandler = async (ctx, job) => {
  const payload = (job.payload ?? {}) as { connectionId?: unknown };
  if (typeof payload.connectionId !== "string" || !payload.connectionId) throw new Error("ads_reconcile: payload.connectionId is required");
  const now = new Date();
  const r = await reconcileConnection({ admin: ctx.admin, env: ctx.env, now: () => now }, job.org_id, payload.connectionId);
  if (r.failures.length) {
    const line = r.failures.slice(0, 20).map((f) => `${f.campaign_id ? `${f.campaign_id} ` : ""}${f.reason}`).join("; ");
    throw new Error(`ads_reconcile: ${r.failures.length} not compared (${r.compared} compared, ${r.recorded.length} new mismatch(es) recorded) — ${line}`);
  }
  return { ok: true, detail: JSON.stringify({ compared: r.compared, recorded: r.recorded, already_recorded: r.already_recorded, hours_written: r.insights?.hours_written ?? 0 }) };
};
