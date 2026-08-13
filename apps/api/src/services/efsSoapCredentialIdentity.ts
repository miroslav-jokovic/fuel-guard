import { createHmac, hkdfSync } from "node:crypto";
import type { Env } from "../env.js";
import { decodeSecretsKey } from "../lib/secretBox.js";
import type { EfsSoapCredentials } from "./efsSoapCredentials.js";

export const EFS_PRODUCTION_ENDPOINT_HOST = "ws.efsllc.com";

/** Return the normalized hostname whose identity is bound to card-control probes. */
export function efsEndpointHost(endpointUrl: string): string {
  const host = new URL(endpointUrl).hostname.toLowerCase();
  if (!host) throw new Error("EFS SOAP endpoint URL has no host");
  return host;
}

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
