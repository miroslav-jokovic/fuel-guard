import type { SupabaseClient } from "@supabase/supabase-js";
import { isRecordId, type AuthContext } from "@silvicom/shared";

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
 * ── AND IS THE DEVICE STILL SIGNED IN? (INSTALLED-APP-PLAN Q-IA10 (a), ruled 2026-11-15; migration 0616) ──
 * The same hour applied to a SESSION: a device signed out from "Signed-in devices", or by anything that
 * ends sessions, kept calling the API until its token expired (seen on staging 2026-11-15: ended, could
 * not renew, still 200). So the read is now `member_token_state`, which answers the membership AND
 * whether the token's session still exists, in the one round trip this already made — and the cache is
 * per SESSION, so a person on a PC and a phone costs two reads per 15 s where they cost one. Measured
 * before building: the read it replaces ran 106,108 times in 41 days at 0.045 ms, 0.01% of the
 * database's work. A dead session is `signed_out`: never cached, and answered by `requireAuth` with
 * the same 401 `access_changed` — the web's answer to that is a refresh, which fails, and a sign-in.
 * A token that names no session (`session_alive` NULL) is "cannot tell" and stands.
 *
 * ⚠ A failed READ is answered "current" (fail open), not cached, and logged. The token is still
 * genuinely signed, this is exactly what the API did before SP7, and failing closed would sign every
 * user out on a database blip — the one outage that should not also become a lockout.
 */
export const MEMBERSHIP_CACHE_MS = 15_000;

type Verdict = "current" | "stale" | "signed_out";
type Ctx = Pick<AuthContext, "userId" | "orgId" | "role"> & Pick<Partial<AuthContext>, "sessionId">;
const cache = new Map<string, number>();
const key = (userId: string, orgId: string, sessionId: string | null) => `${userId}:${orgId}:${sessionId ?? "-"}`;

/**
 * Clears this process's cached answers for a person — every session of theirs — called after any change
 * to their membership or to their sessions.
 */
export function forgetMembership(userId: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${userId}:`)) cache.delete(k);
}

/** For tests: start from an empty cache. */
export function resetMembershipCache(): void {
  cache.clear();
}

interface StateRow { role: string; suspended_at: string | null; session_alive?: boolean | null }

/** PostgREST's and Postgres's "there is no such function". */
const functionMissing = (e: { code?: string }) => e.code === "PGRST202" || e.code === "42883";

/**
 * The read. `member_token_state` (0616) when the database has it.
 *
 * DEPLOY-WINDOW GUARD, labelled as one: where the function is not there — this code served by a database
 * that has not had 0616 applied — it falls back to the `memberships` read SP7 shipped with, so the
 * membership rule never lapses; only the session half waits. A release applies migrations before code and
 * 0616 merged first, so this is the order going wrong, not the normal case. Remove the fallback once 0616
 * is in a production release (then a missing function is a real fault and should be logged as one).
 */
async function readState(admin: SupabaseClient, ctx: { userId: string; orgId: string; sessionId: string | null }): Promise<{ row: StateRow | null } | { error: string }> {
  const viaFunction = await admin.rpc("member_token_state", { p_org: ctx.orgId, p_user: ctx.userId, p_session: ctx.sessionId });
  if (!viaFunction.error) return { row: ((viaFunction.data ?? []) as StateRow[])[0] ?? null };
  if (!functionMissing(viaFunction.error as { code?: string })) return { error: viaFunction.error.message };
  const { data, error } = await admin
    .from("memberships")
    .select("role, suspended_at")
    .eq("org_id", ctx.orgId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) return { error: error.message };
  return { row: (data as StateRow | null) ?? null };
}

export async function membershipVerdict(admin: SupabaseClient, ctx: Ctx, now: number = Date.now()): Promise<Verdict> {
  // A token with no org (a person with no membership yet, or already suspended) claims nothing to
  // re-check: `requireOrg` refuses it wherever an org is needed.
  if (!ctx.orgId) return "current";
  // Only ever a uuid reaches the database: anything else in the claim is "cannot tell", not an error.
  const sessionId = ctx.sessionId && isRecordId(ctx.sessionId) ? ctx.sessionId : null;
  const k = key(ctx.userId, ctx.orgId, sessionId);
  const until = cache.get(k);
  if (until !== undefined && until > now) return "current";

  const read = await readState(admin, { userId: ctx.userId, orgId: ctx.orgId, sessionId });
  if ("error" in read) {
    console.error(`[membership] could not confirm ${ctx.userId} in ${ctx.orgId}; allowing the signed token`, read.error);
    return "current";
  }
  const row = read.row;
  if (!row || row.suspended_at !== null || row.role !== ctx.role) {
    cache.delete(k);
    return "stale";
  }
  // Exactly false: NULL is a token that names no session, and absent is the fallback read.
  if (row.session_alive === false) {
    cache.delete(k);
    return "signed_out";
  }
  cache.set(k, now + MEMBERSHIP_CACHE_MS);
  return "current";
}
