import type { SupabaseClient } from "@supabase/supabase-js";
import { SECOND_STEP_DONE, isRecordId, secondFactorRequired, type AuthContext, type UserRole } from "@silvicom/shared";

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
 * ── AND HAS THE SECOND STEP BEEN TAKEN? (INSTALLED-APP-PLAN IA-S1; migration 0617) ──
 * The read is now `member_access_state`: the same answers plus the company's date and whether the person
 * has a verified second factor — still one round trip. The RULE is `secondFactorRequired` in
 * `@silvicom/shared`; this file only asks it. A token that needs the second step and is not `aal2` is
 * `second_factor`: never cached, and answered by `requireAuth` with 403 `second_factor_required`.
 *
 * ⚠ A failed READ is answered "current" (fail open), not cached, and logged. The token is still
 * genuinely signed, this is exactly what the API did before SP7, and failing closed would sign every
 * user out on a database blip — the one outage that should not also become a lockout.
 */
export const MEMBERSHIP_CACHE_MS = 15_000;

export type Verdict = "current" | "stale" | "signed_out" | "second_factor";
type Ctx = Pick<AuthContext, "userId" | "orgId" | "role"> & Pick<Partial<AuthContext>, "sessionId" | "aal">;
const cache = new Map<string, number>();
// The assurance level is in the key: the SAME session is refused before its code and current after it.
const key = (userId: string, orgId: string, sessionId: string | null, aal: string | null) => `${userId}:${orgId}:${sessionId ?? "-"}:${aal ?? "-"}`;

/**
 * Clears this process's cached answers for a person — every session of theirs — called after any change
 * to their membership, their sessions or their second factor.
 */
export function forgetMembership(userId: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${userId}:`)) cache.delete(k);
}

/** For tests: start from an empty cache. */
export function resetMembershipCache(): void {
  cache.clear();
}

export interface AccessStateRow {
  role: string;
  suspended_at: string | null;
  session_alive?: boolean | null;
  second_factor_required_from?: string | null;
  has_second_factor?: boolean | null;
}

/** PostgREST's and Postgres's "there is no such function". */
const functionMissing = (e: { code?: string }) => e.code === "PGRST202" || e.code === "42883";

/**
 * The read: `member_access_state` (0617) when the database has it.
 *
 * DEPLOY-WINDOW GUARD, labelled as one: on a database that has not had 0617 applied it asks 0616's
 * `member_token_state` (membership and session, no second factor), and without that the `memberships`
 * read SP7 shipped with — so the membership rule never lapses and each later rule simply waits for its
 * migration. A release applies migrations before code and both merged first, so this is the order going
 * wrong, not the normal case. Remove both fallbacks once 0617 is in a production release; then drop
 * `member_token_state`, which will have no reader.
 */
export async function readAccessState(
  admin: SupabaseClient,
  ctx: { userId: string; orgId: string; sessionId: string | null },
): Promise<{ row: AccessStateRow | null } | { error: string }> {
  for (const fn of ["member_access_state", "member_token_state"]) {
    const res = await admin.rpc(fn, { p_org: ctx.orgId, p_user: ctx.userId, p_session: ctx.sessionId });
    if (!res.error) return { row: ((res.data ?? []) as AccessStateRow[])[0] ?? null };
    if (!functionMissing(res.error as { code?: string })) return { error: res.error.message };
  }
  const { data, error } = await admin
    .from("memberships")
    .select("role, suspended_at")
    .eq("org_id", ctx.orgId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) return { error: error.message };
  return { row: (data as AccessStateRow | null) ?? null };
}

/** Only ever a uuid reaches the database: anything else in the claim is "cannot tell", not an error. */
export const sessionClaim = (ctx: Pick<Partial<AuthContext>, "sessionId">): string | null =>
  ctx.sessionId && isRecordId(ctx.sessionId) ? ctx.sessionId : null;

/** The facts `secondFactorRequired` reads, from a row; a database without 0617 has none, and requires nothing. */
export const secondFactorFacts = (row: AccessStateRow) => ({
  role: row.role as UserRole,
  hasFactor: row.has_second_factor === true,
  requiredFrom: row.second_factor_required_from ?? null,
});

export async function membershipVerdict(admin: SupabaseClient, ctx: Ctx, now: number = Date.now()): Promise<Verdict> {
  // A token with no org (a person with no membership yet, or already suspended) claims nothing to
  // re-check: `requireOrg` refuses it wherever an org is needed.
  if (!ctx.orgId) return "current";
  const sessionId = sessionClaim(ctx);
  const k = key(ctx.userId, ctx.orgId, sessionId, ctx.aal ?? null);
  const until = cache.get(k);
  if (until !== undefined && until > now) return "current";

  const read = await readAccessState(admin, { userId: ctx.userId, orgId: ctx.orgId, sessionId });
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
  if (ctx.aal !== SECOND_STEP_DONE && secondFactorRequired(secondFactorFacts(row), new Date(now))) {
    cache.delete(k);
    return "second_factor";
  }
  cache.set(k, now + MEMBERSHIP_CACHE_MS);
  return "current";
}
