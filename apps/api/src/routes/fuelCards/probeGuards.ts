import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { HttpError } from "../../lib/http.js";
import { cardRefHmac } from "../../services/efsCardMirror.js";
import type { EfsSoapCredentials } from "../../services/efsSoapCredentials.js";

const PRODUCTION_HOST = "ws.efsllc.com";

/** Throws a 404-shaped refusal when the PAN is not a card in this org's mirror. */
export async function assertOrgOwnsCard(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  cardNumber: string,
): Promise<void> {
  let ref: string;
  try {
    ref = cardRefHmac(env, orgId, cardNumber);
  } catch {
    throw new HttpError(404, "not_found", "That card is not in this company.");
  }

  const { data, error } = await admin
    .from("efs_cards")
    .select("id")
    .eq("card_ref_hmac", ref)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, "not_found", "That card is not in this company.");
}

/** Throws a 403-shaped refusal when the resolved credentials point at production. */
export function assertProbeAllowed(env: Env, creds: EfsSoapCredentials): void {
  let isProductionHost: boolean;
  try {
    isProductionHost = new URL(creds.endpointUrl).hostname.toLowerCase() === PRODUCTION_HOST;
  } catch {
    isProductionHost = true;
  }
  if (!env.EFS_ALLOW_PRODUCTION_PROBE && (creds.environment === "production" || isProductionHost)) {
    throw new HttpError(
      403,
      "production_probe_forbidden",
      "Production EFS probes are disabled. Set EFS_ALLOW_PRODUCTION_PROBE=true only for an explicitly approved run.",
    );
  }
}
