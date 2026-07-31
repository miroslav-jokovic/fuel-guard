import type { EmailOtpType } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

/**
 * Invite deep-link handling (Phase 1, D11/D15) — the RN mirror of the web's accept flow.
 *
 * Entry shapes we accept:
 *  1. `fuelguard://accept-invite?token=<invite>#access_token=…&refresh_token=…`
 *     — the normal path: Supabase's https action_link verifies server-side, then redirects to the
 *       app scheme with session tokens in the fragment. We `setSession`.
 *  2. `…?code=…` — PKCE-style redirect. We `exchangeCodeForSession`.
 *  3. A pasted `https://…/auth/v1/verify?token=…&type=invite&redirect_to=…` action link
 *     (the rescue path when the OS didn't hand the link to the app) — we `verifyOtp` with the
 *     token_hash, and dig the invite token out of the nested redirect_to.
 *
 * Never log URLs here — they carry credentials (D11).
 */

export interface InviteLinkParams {
  inviteToken: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  code: string | null;
  verifyTokenHash: string | null;
  verifyType: EmailOtpType | null;
  errorDescription: string | null;
}

function collect(search: string, into: Map<string, string>): void {
  const params = new URLSearchParams(search);
  params.forEach((value, key) => {
    if (!into.has(key)) into.set(key, value);
  });
}

/** Parse query + fragment params out of any of the accepted URL shapes. */
export function parseInviteUrl(url: string): InviteLinkParams {
  const map = new Map<string, string>();
  const [beforeHash, ...hashParts] = url.split('#');
  const hash = hashParts.join('#');
  const queryIndex = (beforeHash ?? '').indexOf('?');
  if (queryIndex >= 0) collect((beforeHash ?? '').slice(queryIndex + 1), map);
  if (hash) collect(hash, map);

  const isVerifyLink = (beforeHash ?? '').includes('/auth/v1/verify');
  let inviteToken = !isVerifyLink ? (map.get('token') ?? null) : null;

  // A pasted action link nests our invite token inside redirect_to=…?token=…
  const redirectTo = map.get('redirect_to');
  if (!inviteToken && redirectTo) {
    try {
      const decoded = decodeURIComponent(redirectTo);
      const innerQuery = decoded.indexOf('?');
      if (innerQuery >= 0) {
        const inner = new URLSearchParams(decoded.slice(innerQuery + 1));
        inviteToken = inner.get('token');
      }
    } catch {
      /* malformed redirect_to — ignore */
    }
  }

  const rawType = map.get('type');
  const verifyType: EmailOtpType | null =
    rawType === 'invite' || rawType === 'recovery' || rawType === 'magiclink' || rawType === 'signup'
      ? rawType
      : null;

  return {
    inviteToken,
    accessToken: map.get('access_token') ?? null,
    refreshToken: map.get('refresh_token') ?? null,
    code: map.get('code') ?? null,
    verifyTokenHash: isVerifyLink ? (map.get('token') ?? null) : null,
    verifyType,
    errorDescription: map.get('error_description') ?? map.get('error') ?? null,
  };
}

/** True when the URL carries anything we could turn into a session. */
export function hasSessionMaterial(p: InviteLinkParams): boolean {
  return !!((p.accessToken && p.refreshToken) ?? p.code ?? p.verifyTokenHash);
}

/**
 * Establish a Supabase session from a parsed invite link. Throws a user-safe Error on failure —
 * callers show the message and offer "ask your admin to resend".
 */
export async function establishSession(p: InviteLinkParams): Promise<void> {
  if (p.errorDescription) {
    throw new Error('This invitation link has expired or was already used. Ask your admin to resend it.');
  }
  if (p.accessToken && p.refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: p.accessToken,
      refresh_token: p.refreshToken,
    });
    if (error) throw new Error('Couldn’t start your session from this link. Ask your admin to resend it.');
    return;
  }
  if (p.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(p.code);
    if (error) throw new Error('Couldn’t start your session from this link. Ask your admin to resend it.');
    return;
  }
  if (p.verifyTokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      type: p.verifyType ?? 'invite',
      token_hash: p.verifyTokenHash,
    });
    if (error) throw new Error('This invitation link has expired or was already used. Ask your admin to resend it.');
    return;
  }
  throw new Error('This doesn’t look like an invitation link.');
}
