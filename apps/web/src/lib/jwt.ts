import type { AuthClaims } from "@fuelguard/shared";

/**
 * Decode (NOT verify) a JWT payload to read our custom claims (org_id, user_role) for UI gating.
 * The client trusts its own session; real authorization is enforced by RLS + the API. Never rely
 * on this for security decisions.
 */
export function decodeClaims(accessToken: string | undefined | null): AuthClaims | null {
  if (!accessToken) return null;
  const parts = accessToken.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || !payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as AuthClaims;
  } catch {
    return null;
  }
}
