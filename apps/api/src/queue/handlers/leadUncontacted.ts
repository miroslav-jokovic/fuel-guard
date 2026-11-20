import { uncontactedLeadMinutes } from "../../modules/ads/index.js";
import { lookUpMissingPhones, phoneLookupFor, sweepUncontactedLeads } from "../../modules/recruiting/index.js";
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
  // V7a / LQ8b: the numbers a failed or over-ceiling lookup left behind are asked again here, after the alarm, so
  // the alarm never waits on Telnyx. A lookup that cannot read or write its table fails the job like the sweep.
  const lookup = phoneLookupFor(ctx.env);
  const phones = lookup ? await lookUpMissingPhones(ctx.admin, job.org_id, lookup, now) : null;
  return { ok: true, detail: JSON.stringify(phones ? { ...r, phone_lookups: phones } : r) };
};
