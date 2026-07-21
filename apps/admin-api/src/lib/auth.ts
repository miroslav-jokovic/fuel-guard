import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import type { Env } from "../env.js";

/** Either a static key (tests) or a JWKS resolver (production). */
export type VerifyKey = CryptoKey | Uint8Array | JWTVerifyGetKey;

/**
 * Identity read from a verified Supabase JWT for the platform plane. Unlike the customer path, we KEEP
 * `aal` (assurance level) and `amr` (methods) — the `aal2` gate is what makes MFA non-optional here.
 * Authority is NOT taken from these claims; it comes from a fresh platform_admins lookup (see middleware).
 */
export interface PlatformToken {
  userId: string;
  email: string | null;
  aal: string | null; // 'aal1' | 'aal2'
  amr: string[] | null;
  sessionId: string | null;
}

interface RawClaims {
  sub?: string;
  email?: string;
  aal?: string;
  amr?: Array<{ method?: string } | string> | null;
  session_id?: string;
}

/** Verify a Supabase access token and return the platform principal (identity only). */
export async function verifyPlatformToken(token: string, key: VerifyKey): Promise<PlatformToken> {
  const { payload } =
    typeof key === "function" ? await jwtVerify(token, key) : await jwtVerify(token, key);
  const c = payload as RawClaims;
  if (!c.sub) throw new Error("token missing sub claim");
  const amr = Array.isArray(c.amr)
    ? c.amr.map((m) => (typeof m === "string" ? m : (m?.method ?? ""))).filter(Boolean)
    : null;
  return {
    userId: c.sub,
    email: c.email ?? null,
    aal: c.aal ?? null,
    amr,
    sessionId: c.session_id ?? null,
  };
}

// Lazily-built, cached JWKS resolver for the configured Supabase project.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export function getProjectJwks(env: Env): VerifyKey {
  if (!env.SUPABASE_URL) throw new Error("SUPABASE_URL is not configured");
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}
