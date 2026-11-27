import type { TokenSource } from "./graphClient.js";

/**
 * A Graph token with no secret anywhere (Q-BMR2, D-BMR15; proved on staging 2026-11-24).
 *
 * The function's own AWS role asks STS for a signed JWT naming itself — `sub` = the role ARN — for
 * Entra's fixed audience, and Entra trades it for a Graph token because badge 2 holds a federated
 * credential for exactly that issuer, subject and audience. RS256 is asked for explicitly (Entra
 * refuses ES384), the STS endpoint is regional (the only kind that serves this call), and the
 * lifetime is 300 s, the role policy's ceiling (V7). The role policy refuses any other choice, so a
 * mistake here fails loudly at the first call rather than drifting.
 *
 * The Graph token (~60–90 min) is kept in the warm Lambda's memory and renewed five minutes early or
 * on a 401. Neither token is ever logged or returned.
 */

export const ENTRA_AUDIENCE = "api://AzureADTokenExchange";

export class TokenFailed extends Error {
  constructor(readonly stage: "aws" | "entra", readonly code: string | null) { super(`token failed at ${stage}${code ? ` (${code})` : ""}`); this.name = "TokenFailed"; }
}

export interface FederationDeps {
  /** STS GetWebIdentityToken on the regional endpoint; returns the signed JWT. */
  awsToken: (req: { audience: string; signingAlgorithm: "RS256"; durationSeconds: number }) => Promise<string>;
  post: (url: string, body: URLSearchParams) => Promise<{ status: number; json(): Promise<unknown> }>;
  tenantId: string;
  clientId: string;
  now: () => Date;
}

export function federatedTokens(d: FederationDeps): TokenSource {
  let cached: { token: string; until: number } | null = null;
  return {
    async get(fresh = false) {
      if (!fresh && cached && cached.until > d.now().getTime()) return cached.token;
      let assertion: string;
      try { assertion = await d.awsToken({ audience: ENTRA_AUDIENCE, signingAlgorithm: "RS256", durationSeconds: 300 }); }
      catch (e) { throw new TokenFailed("aws", (e as { name?: string }).name ?? null); }
      const res = await d.post(`https://login.microsoftonline.com/${encodeURIComponent(d.tenantId)}/oauth2/v2.0/token`, new URLSearchParams({
        client_id: d.clientId,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: assertion,
      }));
      const json = (await res.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown; error?: unknown; error_codes?: unknown };
      if (res.status !== 200 || typeof json.access_token !== "string") {
        // The AADSTS number only (e.g. 70021: no federated credential matched); never the description.
        const code = Array.isArray(json.error_codes) && json.error_codes.length ? `AADSTS${json.error_codes[0]}` : typeof json.error === "string" ? json.error : null;
        throw new TokenFailed("entra", code);
      }
      const lifetime = typeof json.expires_in === "number" ? json.expires_in : 3600;
      cached = { token: json.access_token, until: d.now().getTime() + Math.max(lifetime - 300, 60) * 1000 };
      return cached.token;
    },
  };
}
