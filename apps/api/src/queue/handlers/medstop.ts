import { MedstopClient, createMedstopApplicants, getApiKey, recordSweep, sweepMedstop } from "../../modules/medstop/index.js";
import { partOneFactsForMedstop } from "../../modules/recruiting/index.js";
import type { JobHandler } from "../types.js";

/**
 * One Med-Stop sweep for one org (MEDSTOP-PLAN.md §6, MS1). The key is unsealed here and nowhere else
 * in a sweep; a null answer (unconfigured, switched off, or an envelope the current
 * `SECRETS_ENCRYPTION_KEY` cannot open) means stop, never "send an empty key and read the 401".
 * The outcome lands on the credential row too, because that is where the Settings page looks.
 *
 * UX5c (D-MS1): after the sweep — so the roster mirror is fresh when it asks "does Med-Stop already
 * hold this person?" — applicants whose Part 1 is complete are created in Med-Stop. Recruiting
 * supplies them and medstop writes; this job is where the two meet, so neither reads the other.
 */
export const medstopSyncHandler: JobHandler = async (ctx, job) => {
  const { admin, env } = ctx;
  const orgId = job.org_id;
  const credential = await getApiKey(admin, env, orgId);
  if (!credential) return { ok: true, detail: "Med-Stop is not configured for this organization" };

  const client = new MedstopClient({ apiKey: credential.apiKey, baseUrl: credential.baseUrl });
  try {
    const result = await sweepMedstop(admin, client, orgId);
    const applicants = await createMedstopApplicants(admin, client, orgId, () => partOneFactsForMedstop(admin, orgId));
    await recordSweep(admin, orgId, { at: new Date().toISOString(), error: null });
    return {
      ok: true,
      detail: `${result.employees} employees (${result.matched} matched), ${result.pools} pools, ${result.selections} selections, ${result.tests.tests} tests (${result.tests.trails} trails, ${result.tests.baseline} history), ${result.tests.requests} orders; ${result.outcomes.filed} filed, ${result.outcomes.alerted} sent to the DER, ${result.outcomes.refusedRequests} refused orders; applicants ${applicants.ordersOff ? "not created (ordering off)" : `${applicants.created} created, ${applicants.refused} refused, ${applicants.unknown} unanswered, ${applicants.skipped} skipped`}; ${result.requests} requests`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordSweep(admin, orgId, { at: new Date().toISOString(), error: message });
    throw e;
  }
};
