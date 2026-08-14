import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { HttpError } from "../../lib/http.js";
import { cardRefHmac } from "../../services/efsCardMirror.js";
import { getEfsSoapCredentials, type EfsSoapCredentials } from "../../services/efsSoapCredentials.js";

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

/**
 * The whole probe preamble, in the one order that is safe. Every probe router needs the same three
 * facts, and ORDER IS THE POINT: ownership is settled before the credentials are read, so a PAN
 * fishing expedition against another company's card learns "not found" and never learns whether this
 * org has EFS configured at all. Written once here because three routers repeating it is three
 * chances to drop a line — the omission that a reviewer reads straight past.
 *
 * Throws `HttpError` (404 unknown card · 409 EFS not connected · 403 production endpoint); every
 * caller is wrapped in `asyncHandler`, so the structured responder in app.ts formats all three.
 */
export async function resolveProbeCredentials(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  cardNumber?: string,
): Promise<EfsSoapCredentials> {
  if (cardNumber) await assertOrgOwnsCard(admin, env, orgId, cardNumber);
  const creds = await getEfsSoapCredentials(admin, env, orgId);
  if (!creds?.enabled) {
    throw new HttpError(409, "efs_not_configured", "EFS is not connected for this company.");
  }
  assertProbeAllowed(env, creds);
  return creds;
}

/**
 * Credentials for a caller that CANNOT WRITE — no production gate.
 *
 * ── Why this exists, and why it is not `resolveProbeCredentials` with a flag ─────────────────────
 * `assertProbeAllowed` blocks production unless `EFS_ALLOW_PRODUCTION_PROBE` is set, and that flag
 * governs the three probe routes that can DIAL WITH INTENT — `/diagnose`, `/write-check` and
 * `/experiment`. Two of those can change a card.
 *
 * The echo scan is the opposite: it reads the account and builds requests it never sends
 * (`setCardV2` is not imported by that module, and `echoScan.test.ts` asserts it). Its entire stated
 * purpose is a sweep of the PRODUCTION cards — Phase 2's exit gate is literally "echo scan green
 * across all 199 production cards". Sending it through the probe gate meant it could only run with
 * `EFS_ALLOW_PRODUCTION_PROBE=true`, which simultaneously unlocks the two write probes against
 * production. A read-only diagnostic that requires enabling production writes to run is worse than
 * no diagnostic, and it is the same trap this endpoint already avoided with the OTHER flag.
 *
 * ── What still guards it ─────────────────────────────────────────────────────────────────────────
 * Admin role · org scope · the vendor rate limiter (this route is classified `opensSoap: true`) ·
 * the backfill pacing lane · and the structural no-write property. What is deliberately given up is
 * that an admin can spend vendor read budget on production without setting a flag first.
 *
 * Do NOT reuse this for anything that can write. The name says read-only; the caller must be.
 */
export async function resolveReadOnlyScanCredentials(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
): Promise<EfsSoapCredentials> {
  const creds = await getEfsSoapCredentials(admin, env, orgId);
  if (!creds?.enabled) {
    throw new HttpError(409, "efs_not_configured", "EFS is not connected for this company.");
  }
  return creds;
}
