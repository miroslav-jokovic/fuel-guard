import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { claimsToContext, type AuthClaims, type AuthContext } from "@fleetguard/shared";
import type { Env } from "../env.js";

/** Either a static key (tests pass a CryptoKey) or a JWKS resolver (production). */
export type VerifyKey = CryptoKey | Uint8Array | JWTVerifyGetKey;

/**
 * Verify a Supabase access token and return the principal.
 * Modern Supabase signs JWTs asymmetrically; we verify locally against the project JWKS with no
 * round-trip (docs/01 §4). `key` is injectable so tests can verify with a local key pair.
 */
export async function verifyAccessToken(token: string, key: VerifyKey): Promise<AuthContext> {
  const { payload } =
    typeof key === "function" ? await jwtVerify(token, key) : await jwtVerify(token, key);
  const claims = payload as unknown as AuthClaims;
  if (!claims.sub) throw new Error("token missing sub claim");
  return claimsToContext(claims);
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
