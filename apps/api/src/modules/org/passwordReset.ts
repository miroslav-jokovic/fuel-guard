import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PASSWORD_RESET_TTL_MINUTES,
  isRosterIssuedRole,
  passwordProblem,
  renderPasswordChangedEmail,
  renderPasswordResetEmail,
} from "@silvicom/shared";
import { hashLinkToken, mintLinkToken } from "../../lib/linkToken.js";
import { makeSender } from "../../lib/mailer.js";
import { writeAudit } from "../../lib/audit.js";
import type { Env } from "../../env.js";

/**
 * An office user's forgotten password: issuing the emailed link, reading it, and spending it.
 *
 * docs/plans/permissions/PASSWORD-RESET-PLAN.md; the table and its two functions are migration 0363,
 * whose header carries D-PWR1..D-PWR6. Two routes share this — the public one (`routes/
 * publicPasswordReset.ts`), where the person asks for themselves, and the admin's send from the Users
 * page (`routes/memberPasswordReset.ts`) — and both end in `issueReset`, so the link, its life and its
 * audit row are the same whoever pressed the button.
 *
 * ── WHY THESE QUERIES ARE KEYED BY USER AND NOT BY ORG ──────────────────────────────────────────
 * A password belongs to the person (D-PWR4), and `password_resets` allows ONE live row per user across
 * every org (D-PWR2). Revoking "the live link" filtered to one org would leave a live link in another
 * and then fail the unique index on insert. Every read here is by `user_id` or by the token's hash —
 * a 256-bit value nobody can aim at another tenant — and the admin route has already proved, with an
 * org-scoped membership read, that the person is in the caller's org before it reaches this file.
 */

export type ResetError = { code: string; message: string; status: number };
export const isResetError = (v: object): v is ResetError => "status" in v && "code" in v;

const INVALID_LINK: ResetError = {
  code: "invalid_link",
  status: 404,
  message: "This reset link is no longer valid. Ask for a new one from the sign-in page.",
};

/** How many links one person may be sent in an hour. Anti-mailbomb, counted in the table so it
 *  survives a restart and holds across both Railway services. */
export const MAX_RESETS_PER_HOUR = 3;

export interface ResetTarget {
  userId: string;
  orgId: string;
}

interface CandidateRow {
  user_id: string;
  org_id: string;
  role: string;
}

/**
 * Who a reset for this address would be for — or null, and null says nothing about why.
 *
 * A driver is never a target (DRIVER-CREDENTIALS-PLAN DC3: their password is company-issued and reset
 * from the Drivers page), and the rule is read from `isRosterIssuedRole`, not restated (D-PWR5). An
 * address holding ANY roster-issued membership is refused outright rather than reset through its
 * office one: the password is one password, and changing it would change the driver's too. Rows are
 * ordered by `joined_at`, so a person in two orgs gets their oldest office membership (D-PWR4).
 */
export function pickResetTarget(rows: CandidateRow[]): ResetTarget | null {
  if (rows.length === 0 || rows.some((r) => isRosterIssuedRole(r.role))) return null;
  const first = rows[0]!;
  return { userId: first.user_id, orgId: first.org_id };
}

async function candidatesFor(admin: SupabaseClient, email: string): Promise<CandidateRow[]> {
  const { data, error } = await admin.rpc("password_reset_candidates", { p_email: email });
  if (error) throw new Error(`password_reset_candidates: ${error.message}`);
  return (data ?? []) as CandidateRow[];
}

/** `pickResetTarget` over the address's live memberships — the one question both routes ask. */
export async function resetTargetForEmail(admin: SupabaseClient, email: string): Promise<ResetTarget | null> {
  return pickResetTarget(await candidatesFor(admin, email));
}

export interface IssuedReset {
  sent: boolean;
  expiresAt: string;
}

/**
 * Mint a link, make it the ONLY live one for this person, and email it.
 *
 * The previous live link is revoked FIRST, so "send it again" leaves one working email in the inbox
 * rather than two identical ones — the invitation's third lost-link failure, not repeated. The link
 * itself is never returned: not to the anonymous caller, and not to an admin (D-PWR8), because a
 * link in an admin's hands is the admin choosing somebody else's password.
 */
export async function issueReset(
  admin: SupabaseClient,
  env: Env,
  args: { target: ResetTarget; email: string; requestedBy: string | null; now: Date; ip?: string },
): Promise<IssuedReset | ResetError> {
  const { target, email, requestedBy, now } = args;
  const nowIso = now.toISOString();

  const { error: revokeErr } = await admin
    .from("password_resets")
    .update({ revoked_at: nowIso })
    .eq("user_id", target.userId)
    .is("consumed_at", null)
    .is("revoked_at", null);
  if (revokeErr) return { code: "db_error", status: 500, message: "Could not issue a reset link." };

  const minted = mintLinkToken();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * 60_000).toISOString();
  const { data: row, error: insErr } = await admin
    .from("password_resets")
    .insert({
      org_id: target.orgId,
      user_id: target.userId,
      token_hash: minted.hash,
      requested_by: requestedBy,
      created_at: nowIso,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (insErr || !row) return { code: "db_error", status: 500, message: "Could not issue a reset link." };

  const link = `${env.WEB_APP_URL}/reset-password?token=${encodeURIComponent(minted.token)}`;
  const mail = renderPasswordResetEmail(link, requestedBy !== null);
  const sent =
    env.MAIL_PROVIDER !== "none" &&
    (await makeSender(env)({ to: [email], subject: mail.subject, html: mail.html, text: mail.text }));
  if (!sent) {
    // A link that reached nobody must not stay live: the only copy of its token is about to be
    // garbage-collected, and a live row would block nothing but would read as "sent" to an auditor.
    await admin.from("password_resets").update({ revoked_at: nowIso }).eq("id", row.id).is("consumed_at", null);
  }

  await writeAudit(admin, {
    orgId: target.orgId,
    actorId: requestedBy,
    action: "auth.password_reset_requested",
    entity: "users",
    entityId: target.userId,
    meta: { via: requestedBy ? "admin" : "self", sent, expiresAt, ...(args.ip ? { ip: args.ip } : {}) },
  });
  return { sent, expiresAt };
}

/**
 * The public request: find the person, apply the hourly budget, issue.
 *
 * Returns nothing the caller may show. The route answers the same sentence before this even runs
 * (`routes/publicPasswordReset.ts`), so whether the address has an account, is a driver, is over its
 * budget or bounced — none of it reaches the anonymous caller, by content OR by timing.
 */
export async function requestSelfServiceReset(
  admin: SupabaseClient,
  env: Env,
  args: { email: string; now: Date; ip: string },
): Promise<void> {
  const email = args.email.trim().toLowerCase();
  const target = await resetTargetForEmail(admin, email);
  if (!target) return;

  const since = new Date(args.now.getTime() - 60 * 60_000).toISOString();
  const { data: recent } = await admin
    .from("password_resets")
    .select("id")
    .eq("user_id", target.userId)
    .gte("created_at", since);
  if ((recent ?? []).length >= MAX_RESETS_PER_HOUR) {
    await writeAudit(admin, {
      orgId: target.orgId,
      actorId: null,
      action: "auth.password_reset_throttled",
      entity: "users",
      entityId: target.userId,
      meta: { ip: args.ip, limit: MAX_RESETS_PER_HOUR },
    });
    return;
  }
  const issued = await issueReset(admin, env, { target, email, requestedBy: null, now: args.now, ip: args.ip });
  if (isResetError(issued)) console.error(`[password-reset] issue failed: ${issued.message}`);
}

interface LiveReset {
  id: string;
  orgId: string;
  userId: string;
  email: string;
  expiresAt: string;
}

/**
 * The reset a link points at, if it can still be spent. Used, revoked, expired, unknown, or for a
 * person who has since become a driver or left: one answer for all of them, `invalid_link`, for the
 * reason `resolveInviteByToken` gives — a different refusal for each would tell an anonymous caller
 * that a token EXISTED.
 */
export async function resolveReset(admin: SupabaseClient, token: string, now: Date): Promise<LiveReset | ResetError> {
  const { data: row } = await admin
    .from("password_resets")
    .select("id, org_id, user_id, expires_at, consumed_at, revoked_at")
    .eq("token_hash", hashLinkToken(token))
    .maybeSingle();
  if (!row || row.consumed_at || row.revoked_at) return INVALID_LINK;
  if (new Date(row.expires_at as string).getTime() <= now.getTime()) return INVALID_LINK;

  const { data: user } = await admin.auth.admin.getUserById(row.user_id as string);
  const email = user?.user?.email ?? null;
  if (!email) return INVALID_LINK;
  // Re-checked at spend time, not only at issue: a person made a driver, or removed, in the hour the
  // link was live has no office password left for it to set.
  const target = await resetTargetForEmail(admin, email);
  if (!target || target.userId !== row.user_id) return INVALID_LINK;

  return {
    id: row.id as string,
    orgId: row.org_id as string,
    userId: row.user_id as string,
    email,
    expiresAt: row.expires_at as string,
  };
}

/**
 * Spend the link: claim it, set the password, sign the person out everywhere, tell them.
 *
 * ⚠ THE ORDER IS THE POINT. The claim is one conditional UPDATE (D-PWR3) and happens BEFORE the
 * password is set, so two submits cannot both set one. If GoTrue then refuses the password — its own
 * policy is allowed to be stricter than ours — the claim is released, so the person can choose a
 * better one with the same link instead of being sent back to ask for another. Only a password that
 * was actually set leaves the link spent.
 */
export async function redeemReset(
  admin: SupabaseClient,
  env: Env,
  args: { token: string; password: string; now: Date },
): Promise<{ email: string } | ResetError> {
  const found = await resolveReset(admin, args.token, args.now);
  if (isResetError(found)) return found;

  const problem = passwordProblem(args.password, found.email);
  if (problem) return { code: "weak_password", status: 422, message: problem };

  const nowIso = args.now.toISOString();
  const { data: claimed } = await admin
    .from("password_resets")
    .update({ consumed_at: nowIso })
    .eq("id", found.id)
    .is("consumed_at", null)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .select("id");
  if ((claimed ?? []).length !== 1) return INVALID_LINK;

  const updated = await admin.auth.admin.updateUserById(found.userId, { password: args.password });
  if (updated.error) {
    await admin.from("password_resets").update({ consumed_at: null }).eq("id", found.id).eq("consumed_at", nowIso);
    if (updated.error.code === "weak_password" || updated.error.code === "same_password") {
      // GoTrue's policy is the project's, not ours to restate; its message is written for the person
      // typing, which is why it is the one upstream text passed through (`ensureLoginForInvite`).
      return { code: "weak_password", status: 422, message: updated.error.message };
    }
    console.error(`[password-reset] updateUserById failed: ${updated.error.message}`);
    return { code: "reset_failed", status: 500, message: "We couldn't change your password. Try again in a moment." };
  }

  // D-PWR6. A failure here does not undo the reset — the password IS changed — but it is loud, and
  // the audit row records that the sign-out did not happen rather than implying it did.
  const { data: ended, error: sessErr } = await admin.rpc("revoke_user_sessions", { p_user_id: found.userId });
  if (sessErr) console.error(`[password-reset] revoke_user_sessions failed: ${sessErr.message}`);

  let noticeSent = false;
  if (env.MAIL_PROVIDER !== "none") {
    const mail = renderPasswordChangedEmail(`${env.WEB_APP_URL}/login`);
    noticeSent = await makeSender(env)({ to: [found.email], subject: mail.subject, html: mail.html, text: mail.text });
  }

  await writeAudit(admin, {
    orgId: found.orgId,
    actorId: found.userId,
    action: "auth.password_reset_completed",
    entity: "users",
    entityId: found.userId,
    meta: { sessionsEnded: sessErr ? null : ((ended as number | null) ?? 0), noticeSent },
  });
  return { email: found.email };
}
