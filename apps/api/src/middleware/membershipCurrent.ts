import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEVICE_KEY_PATTERN,
  DEVICE_LIMIT,
  SESSION_IDLE_HOURS,
  TWO_STEP_DAYS,
  isRecordId,
  twoStepRequired,
  twoStepSatisfied,
  type AuthContext,
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
 * ── AND HAS THIS DEVICE GIVEN ITS CODE THIS WEEK? (INSTALLED-APP-PLAN IA-S1 rev 2, Q-IA20; migration 0662) ──
 * The second step is a 6-digit code emailed to the person, and a DEVICE that gave one is trusted for
 * `TWO_STEP_DAYS`. The read reports when this device last gave its code (`two_step_at`); the RULE —
 * who is asked (`twoStepRequired`), and whether the week still holds (`twoStepSatisfied`) — is in
 * `@silvicom/shared`, and this file only asks it. An office token whose device owes its code is
 * `second_factor`: never cached, and answered by `requireAuth` with 403 `second_factor_required`. The week
 * runs out mid-session too: a "current" answer is cached for 15 s, so the refusal comes within 15 s of the
 * seventh day. (Revision 1, 2026-11-15, read Supabase's authenticator-app `aal2` claim instead; the owner
 * replaced it on 2026-11-27 as too complicated.)
 *
 * ── AND WHICH DEVICE IS THIS? (INSTALLED-APP-PLAN IA-S6; migration 0620, carried into 0662's `member_access_gate`) ──
 * The read also REMEMBERS the device the request
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
  Pick<Partial<AuthContext>, "sessionId"> & {
    /** The app's own device key from the request header (0620); anything not in its alphabet is no key. */
    deviceKey?: string | null;
  };
const cache = new Map<string, number>();
// The device key is in the key: one session is ONE device to 0620, but a refusal must never be answered from
// another device's cached "current".
const key = (userId: string, orgId: string, sessionId: string | null, deviceKey: string | null) =>
  `${userId}:${orgId}:${sessionId ?? "-"}:${deviceKey ?? "-"}`;

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
  /** 0662: when THIS device last gave its emailed code; null for never. */
  two_step_at?: string | null;
  /** 0620: whether this device holds a place — null when nothing was decided (no live session, or one owing its code). */
  device_admitted?: boolean | null;
  devices_in_use?: number | null;
}

/**
 * The read: `member_access_gate` (0662). It needs the role rule's answer as a fact, `p_two_step_required`,
 * because which roles are asked lives in `@silvicom/shared` and nowhere in SQL. The token's role is the one
 * asked: a token whose role no longer matches the membership is `stale` whatever the row says.
 *
 * No fallback to 0620's `member_access_check`: this reader merged after 0662 was applied to staging, and a
 * release applies migrations before code. A database without it fails the read, which is answered as every
 * failed read is (below) — and logged.
 */
export async function readAccessState(
  admin: SupabaseClient,
  ctx: { userId: string; orgId: string; sessionId: string | null; deviceKey?: string | null; role: string | null },
): Promise<{ row: AccessStateRow | null } | { error: string }> {
  const res = await admin.rpc("member_access_gate", {
    p_org: ctx.orgId,
    p_user: ctx.userId,
    p_session: ctx.sessionId,
    p_device_key: ctx.deviceKey ?? null,
    p_limit: DEVICE_LIMIT,
    p_idle_hours: SESSION_IDLE_HOURS,
    p_two_step_days: TWO_STEP_DAYS,
    p_two_step_required: twoStepRequired(ctx.role),
  });
  if (res.error) return { error: res.error.message };
  return { row: ((res.data ?? []) as AccessStateRow[])[0] ?? null };
}

/** The header's value when it is a device key; anything else — absent, too long, another alphabet — is none. */
export const deviceKeyClaim = (raw: string | undefined | null): string | null =>
  typeof raw === "string" && DEVICE_KEY_PATTERN.test(raw) ? raw : null;

/** Only ever a uuid reaches the database: anything else in the claim is "cannot tell", not an error. */
export const sessionClaim = (ctx: Pick<Partial<AuthContext>, "sessionId">): string | null =>
  ctx.sessionId && isRecordId(ctx.sessionId) ? ctx.sessionId : null;


export async function membershipVerdict(admin: SupabaseClient, ctx: Ctx, now: number = Date.now()): Promise<Verdict> {
  // A token with no org (a person with no membership yet, or already suspended) claims nothing to
  // re-check: `requireOrg` refuses it wherever an org is needed.
  if (!ctx.orgId) return "current";
  const sessionId = sessionClaim(ctx);
  const deviceKey = deviceKeyClaim(ctx.deviceKey);
  const k = key(ctx.userId, ctx.orgId, sessionId, deviceKey);
  const until = cache.get(k);
  if (until !== undefined && until > now) return "current";

  const read = await readAccessState(admin, { userId: ctx.userId, orgId: ctx.orgId, sessionId, deviceKey, role: ctx.role });
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
  if (twoStepRequired(row.role) && !twoStepSatisfied(row.two_step_at, new Date(now))) {
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
