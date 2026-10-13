import { MedstopClient, getApiKey, recordSweep, sweepMedstop } from "../../modules/medstop/index.js";
import type { JobHandler } from "../types.js";

/**
 * One Med-Stop sweep for one org (MEDSTOP-PLAN.md §6, MS1). The key is unsealed here and nowhere else
 * in a sweep; a null answer (unconfigured, switched off, or an envelope the current
 * `SECRETS_ENCRYPTION_KEY` cannot open) means stop, never "send an empty key and read the 401".
 * The outcome lands on the credential row too, because that is where the Settings page looks.
 */
export const medstopSyncHandler: JobHandler = async (ctx, job) => {
  const { admin, env } = ctx;
  const orgId = job.org_id;
  const credential = await getApiKey(admin, env, orgId);
  if (!credential) return { ok: true, detail: "Med-Stop is not configured for this organization" };

  const client = new MedstopClient({ apiKey: credential.apiKey, baseUrl: credential.baseUrl });
  try {
    const result = await sweepMedstop(admin, client, orgId);
    await recordSweep(admin, orgId, { at: new Date().toISOString(), error: null });
    return {
      ok: true,
      detail: `${result.employees} employees (${result.matched} matched), ${result.pools} pools, ${result.selections} selections in ${result.requests} requests`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordSweep(admin, orgId, { at: new Date().toISOString(), error: message });
    throw e;
  }
};
