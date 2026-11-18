import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { FleetpalClient } from "./client.js";
import { getApiKey } from "./credentials.js";
import { componentCodes } from "./vmrs.js";

/**
 * VMRS codes for FleetPal component ids, with the org's own key — the door the roadside repair pass asks
 * through (ROADSIDE-REPAIR-FLOW-PLAN RR1), as `labelRepairs` is the Shop's. `null` when the org has no
 * FleetPal connection: then there are no FleetPal work orders to rank either. Throws on an outage (see
 * `componentCodes`), which the caller turns into a skipped tick.
 */
export async function readComponentCodes(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, string | null> | null> {
  const credential = await getApiKey(admin, env, orgId).catch(() => null);
  if (!credential) return null;
  if (ids.length === 0) return new Map();
  const client = new FleetpalClient({ ...credential, timeoutMs: 10_000, maxRetries: 1 });
  return componentCodes(client, orgId, ids);
}
