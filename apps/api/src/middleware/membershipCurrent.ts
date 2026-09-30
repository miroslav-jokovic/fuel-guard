import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "@silvicom/shared";

/**
 * Is the membership a token names still the membership the person holds? (SP7, Q-SET6 (a).)
 *
 * An access token is a signed claim minted at sign-in or refresh: `org_id` and `user_role` are what
 * `custom_access_token_hook` read from `memberships` AT THAT MOMENT, and `requireAuth` verified only
 * the signature. So a person the admin removed, revoked, demoted or suspended kept their old access
 * in every API call until the token expired — up to an hour (jwt_expiry 3600). Ending their sessions
 * (`revoke_user_sessions`) stops the next REFRESH; it cannot recall a token already issued. This is
 * the half that makes the API itself stop answering it.
 *
 * A token is current when a membership row for (user, org) exists, carries the token's role, and is
 * not suspended (0393). Anything else is `stale` and `requireAuth` answers 401 `access_changed`,
 * which the web turns into a refresh — that fails, because the sessions were ended — and a sign-in.
 *
 * ── Cost, and what it does not cover ──────────────────────────────────────────────────────────
 * One indexed read per person per CACHE_MS per process, not per request: a CURRENT answer is cached
 * for 15 s, so a change takes effect in the API within 15 s on the other service (production runs two
 * from one railway.json) and at once on this one (`forgetMembership` below). A STALE answer is never
 * cached — it is the rare case and must not outlive a reinstatement.
 *
 * It does not reach RLS: the browser's direct PostgREST reads still honour the old token until it
 * expires, because a policy that looked `memberships` up would run per row on every table (the
 * `set search_path` inlining lesson, 128× on the spend page). That residue is the access token's
 * lifetime, and it is recorded in SETTINGS-PERMISSIONS-PLAN §4b rather than hidden here.
 *
 * ⚠ A failed READ is answered "current" (fail open), not cached, and logged. The token is still
 * genuinely signed, this is exactly what the API did before SP7, and failing closed would sign every
 * user out on a database blip — the one outage that should not also become a lockout.
 */
export const MEMBERSHIP_CACHE_MS = 15_000;

type Verdict = "current" | "stale";
const cache = new Map<string, number>();
const key = (userId: string, orgId: string) => `${userId}:${orgId}`;

/** Clears this process's cached answers for a person — called after any change to their membership. */
export function forgetMembership(userId: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${userId}:`)) cache.delete(k);
}

/** For tests: start from an empty cache. */
export function resetMembershipCache(): void {
  cache.clear();
}

export async function membershipVerdict(
  admin: SupabaseClient,
  ctx: Pick<AuthContext, "userId" | "orgId" | "role">,
  now: number = Date.now(),
): Promise<Verdict> {
  // A token with no org (a person with no membership yet, or already suspended) claims nothing to
  // re-check: `requireOrg` refuses it wherever an org is needed.
  if (!ctx.orgId) return "current";
  const k = key(ctx.userId, ctx.orgId);
  const until = cache.get(k);
  if (until !== undefined && until > now) return "current";

  const { data, error } = await admin
    .from("memberships")
    .select("role, suspended_at")
    .eq("org_id", ctx.orgId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) {
    console.error(`[membership] could not confirm ${ctx.userId} in ${ctx.orgId}; allowing the signed token`, error.message);
    return "current";
  }
  const row = data as { role: string; suspended_at: string | null } | null;
  if (!row || row.suspended_at !== null || row.role !== ctx.role) {
    cache.delete(k);
    return "stale";
  }
  cache.set(k, now + MEMBERSHIP_CACHE_MS);
  return "current";
}
