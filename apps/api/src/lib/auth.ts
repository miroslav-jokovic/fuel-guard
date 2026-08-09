import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { claimsToContext, type AuthClaims, type AuthContext } from "@fuelguard/shared";
import type { Env } from "../env.js";

/** Either a static key (tests pass a CryptoKey) or a JWKS resolver (production). */
export type VerifyKey = CryptoKey | Uint8Array | JWTVerifyGetKey;

/** Who the token must claim to be from, and for. Omitted in unit tests, which mint their own keys. */
export interface TokenAudience {
  issuer?: string;
  audience?: string;
}

/**
 * Verify a Supabase access token and return the principal.
 * Modern Supabase signs JWTs asymmetrically; we verify locally against the project JWKS with no
 * round-trip (docs/01 §4). `key` is injectable so tests can verify with a local key pair.
 *
 * `exp`/`nbf` are checked by jose automatically; `iss` and `aud` are NOT unless asked for, and this
 * call used to ask for neither (audit 2026-08-09, finding 3.8). The blast radius was small — the
 * JWKS is fetched per project, so only that project's signing keys validate at all — but "only the
 * right key signed it" is a weaker claim than "the right issuer minted it for this audience", and
 * the gap would matter the moment Supabase issues a token with a different aud for the same project.
 * Pinned in production via middleware/auth.ts; left open when callers pass no options so unit tests
 * can keep signing with a local key pair and no issuer.
 */
export async function verifyAccessToken(
  token: string,
  key: VerifyKey,
  opts: TokenAudience = {},
): Promise<AuthContext> {
  const claimChecks = {
    ...(opts.issuer ? { issuer: opts.issuer } : {}),
    ...(opts.audience ? { audience: opts.audience } : {}),
  };
  // The ternary is only here to satisfy jose's overloads; both branches call the same function.
  const { payload } =
    typeof key === "function"
      ? await jwtVerify(token, key, claimChecks)
      : await jwtVerify(token, key, claimChecks);
  const claims = payload as unknown as AuthClaims;
  if (!claims.sub) throw new Error("token missing sub claim");
  return claimsToContext(claims);
}

/** The issuer/audience a Supabase project mints user tokens with. */
export function projectTokenAudience(env: Env): TokenAudience {
  return {
    ...(env.SUPABASE_URL ? { issuer: `${env.SUPABASE_URL}/auth/v1` } : {}),
    audience: "authenticated",
  };
}

// Lazily-built, cached JWKS resolver for the configured Supabase project.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export function getProjectJwks(env: Env): VerifyKey {
  if (!env.SUPABASE_URL) {
    throw new Error("SUPABASE_URL is not configured");
  }
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}
