import { uncontactedLeadMinutes } from "../../modules/ads/index.js";
import { sweepUncontactedLeads } from "../../modules/recruiting/index.js";
import type { JobHandler } from "../types.js";
import { leadRecipientsFor } from "./leadSinkFor.js";

/**
 * One carrier's sweep for leads nobody has contacted (D2c). The threshold and the carrier's list are ads
 * settings, and recruiting may not import ads (D-AD17), so they cross here. A read that fails throws: the
 * job is failed and listed, and the next tick sweeps again, because the ring is once per lead, not per run.
 */
export const leadUncontactedHandler: JobHandler = async (ctx, job) => {
  const now = new Date();
  const r = await sweepUncontactedLeads(ctx.admin, job.org_id, now, {
    minutes: await uncontactedLeadMinutes(ctx.admin, job.org_id),
    configured: leadRecipientsFor(ctx.admin),
  });
  return { ok: true, detail: JSON.stringify(r) };
};
