import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import type { Env } from "../env.js";

/** Either a static key (tests) or a JWKS resolver (production). */
export type VerifyKey = CryptoKey | Uint8Array | JWTVerifyGetKey;

/**
 * One entry of the `amr` (authentication methods references) claim. Supabase/GoTrue records ONE ENTRY
 * PER AUTHENTICATION EVENT — `{ "method": "password", "timestamp": 1754741234 }` — and appends another
 * when an MFA factor is verified, so the claim is a timestamped history, not just a set of names.
 *
 * We keep the timestamp (not only the method) because the step-up gate in middleware/platformAuth.ts
 * derives "how long ago did this caller prove a second factor" straight from the token. A flattened
 * string[] — what this reader used to produce — cannot answer that question at all.
 */
export interface AmrEntry {
  method: string;
  /** Unix SECONDS as issued, or null when the claim omitted it / it was not a finite number. */
  timestamp: number | null;
}

/**
 * Identity read from a verified Supabase JWT for the platform plane. Unlike the customer path, we KEEP
 * `aal` (assurance level) and `amr` (methods) — the `aal2` gate is what makes MFA non-optional here, and
 * the `amr` timestamps are what make step-up ("re-authed in the last N minutes") possible without a
 * database column to write and keep in sync.
 * Authority is NOT taken from these claims; it comes from a fresh platform_admins lookup (see middleware).
 */
export interface PlatformToken {
  userId: string;
  email: string | null;
  aal: string | null; // 'aal1' | 'aal2'
  amr: AmrEntry[] | null;
  sessionId: string | null;
}

interface RawClaims {
  sub?: string;
  email?: string;
  aal?: string;
  amr?: Array<{ method?: unknown; timestamp?: unknown } | string> | null;
  session_id?: string;
}

/**
 * Read an `amr` timestamp defensively. Only a finite number (or a numeric string, in case a proxy
 * stringifies it) is a timestamp; anything else — absent, null, an object, "recently" — is UNKNOWN and
 * becomes null. It must never degrade to "now", because the step-up gate treats unknown as "cannot
 * prove freshness" and denies. Fail-closed starts here.
 */
function readAmrTimestamp(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Normalize one raw `amr` element. Returns null for entries with no usable method name. */
function toAmrEntry(raw: { method?: unknown; timestamp?: unknown } | string): AmrEntry | null {
  // Legacy/idiosyncratic issuers write bare strings; those carry no timestamp, so freshness is unknown.
  if (typeof raw === "string") return raw ? { method: raw, timestamp: null } : null;
  const method = typeof raw?.method === "string" ? raw.method : "";
  if (!method) return null;
  return { method, timestamp: readAmrTimestamp(raw?.timestamp) };
}

/** Verify a Supabase access token and return the platform principal (identity only). */
export async function verifyPlatformToken(token: string, key: VerifyKey): Promise<PlatformToken> {
  const { payload } =
    typeof key === "function" ? await jwtVerify(token, key) : await jwtVerify(token, key);
  const c = payload as RawClaims;
  if (!c.sub) throw new Error("token missing sub claim");
  const amr = Array.isArray(c.amr)
    ? c.amr.map(toAmrEntry).filter((e): e is AmrEntry => e !== null)
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
