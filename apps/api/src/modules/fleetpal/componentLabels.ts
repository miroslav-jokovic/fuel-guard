import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { FleetpalClient } from "./client.js";
import { getApiKey } from "./credentials.js";
import { describeComponents, type ComponentLabel } from "./vmrs.js";
import type { UnitRepair } from "./unitCost.js";

/**
 * Put words beside each repair's component id, for one response (F9c).
 *
 * The key is unsealed here, on the READ path, which the plan named as F9c's real cost: a page view
 * now holds the decrypted key for the length of a few vendor round trips. It goes no further than
 * the client built below, and an org with no key, or with its sweep switched off, gets every label
 * as `null` rather than a page that fails — the repair's own description still renders.
 */
export async function labelRepairs(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  repairs: UnitRepair[],
): Promise<Array<UnitRepair & { componentLabel: ComponentLabel | null }>> {
  const ids = repairs.map((r) => r.component).filter((c): c is string => c !== null);
  let labels = new Map<string, ComponentLabel | null>();
  if (ids.length > 0) {
    const credential = await getApiKey(admin, env, orgId).catch(() => null);
    if (credential) {
      const client = new FleetpalClient({ ...credential, timeoutMs: 5_000, maxRetries: 0 });
      labels = await describeComponents(client, orgId, ids);
    }
  }
  return repairs.map((r) => ({ ...r, componentLabel: r.component ? (labels.get(r.component) ?? null) : null }));
}
