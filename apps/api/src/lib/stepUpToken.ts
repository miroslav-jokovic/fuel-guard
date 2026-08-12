import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import type { Env } from "../env.js";
import { decodeSecretsKey, SecretBoxError } from "./secretBox.js";

/**
 * Server-minted step-up tokens: proof that THIS user re-entered their password moments ago.
 *
 * ── Why `iat` freshness was not that proof (audit P0-4) ──────────────────────────────────────────
 * `requireFreshAuth` gated on the access token's issue time, on the premise that only
 * `signInWithPassword` re-mints. Supabase also re-mints through the refresh-token grant — which
 * supabase-js runs automatically and any caller can trigger with `refreshSession()`, no password
 * involved — so every step-up gate was passable from any signed-in session. The unattended-laptop
 * scenario the middleware's own docblock names is exactly the one it did not stop.
 *
 * The replacement: POST /api/auth/step-up verifies the password against Supabase's own password
 * grant (we never see or store it beyond forwarding), then mints this short-lived HMAC token bound
 * to userId+orgId. Possession of a valid token IS the fresh-password fact, independent of anything
 * the browser can do to its session tokens.
 *
 * ── Shape ────────────────────────────────────────────────────────────────────────────────────────
 * `v1.<expEpochSec>.<hmacHex>` over `v1:{userId}:{orgId}:{exp}`, keyed by an HKDF subkey of
 * SECRETS_ENCRYPTION_KEY (label "step-up-token" — distinct from the sealing and card-ref subkeys,
 * same one-master-many-subkeys pattern as efsCardMirror.cardRefHmac). Stateless on purpose: the
 * only claim is "this user, this org, until exp", the window is minutes, and revocation-by-table
 * would rebuild the session store this feature exists to not trust.
 */

const VERSION = "v1";

/** Same window the old iat check used — long enough to act, short enough that an unattended
 *  machine is not a standing grant. */
export const STEP_UP_TOKEN_TTL_SEC = 300;

/** Header the gates read. Exported so middleware, routes and (later) the web client name one string. */
export const STEP_UP_TOKEN_HEADER = "x-step-up-token";

function subkey(env: Env): Buffer | null {
  // Shared strict decoder (audit hardening): assert 32 bytes rather than trust a lax hex/base64
  // heuristic that could shorten the master silently. A missing/invalid key yields null, and every
  // caller turns that into "cannot mint / cannot verify" — fail closed, never a weak token.
  let master: Buffer;
  try {
    master = decodeSecretsKey(env);
  } catch (e) {
    if (e instanceof SecretBoxError) return null;
    throw e;
  }
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "step-up-token", 32));
}

const sign = (key: Buffer, userId: string, orgId: string, exp: number): string =>
  createHmac("sha256", key).update(`${VERSION}:${userId}:${orgId}:${exp}`).digest("hex");

/** Null when the deploy has no SECRETS_ENCRYPTION_KEY — the caller turns that into a 503, because a
 *  step-up endpoint that silently cannot mint is a gate nobody can ever pass. */
export function mintStepUpToken(
  env: Env,
  userId: string,
  orgId: string,
  nowMs: number = Date.now(),
): { token: string; expiresAt: string } | null {
  const key = subkey(env);
  if (!key) return null;
  const exp = Math.floor(nowMs / 1000) + STEP_UP_TOKEN_TTL_SEC;
  return {
    token: `${VERSION}.${exp}.${sign(key, userId, orgId, exp)}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/** Constant-time verify. False for: malformed, expired, wrong user, wrong org, missing key. */
export function verifyStepUpToken(
  env: Env,
  token: string,
  userId: string,
  orgId: string,
  nowMs: number = Date.now(),
): boolean {
  const key = subkey(env);
  if (!key) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return false;
  const exp = Number(parts[1]);
  if (!Number.isInteger(exp) || exp * 1000 <= nowMs) return false;
  const expected = Buffer.from(sign(key, userId, orgId, exp), "hex");
  const presented = Buffer.from(parts[2] ?? "", "hex");
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}
