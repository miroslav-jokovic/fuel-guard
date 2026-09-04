import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@silvicom/shared";
import { isEmailDomainAllowed } from "@silvicom/shared";
import { hashLinkToken } from "../../lib/linkToken.js";
import { findAuthUserIdByEmail } from "../../lib/supabaseAdmin.js";
import { writeAudit } from "../../lib/audit.js";
import type { Env } from "../../env.js";

/**
 * What happens between "somebody holds an invitation link" and "they are a member".
 *
 * Two routes share this: the public redemption (`routes/publicInvites.ts`), where the LINK is the
 * proof, and the older authenticated acceptance (`POST /api/invites/accept`), where a confirmed
 * GoTrue session is. Both end in the same act — a membership, a driver link if the invitation
 * carried one, a name, the row marked accepted, an audit row — and that act lives here once.
 */

export interface LiveInvite {
  id: string;
  org_id: string;
  email: string;
  role: UserRole;
  full_name: string | null;
  expires_at: string | null;
}

export interface InviteOrg {
  name: string;
  allowed_domains: string[];
}

export type RedemptionError = { code: string; message: string; status: number };
export const isRedemptionError = (v: object): v is RedemptionError => "status" in v;

const INVALID_LINK: RedemptionError = {
  code: "invalid_link",
  status: 404,
  message: "This invitation link is no longer valid. Ask your administrator to send a new one.",
};

const LIVE_INVITE_COLS = "id, org_id, email, role, status, full_name, expires_at";

/**
 * The invitation a link points at, if it is still worth anything.
 *
 * Expired, revoked, accepted, never existed — one answer for all four, `invalid_link`, for the
 * reason `publicApplication.ts` gives: a different refusal for each would tell an anonymous caller
 * that a token EXISTED. The invitation's own `expires_at` is the only expiry in play; there is no
 * second clock in GoTrue any more.
 */
export async function resolveInviteByToken(
  admin: SupabaseClient,
  token: string,
  now: Date,
): Promise<{ invite: LiveInvite; org: InviteOrg } | RedemptionError> {
  const { data: row } = await admin
    .from("invites")
    .select(LIVE_INVITE_COLS)
    .eq("token", hashLinkToken(token))
    .maybeSingle();
  if (!row || row.status !== "pending") return INVALID_LINK;
  if (row.expires_at && new Date(row.expires_at as string).getTime() <= now.getTime()) return INVALID_LINK;

  const { data: org } = await admin
    .from("organizations")
    .select("name, allowed_domains")
    .eq("id", row.org_id)
    .maybeSingle();
  if (!org) return INVALID_LINK;

  const invite: LiveInvite = {
    id: row.id as string,
    org_id: row.org_id as string,
    email: row.email as string,
    role: row.role as UserRole,
    full_name: (row.full_name as string | null) ?? null,
    expires_at: (row.expires_at as string | null) ?? null,
  };
  return {
    invite,
    org: { name: (org.name as string) ?? "Silvicom 360", allowed_domains: (org.allowed_domains ?? []) as string[] },
  };
}

/**
 * The login that will hold the membership: created now with the password the person chose, or —
 * when GoTrue already has this address — that account, with its password set to what they chose.
 *
 * The second case is not exotic. Every invitation sent before 2026-09-04 created the auth user up
 * front (that is what `generateLink` did), so an address invited under the old flow and never
 * finished is exactly this. So is a former member invited back. Possession of the emailed link is
 * the proof of ownership in both cases, the same proof a password-reset email would be.
 *
 * `email_confirm: true` on both paths: the address just proved itself by presenting what was sent
 * to it, and an unconfirmed account cannot sign in with the password it was given.
 */
export async function ensureLoginForInvite(
  admin: SupabaseClient,
  env: Env,
  email: string,
  password: string,
): Promise<{ userId: string } | RedemptionError> {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!created.error && created.data?.user?.id) return { userId: created.data.user.id };

  const code = created.error?.code ?? "";
  if (code === "weak_password" || code === "validation_failed") {
    // GoTrue's password policy is the project's, not ours to restate. Its message is written for
    // the person typing the password, which is why this is the one upstream text passed through.
    return { code: "weak_password", status: 422, message: created.error?.message ?? "Choose a stronger password." };
  }
  if (code !== "email_exists") {
    console.error(`[invites] createUser failed for ${email}: ${created.error?.message ?? "unknown"}`);
    return { code: "login_failed", status: 500, message: "We couldn't set up your login. Try again in a moment." };
  }

  const userId = await findAuthUserIdByEmail(env, email);
  if (!userId) {
    console.error(`[invites] GoTrue reports ${email} exists but the lookup found nobody`);
    return { code: "login_failed", status: 500, message: "We couldn't set up your login. Try again in a moment." };
  }
  const updated = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
  if (updated.error) {
    if (updated.error.code === "weak_password") {
      return { code: "weak_password", status: 422, message: updated.error.message };
    }
    console.error(`[invites] updateUserById failed for ${email}: ${updated.error.message}`);
    return { code: "login_failed", status: 500, message: "We couldn't set up your login. Try again in a moment." };
  }
  return { userId };
}

/**
 * Admit the person: membership, name, row accepted, audit — in that order, and the order is the
 * point. The name is written AFTER the membership so a failure there cannot leave a person named
 * but not admitted (0301, D-MEM1), and only when somebody said one: what they typed, else what the
 * admin typed on the invitation, else nothing.
 *
 * An invitation binds no roster driver. It did until 2026-09-04 (`invites.driver_id`, 0102), and
 * that path was retired with the emailed driver enrollment it served: a driver's login is a
 * username + password issued by the roster module (DRIVER-CREDENTIALS-PLAN.md DC9), which is also
 * the module that owns `drivers` — an org-module write into it was the gate's objection, and the
 * right answer was that the write should not exist.
 */
export async function admitInvitedUser(
  admin: SupabaseClient,
  args: { invite: LiveInvite; org: InviteOrg; userId: string; email: string; typedName: string | null },
): Promise<{ orgId: string; role: UserRole } | RedemptionError> {
  const { invite, org, userId, email, typedName } = args;
  if (!isEmailDomainAllowed(email, org.allowed_domains)) {
    return { code: "domain_not_allowed", status: 422, message: "Email domain not allowed" };
  }

  const { error: mErr } = await admin
    .from("memberships")
    .upsert({ org_id: invite.org_id, user_id: userId, role: invite.role }, { onConflict: "org_id,user_id" });
  if (mErr) return { code: "db_error", status: 500, message: "Could not create membership" };

  const name = typedName ?? invite.full_name ?? null;
  if (name) {
    const { error: nameErr } = await admin.from("user_profiles").upsert(
      { user_id: userId, full_name: name, updated_at: new Date().toISOString(), updated_by: userId },
      { onConflict: "user_id" },
    );
    if (nameErr) console.error(`[invites] profile not written for ${userId}: ${nameErr.message}`);
  }

  await admin.from("invites").update({ status: "accepted" }).eq("id", invite.id).eq("org_id", invite.org_id);
  await writeAudit(admin, {
    orgId: invite.org_id,
    actorId: userId,
    action: "invite.accepted",
    entity: "memberships",
    meta: { email },
  });
  return { orgId: invite.org_id, role: invite.role };
}
