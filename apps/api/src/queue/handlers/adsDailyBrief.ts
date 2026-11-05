import { anthropicClient } from "../../lib/anthropic.js";
import { runDailyBrief } from "../../modules/ads/index.js";
import type { JobHandler } from "../types.js";

/**
 * One carrier's morning brief (F1b; `modules/ads/workers/analyst/dailyBrief.ts`). Done for a day already
 * sent and for a day with nothing to report; THROWS while the analyst's call is still in flight, so the job
 * is failed and listed, and the next hour's run takes the answer from the ledger instead of asking again.
 */
export const adsDailyBriefHandler: JobHandler = async (ctx, job) => {
  const now = new Date();
  const r = await runDailyBrief({ admin: ctx.admin, client: anthropicClient(ctx.env), now: () => now }, job.org_id);
  return { ok: true, detail: JSON.stringify(r) };
};
