import { runOutcomeFeed, settingsFeedTargets } from "../../modules/ads/index.js";
import { recruitingLeadOutcomes } from "../../modules/recruiting/index.js";
import type { JobHandler } from "../types.js";

/**
 * One Meta connection's daily outcome feed (B6, `modules/ads/outcomes/outcomeFeed.ts`). The composition root:
 * recruiting's `LeadOutcomes` (Q-AD34) is handed to ads here, the one place the two modules meet (D-AD17), as
 * the morning brief's handler does. The target is the settings version in force (`settingsFeedTargets`, Q-AD40):
 * a carrier whose feed is off is a run that reads nothing and is done.
 *
 * The job THROWS when a send did not complete (Meta unreachable, throttled, the token or the dataset refused,
 * a malformed outcome), so it is failed and listed; tomorrow's run retries what is still due. An event Meta
 * refused is not a failure of the run: it is recorded, final, and rung once.
 */
export const adsOutcomeFeedHandler: JobHandler = async (ctx, job) => {
  const payload = (job.payload ?? {}) as { connectionId?: unknown };
  if (typeof payload.connectionId !== "string" || !payload.connectionId) throw new Error("ads_outcome_feed: payload.connectionId is required");
  const now = new Date();
  const r = await runOutcomeFeed(
    { admin: ctx.admin, env: ctx.env, now: () => now, outcomes: recruitingLeadOutcomes(ctx.admin), targets: settingsFeedTargets(ctx.admin) },
    job.org_id, payload.connectionId,
  );
  if (r.failures.length) {
    throw new Error(`ads_outcome_feed: ${r.failures.length} not sent (${r.sent} sent, ${r.refused} refused, ${r.queued} queued) — ${r.failures.slice(0, 20).map((f) => f.reason).join("; ")}`);
  }
  return { ok: true, detail: JSON.stringify({ ran: r.ran, queued: r.queued, skipped: r.skipped, sent: r.sent, refused: r.refused }) };
};
