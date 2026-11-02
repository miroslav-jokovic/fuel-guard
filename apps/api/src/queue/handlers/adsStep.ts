import { CAMPAIGN_STATES, type CampaignState } from "@silvicom/shared";
import { adsWorkers, runCampaignStep } from "../../modules/ads/index.js";
import type { JobHandler } from "../types.js";

/**
 * One orchestrator step for one campaign (A6). The tick queued it for the state the campaign was in;
 * the runner re-reads the campaign and idles if it has moved since. Throws only on a database error,
 * which the queue retries — every side effect inside is keyed, so a retry finds the first attempt's
 * work rather than redoing it.
 */
export const adsStepHandler: JobHandler = async (ctx, job) => {
  const campaignId = typeof job.payload.campaignId === "string" ? job.payload.campaignId : null;
  const state = job.payload.state;
  if (!campaignId) throw new Error("ads_step: payload.campaignId missing");
  const expected = (CAMPAIGN_STATES as readonly string[]).includes(String(state)) ? (state as CampaignState) : undefined;
  const outcome = await runCampaignStep({ admin: ctx.admin, now: () => new Date(), workers: adsWorkers() }, job.org_id, campaignId, expected);
  return { ok: true, detail: JSON.stringify(outcome) };
};
