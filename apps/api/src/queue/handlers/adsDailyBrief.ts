import { anthropicClient } from "../../lib/anthropic.js";
import { checkLeadQuality, runDailyBrief } from "../../modules/ads/index.js";
import { recruitingLeadOutcomes, recruitingLeadQuality } from "../../modules/recruiting/index.js";
import type { JobHandler } from "../types.js";

/**
 * One carrier's morning brief (F1b; `modules/ads/workers/analyst/dailyBrief.ts`). Done for a day already
 * sent and for a day with nothing to report; THROWS while the analyst's call is still in flight, so the job
 * is failed and listed, and the next hour's run takes the answer from the ledger instead of asking again.
 *
 * The lead-quality alert (LQ3b, Q-AD51 (a)) runs first, every hourly delivery: it is deduped per campaign and
 * rule, so a repeat rings nobody, and running it before the brief means an analyst still in flight never
 * holds it back. Recruiting's counts are injected here, the composition root (D-AD17).
 */
export const adsDailyBriefHandler: JobHandler = async (ctx, job) => {
  const now = new Date();
  const quality = await checkLeadQuality({ admin: ctx.admin, now: () => now, leadQuality: recruitingLeadQuality(ctx.admin) }, job.org_id);
  const r = await runDailyBrief({ admin: ctx.admin, client: anthropicClient(ctx.env), now: () => now, leadOutcomes: recruitingLeadOutcomes(ctx.admin) }, job.org_id);
  return { ok: true, detail: JSON.stringify({ ...r, lead_quality: { breaches: quality.breaches.length, rung: quality.rung } }) };
};
