import { pullConnectionInsights } from "../../modules/ads/index.js";
import type { JobHandler } from "../types.js";

/**
 * One connection's hourly insights pull (B5a): Meta's campaign insights at hourly grain → `ads_spend_hourly`
 * (`modules/ads/monitor/insightsPull.ts`). A payload `days` (1–28) widens one run's window — an operator
 * healing a longer outage; the scheduler sends none, so the run reads the default window.
 *
 * The job THROWS when anything was not brought in — a campaign Meta refused, a truncated window, a row we
 * cannot read, an account zone we cannot convert — so it is failed and listed, and the next hour's run,
 * which reads the same window again, tries again. The line names campaigns and reasons, nothing else.
 */
export const adsInsightsHandler: JobHandler = async (ctx, job) => {
  const payload = (job.payload ?? {}) as { connectionId?: unknown; days?: unknown };
  if (typeof payload.connectionId !== "string" || !payload.connectionId) throw new Error("ads_insights: payload.connectionId is required");
  const days = typeof payload.days === "number" ? payload.days : undefined;
  const now = new Date();
  const r = await pullConnectionInsights({ admin: ctx.admin, env: ctx.env, now: () => now }, job.org_id, payload.connectionId, { days });
  if (r.failures.length) {
    const line = r.failures.slice(0, 20).map((f) => `${f.campaign_id ? `${f.campaign_id} ` : ""}${f.reason}`).join("; ");
    throw new Error(`ads_insights: ${r.failures.length} not brought in (${r.hours_written} hours written, ${r.hours_zeroed} zeroed) — ${line}`);
  }
  return { ok: true, detail: JSON.stringify(r) };
};
