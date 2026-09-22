import { ingestDefects, ingestExpirations, issuesIngest } from "./condition.js";
import { ingestPmSchedules, metersIngest } from "./equipment.js";
import { jobItemsIngest, jobsIngest, serviceHistoryIngest, workOrdersIngest } from "./repair.js";
import { ingestShops, vendorsIngest } from "./reference.js";
import { runIngest } from "./run.js";
import type { IngestContext, IngestResult } from "./types.js";

/**
 * The repair-record sweep (FLEETPAL-INTEGRATION-PLAN.md F6).
 *
 * ── THE ORDER IS DELIBERATE, AND IT IS NOT A DEPENDENCY ───────────────────────────────────────
 * Nothing here requires its parents to be staged first — 0349 has no foreign keys between these
 * tables precisely so that a delta sweep can deliver a job whose work order did not change. The
 * order is about what a HALF-FINISHED sweep leaves behind: references first, then the work order,
 * then what was done on it, then the closed record. A sweep that dies in the middle then leaves a
 * prefix that reads consistently rather than line items whose job has never been seen.
 *
 * ── ⚠ ONE RESOURCE'S FAILURE DOES NOT STOP THE OTHERS ─────────────────────────────────────────
 * Each ingest records its own failure against its own row in `fleetpal_sync_state` and leaves its
 * own position where it was. So a vendor-side 500 on `job-items` costs that resource one cycle and
 * no others — the alternative, an exception that abandons the sweep, would let one bad collection
 * freeze the watermark of every collection behind it, and the symptom would be "FleetPal stopped
 * syncing" with one real cause hidden behind seven stalled ones.
 */
export async function sweepRepairRecord(ctx: IngestContext): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  results.push(await runIngest(ctx, vendorsIngest));
  results.push(await ingestShops(ctx));
  results.push(await runIngest(ctx, workOrdersIngest));
  results.push(await runIngest(ctx, jobsIngest));
  results.push(await runIngest(ctx, jobItemsIngest));
  results.push(await runIngest(ctx, serviceHistoryIngest));
  results.push(await runIngest(ctx, metersIngest));
  results.push(await ingestPmSchedules(ctx));
  // F7's bounded-re-read tier, last: it is the only part that does not watermark, so a sweep that
  // dies before it costs a re-read of an open list rather than a window of history.
  results.push(await runIngest(ctx, issuesIngest));
  results.push(await ingestDefects(ctx));
  results.push(await ingestExpirations(ctx));
  return results;
}

/**
 * ── ⚠ `purchaseOrdersIngest` AND `poInvoicesIngest` ARE NOT IN THE SWEEP ABOVE, ON PURPOSE ─────
 * They are exported (below) and tested, and nothing calls them yet. Their `stage_fleetpal_*`
 * functions arrive in migration 0351, and Railway serves a merge ~2m44s before `migrate.yml`
 * applies its migration (`docs/MIGRATION-DISCIPLINE.md` §the-deploy-window). A sweep tick inside
 * that window would ask PostgREST for two functions the database did not yet have — which is the
 * exact reason F6 shipped its ingest with no caller and F8 shipped the caller separately. The
 * difference now is that the scheduler already exists, so the window is real rather than
 * hypothetical, and the line that adds these two to `sweepRepairRecord` is F9b's first commit.
 */
export { runIngest } from "./run.js";
export { poInvoicesIngest, purchaseOrdersIngest } from "./purchasing.js";
export { ingestDefects, ingestExpirations, issuesIngest } from "./condition.js";
export { ingestPmSchedules, metersIngest } from "./equipment.js";
export { jobItemsIngest, jobsIngest, serviceHistoryIngest, workOrdersIngest } from "./repair.js";
export { ingestShops, vendorsIngest } from "./reference.js";
export type { IngestContext, IngestResult, ResourceIngest } from "./types.js";
