import { backfillConnectionLeads } from "../../modules/ads/index.js";
import { recruitingLeadSink } from "../../modules/recruiting/index.js";
import type { JobHandler } from "../types.js";

/**
 * One connection's hourly leads backfill (B4a2). This file is where the two modules meet and the only
 * place they do: the ads module reads Meta and knows nothing of recruiting; recruiting's `LeadSink` stores
 * the lead and knows nothing of Meta (D-AD17). The composition root hands one to the other.
 *
 * A payload `since` (ISO) widens the window to close a longer outage (`backfill.ts`, header). The job
 * THROWS when anything was not brought in — a form Meta refused, a truncated window, a lead the sink
 * refused — so it is failed and listed, and the next hour's overlapping window tries again. The failure
 * line names campaigns, forms and lead ids, never a person's details.
 */
export const adsLeadsBackfillHandler: JobHandler = async (ctx, job) => {
  const payload = (job.payload ?? {}) as { connectionId?: unknown; since?: unknown };
  if (typeof payload.connectionId !== "string" || !payload.connectionId) throw new Error("ads_leads_backfill: payload.connectionId is required");
  const since = typeof payload.since === "string" && !Number.isNaN(Date.parse(payload.since)) ? new Date(payload.since) : undefined;
  const r = await backfillConnectionLeads(
    { admin: ctx.admin, env: ctx.env, now: () => new Date(), sink: recruitingLeadSink(ctx.admin) },
    job.org_id, payload.connectionId, { since },
  );
  if (r.failures.length) {
    const line = r.failures.slice(0, 20).map((f) => `${f.campaign_id}/${f.form_id}${f.lead_id ? `/${f.lead_id}` : ""} ${f.reason}`).join("; ");
    throw new Error(`ads_leads_backfill: ${r.failures.length} not brought in (${r.stored_new} new, ${r.duplicates} already stored) — ${line}`);
  }
  return { ok: true, detail: JSON.stringify(r) };
};
