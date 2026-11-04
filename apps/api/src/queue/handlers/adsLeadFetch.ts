import { fetchWebhookLead } from "../../modules/ads/index.js";
import { leadSinkFor } from "./leadSinkFor.js";
import type { JobHandler } from "../types.js";

/**
 * One lead a Meta leadgen webhook named (B4b). Like `adsLeadsBackfill.ts`, this file is where ads meets
 * recruiting: the ads module reads the lead and knows nothing of recruiting, recruiting's `LeadSink` stores
 * it and knows nothing of Meta (D-AD17).
 *
 * A failure THROWS (`LeadFetchError` names the lead by id, never the person), so the job is retried with the
 * queue's backoff and listed when it runs out — and the hourly backfill reads the same lead regardless
 * (§4R: "webhook lost — the backfill must bring it"). A form that is no campaign of this org's any more is
 * done, not failed: there is nothing of ours to store it against.
 */
export const adsLeadFetchHandler: JobHandler = async (ctx, job) => {
  const p = (job.payload ?? {}) as { leadgenId?: unknown; formId?: unknown };
  if (typeof p.leadgenId !== "string" || !p.leadgenId || typeof p.formId !== "string" || !p.formId) {
    throw new Error("ads_lead_fetch: payload.leadgenId and payload.formId are required");
  }
  const r = await fetchWebhookLead(
    { admin: ctx.admin, env: ctx.env, now: () => new Date(), sink: leadSinkFor(ctx.admin) },
    job.org_id, { leadgenId: p.leadgenId, formId: p.formId },
  );
  return { ok: true, detail: JSON.stringify(r) };
};
