import { syncOrgRules } from "../../modules/ads/index.js";
import type { JobHandler } from "../types.js";

/**
 * Meta Automated Rules follow the ads settings in force (B3b). Queued by the settings save door with
 * the (org, kind) slot as its dedup, so saves in a burst run one sync that reads the newest version.
 * Throws when a connection's sync failed — the job is then failed and listed, never quietly green.
 */
export const adsRulesSyncHandler: JobHandler = async (ctx, job) => {
  const r = await syncOrgRules({ admin: ctx.admin, env: ctx.env, now: () => new Date() }, job.org_id);
  const failed = r.connections.filter((c) => !c.ok);
  if (failed.length) throw new Error(`ads_rules_sync: ${failed.map((c) => `${c.connection_id} ${c.error_code ?? c.results.find((x) => x.outcome === "failed")?.outcome ?? "failed"}`).join("; ")}`);
  return { ok: true, detail: JSON.stringify(r) };
};
