import { runWarningDesk } from "../../orchestration/warningDesk.js";
import { NoSamsaraTokenError } from "../../modules/samsara/index.js";
import type { JobHandler } from "../types.js";

/**
 * The warning desk's tick in queue mode (WARNING-DESK-PLAN WD2/WD3) — the same run the in-process
 * scheduler makes, so a queued run can never collect or evaluate differently.
 */
export const warningDeskHandler: JobHandler = async (ctx, job) => {
  try {
    return { ...(await runWarningDesk(ctx.admin, ctx.env, job.org_id, new Date())) };
  } catch (e) {
    if (e instanceof NoSamsaraTokenError) return { skipped: "no_samsara_token" };
    throw e;
  }
};
