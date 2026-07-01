import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";

/**
 * Resolve the Samsara API token for an org: the per-org secret in `integration_credentials` (never
 * exposed to the browser) if enabled, else the single-tenant `SAMSARA_API_TOKEN` env fallback.
 * Returns null when neither is configured.
 */
export async function loadSamsaraToken(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("integration_credentials")
    .select("samsara_api_token, enabled")
    .eq("org_id", orgId)
    .maybeSingle();
  if (data && data.enabled !== false && data.samsara_api_token) return data.samsara_api_token as string;
  return env.SAMSARA_API_TOKEN ?? null;
}
