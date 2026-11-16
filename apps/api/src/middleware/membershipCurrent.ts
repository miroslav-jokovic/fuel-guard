import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEVICE_KEY_PATTERN,
  DEVICE_LIMIT,
  SECOND_STEP_DONE,
  SESSION_IDLE_HOURS,
  isRecordId,
  secondFactorRequired,
  type AuthContext,
  type UserRole,
} from "@silvicom/shared";

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
 * ── AND WHICH DEVICE IS THIS? (INSTALLED-APP-PLAN IA-S6; migration 0620) ──
 * The read is now `member_access_check`: the same answers, and on the way it REMEMBERS the device the request
 * comes from (the app's own key, `DEVICE_KEY_HEADER`) and the address Supabase saw it at, and says whether
 * the device holds one of the `DEVICE_LIMIT` places. Still one round trip, still at most once per session per
 * 15 s. A device that does not hold one is `device_limit` (Q-IA14 (b): the fourth sign-in is STOPPED, nobody
 * else is signed out): never cached, so the moment the person signs another device out the next request is
 * admitted. `requireAuth` answers it 403 `device_limit`, and the apps show the three devices with a way to
 * sign one out — `requireAuthOverLimit` lets exactly those routes through.
 *
 * ⚠ A failed READ is answered "current" (fail open), not cached, and logged. The token is still
 * genuinely signed, this is exactly what the API did before SP7, and failing closed would sign every
 * user out on a database blip — the one outage that should not also become a lockout.
 */
export const MEMBERSHIP_CACHE_MS = 15_000;

export type Verdict = "current" | "stale" | "signed_out" | "second_factor" | "device_limit";
type Ctx = Pick<AuthContext, "userId" | "orgId" | "role"> &
  Pick<Partial<AuthContext>, "sessionId" | "aal"> & {
    /** The app's own device key from the request header (0620); anything not in its alphabet is no key. */
    deviceKey?: string | null;
  };
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
  /** 0620: whether this device holds a place — null when nothing was decided (no live session, or one owing its code). */
  device_admitted?: boolean | null;
  devices_in_use?: number | null;
}

/** PostgREST's and Postgres's "there is no such function". */
const functionMissing = (e: { code?: string }) => e.code === "PGRST202" || e.code === "42883";

/**
 * The read: `member_access_check` (0620).
 *
 * DEPLOY-WINDOW GUARD, labelled as one: on a database without 0620 it asks 0617's `member_access_state`, which
 * answers everything but the device — so nothing is remembered there and nothing else changes. Production has
 * had 0617 since the release of 2026-11-16 (seen in its catalogue that day), so the two older fallbacks this
 * replaced — 0616's `member_token_state` and SP7's `memberships` read — are gone, as their own comment asked.
 * Remove this one once 0620 is in a production release; `member_access_state` then has no reader, and
 * `member_token_state` already has none — both are dropped a release after that.
 */
export async function readAccessState(
  admin: SupabaseClient,
  ctx: { userId: string; orgId: string; sessionId: string | null; deviceKey?: string | null },
): Promise<{ row: AccessStateRow | null } | { error: string }> {
  const base = { p_org: ctx.orgId, p_user: ctx.userId, p_session: ctx.sessionId };
  const check = await admin.rpc("member_access_check", {
    ...base,
    p_device_key: ctx.deviceKey ?? null,
    p_limit: DEVICE_LIMIT,
    p_idle_hours: SESSION_IDLE_HOURS,
  });
  if (!check.error) return { row: ((check.data ?? []) as AccessStateRow[])[0] ?? null };
  if (!functionMissing(check.error as { code?: string })) return { error: check.error.message };
  const res = await admin.rpc("member_access_state", base);
  if (res.error) return { error: res.error.message };
  return { row: ((res.data ?? []) as AccessStateRow[])[0] ?? null };
}

/** The header's value when it is a device key; anything else — absent, too long, another alphabet — is none. */
export const deviceKeyClaim = (raw: string | undefined | null): string | null =>
  typeof raw === "string" && DEVICE_KEY_PATTERN.test(raw) ? raw : null;

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

  const read = await readAccessState(admin, { userId: ctx.userId, orgId: ctx.orgId, sessionId, deviceKey: deviceKeyClaim(ctx.deviceKey) });
  if ("error" in read) {
    console.error(`[membership] could not confirm ${ctx.userId} in ${ctx.orgId}; allowing the signed token`, read.error);
    return "current";
  }
  const row = read.row;
  if (!row || row.suspended_at !== null || row.role !== ctx.role) {
    cache.delete(k);
    return "stale";
  }
  // Exactly false: NULL is a token that names no session.
  if (row.session_alive === false) {
    cache.delete(k);
    return "signed_out";
  }
  if (ctx.aal !== SECOND_STEP_DONE && secondFactorRequired(secondFactorFacts(row), new Date(now))) {
    cache.delete(k);
    return "second_factor";
  }
  // Exactly false: NULL is "nothing decided" — no session named, or one still owing its code (0620).
  if (row.device_admitted === false) {
    cache.delete(k);
    return "device_limit";
  }
  cache.set(k, now + MEMBERSHIP_CACHE_MS);
  return "current";
}
