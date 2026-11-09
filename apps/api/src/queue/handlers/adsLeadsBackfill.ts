import { adsLeadsBackfillDedupKey, alertBackfillStale, alertNoContactDetail, backfillConnectionLeads, catchUpSince } from "../../modules/ads/index.js";
import { lastDoneJobByKey } from "../../modules/org/index.js";
import { leadSinkFor } from "./leadSinkFor.js";
import type { JobHandler } from "../types.js";

/**
 * One connection's hourly leads backfill (B4a2). This file is where the two modules meet and the only
 * place they do: the ads module reads Meta and knows nothing of recruiting; recruiting's `LeadSink` stores
 * the lead and knows nothing of Meta (D-AD17). The composition root hands one to the other.
 *
 * Without a payload `since`, the run reaches back to an hour before this connection's last `done` run
 * (`catchUpSince`, `backfill.ts` header), so an outage closes itself once the connection works again. A
 * payload `since` (ISO) still overrides it, for an operator who wants a given range. The job
 * THROWS when anything was not brought in — a form Meta refused, a truncated window, a lead the sink
 * refused — so it is failed and listed, and the next hour's overlapping window tries again. The failure
 * line names campaigns, forms and lead ids, never a person's details.
 *
 * A failed run also asks whether this connection has been failing for hours (`alertBackfillStale`, D2d), so
 * the failure reaches a person and not only the failed-jobs list. Any way of failing counts, a throw included.
 */
export const adsLeadsBackfillHandler: JobHandler = async (ctx, job) => {
  const payload = (job.payload ?? {}) as { connectionId?: unknown; since?: unknown };
  if (typeof payload.connectionId !== "string" || !payload.connectionId) throw new Error("ads_leads_backfill: payload.connectionId is required");
  const now = new Date();
  const asked = typeof payload.since === "string" && !Number.isNaN(Date.parse(payload.since)) ? new Date(payload.since) : null;
  const connectionId = payload.connectionId;
  const last = await lastDoneJobByKey(ctx.admin, job.org_id, "ads_leads_backfill", adsLeadsBackfillDedupKey(connectionId));
  const lastDoneAt = last?.started_at ? new Date(last.started_at) : null;
  const since = asked ?? catchUpSince(now, lastDoneAt);
  const r = await backfillConnectionLeads(
    { admin: ctx.admin, env: ctx.env, now: () => now, sink: leadSinkFor(ctx.admin) },
    job.org_id, connectionId, { since },
  ).catch(async (error: unknown) => {
    await alertBackfillStale(ctx.admin, job.org_id, connectionId, lastDoneAt, now);
    throw error;
  });
  // LQ6: rung before the failure check, so a run that also failed still reports the leads nobody can call.
  await alertNoContactDetail(ctx.admin, job.org_id, connectionId, r.no_contact_detail, now);
  if (r.failures.length) {
    await alertBackfillStale(ctx.admin, job.org_id, connectionId, lastDoneAt, now);
    const line = r.failures.slice(0, 20).map((f) => `${f.campaign_id ? `${f.campaign_id}/${f.form_id}${f.lead_id ? `/${f.lead_id}` : ""} ` : ""}${f.reason}`).join("; ");
    throw new Error(`ads_leads_backfill: ${r.failures.length} not brought in (${r.stored_new} new, ${r.duplicates} already stored) — ${line}`);
  }
  return { ok: true, detail: JSON.stringify(r) };
};
