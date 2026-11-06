import { supabase } from "./supabase";

/**
 * The browser half of step-up re-authentication (audit P0-4).
 *
 * ── Why this stopped being "sign in again and rely on the token's iat" ───────────────────────────
 * The API used to read the access token's `iat`: a fresh sign-in re-minted the token, so the next
 * request looked recent. But Supabase ALSO re-mints access tokens through the refresh-token grant —
 * automatically, and on demand via `refreshSession()` — with a current `iat` and no password. So
 * `iat` freshness proved nothing an attacker at an unattended, signed-in browser could not manufacture.
 *
 * The server now issues a step-up TOKEN, minted only after it re-verifies the password against
 * Supabase's own grant (POST /api/auth/step-up). This module gets that token and holds it in memory
 * for the few minutes it is valid, so the sensitive request that follows can present it in the
 * `x-step-up-token` header. Nothing is persisted: a step-up is a moment, not a standing grant.
 */

const HEADER = "x-step-up-token";

interface HeldToken {
  token: string;
  expiresAtMs: number;
}

let held: HeldToken | null = null;

/** A small margin so a token that will expire mid-flight is treated as already gone. */
const EXPIRY_MARGIN_MS = 5_000;

/**
 * Verify the password with the server and hold the resulting step-up token.
 *
 * The password is sent ONCE, to our API, over the same TLS as every other call; it is never stored
 * and never logged. `"refused"` covers a wrong password and an SSO account with none alike, with no
 * held token — the caller shows the same neutral message for both. `"unavailable"` is the server
 * saying it cannot check ANY password (503 `step_up_unavailable`: a setting missing on that deploy).
 * Staging ran that way for two weeks while this prompt told people to check a password that was
 * right (Q-AD41), so that answer gets its own words; which settings are missing is on /api/version.
 */
export type StepUpResult = "verified" | "refused" | "unavailable";

export async function verifyStepUp(password: string): Promise<StepUpResult> {
  const { data } = await supabase.auth.getSession();
  const bearer = data.session?.access_token;
  if (!bearer) return "refused";

  const res = await fetch("/api/auth/step-up", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ password }),
  });
  if (res.status === 503) {
    const refusal = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (refusal?.error?.code === "step_up_unavailable") return "unavailable";
  }
  if (!res.ok) return "refused";

  const body = (await res.json().catch(() => null)) as { token?: string; expiresAt?: string } | null;
  if (!body?.token || !body.expiresAt) return "refused";

  held = { token: body.token, expiresAtMs: Date.parse(body.expiresAt) };
  return "verified";
}

/** The header to merge into a request, when a live step-up token is held. Empty otherwise, so a
 *  caller can always spread it unconditionally. */
export function stepUpHeader(): Record<string, string> {
  if (held && held.expiresAtMs - EXPIRY_MARGIN_MS > Date.now()) {
    return { [HEADER]: held.token };
  }
  held = null;
  return {};
}

/** Test seam, and the sign-out hook: a step-up must never outlive the session that earned it. */
export function clearStepUp(): void {
  held = null;
}
