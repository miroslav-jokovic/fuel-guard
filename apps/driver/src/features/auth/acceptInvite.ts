import type { EmailOtpType } from '@supabase/supabase-js';
import {
  hasSessionMaterial,
  inviteLinkErrorMessage,
  parseInviteUrl,
  type InviteLinkParams,
} from '@silvicom/shared';
import { supabase } from '@/lib/supabase';

/**
 * Invite deep-link handling (Phase 1, D11/D15) — the RN half of the accept flow.
 *
 * The PARSING used to live here, and only here: the web SPA had no equivalent and leaned entirely
 * on supabase-js's `detectSessionInUrl`, which covers one of the four link shapes. That asymmetry
 * is what took the web invite down (2026-09-02), so the parser moved to `@silvicom/shared` and both
 * apps now read the same one. What stays here is the half that cannot be shared: turning parsed
 * params into a session needs THIS app's Supabase client.
 *
 * Never log URLs here — they carry credentials (D11).
 */

export { parseInviteUrl, hasSessionMaterial };
export type { InviteLinkParams };

/**
 * Establish a Supabase session from a parsed invite link. Throws a user-safe Error on failure —
 * callers show the message and offer "ask your admin to resend".
 */
export async function establishSession(p: InviteLinkParams): Promise<void> {
  const linkError = inviteLinkErrorMessage(p);
  if (linkError) throw new Error(linkError);

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
      type: (p.verifyType ?? 'invite') as EmailOtpType,
      token_hash: p.verifyTokenHash,
    });
    if (error) throw new Error('This invitation link has expired or was already used. Ask your admin to resend it.');
    return;
  }
  throw new Error('This doesn’t look like an invitation link.');
}
