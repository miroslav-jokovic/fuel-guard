import { createHmac, hkdfSync } from "node:crypto";
import type { Env } from "../../../env.js";
import { decodeSecretsKey } from "../../../lib/secretBox.js";
import type { EfsSoapCredentials } from "./efsSoapCredentials.js";

export const EFS_PRODUCTION_ENDPOINT_HOST = "ws.efsllc.com";

/** Return the normalized hostname whose identity is bound to card-control probes. */
export function efsEndpointHost(endpointUrl: string): string {
  const host = new URL(endpointUrl).hostname.toLowerCase();
  if (!host) throw new Error("EFS SOAP endpoint URL has no host");
  return host;
}

/**
 * The domain every EFS-issued endpoint lives on: `ws.efsllc.com` (production), `ws.partner.efsllc.com`
 * (sandbox), and the `qa*` hosts EFS has handed out for testing.
 *
 * ── Why a domain allowlist on top of the SSRF address checks ────────────────────────────────────
 * `lib/ssrfGuard.ts` validates what a name resolves to, and then Node resolves it AGAIN to connect. Its
 * own header names the residual: a hostile authoritative nameserver with a zero TTL answers public for
 * the check and private for the connect (security review 2026-09-06 §10, still open on 2026-09-22).
 * That attack needs the attacker to control the endpoint's DNS. Requiring the host to sit under EFS's
 * own domain removes the precondition — `efsllc.com` answers to EFS, not to a tenant — and costs
 * nothing, because the endpoint is a fixed value EFS issues and no real customer has any other.
 */
export const EFS_ENDPOINT_DOMAIN = "efsllc.com";

export function isEfsEndpointHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, "");
  return normalized === EFS_ENDPOINT_DOMAIN || normalized.endsWith(`.${EFS_ENDPOINT_DOMAIN}`);
}

export const NOT_EFS_ENDPOINT_MESSAGE =
  `The endpoint must be the address EFS issued, on ${EFS_ENDPOINT_DOMAIN} (for example https://ws.efsllc.com/axis2/services/CardManagementWS/).`;

/** Validate the operator's environment label against the endpoint it claims to describe. */
export function validateEfsSoapEnvironment(
  environment: "sandbox" | "production",
  endpointUrl: string,
): string {
  const endpointHost = efsEndpointHost(endpointUrl);
  const isProductionHost = endpointHost === EFS_PRODUCTION_ENDPOINT_HOST;
  if ((environment === "production") !== isProductionHost) {
    throw new Error(
      environment === "production"
        ? `Production EFS credentials require the production endpoint host ${EFS_PRODUCTION_ENDPOINT_HOST}.`
        : `Sandbox EFS credentials cannot use the production endpoint host ${EFS_PRODUCTION_ENDPOINT_HOST}.`,
    );
  }
  return endpointHost;
}

/**
 * Hash the EFS account identity used by a probe, without storing credential components in the settings
 * row. The username is in the tuple because it is what EFS authenticates; with account_id null
 * everywhere, it is the only real discriminator between the two accounts today. Password is omitted so
 * rotation preserves the entitlement.
 */
export function credentialIdentityHash(
  env: Env,
  creds: Pick<EfsSoapCredentials, "endpointUrl" | "soapUsername" | "accountId">,
): string {
  const subkey = Buffer.from(
    hkdfSync("sha256", decodeSecretsKey(env), Buffer.alloc(0), "efs-credential-identity", 32),
  );
  const tuple = `${efsEndpointHost(creds.endpointUrl)}|${creds.soapUsername}|${creds.accountId ?? ""}`;
  return createHmac("sha256", subkey).update(tuple).digest("hex");
}
