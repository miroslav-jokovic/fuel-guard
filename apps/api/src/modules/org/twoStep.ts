import { createHmac, hkdfSync, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TWO_STEP_CODE_LENGTH,
  TWO_STEP_CODE_MINUTES,
  TWO_STEP_MAX_ATTEMPTS,
  TWO_STEP_MAX_PER_HOUR,
  TWO_STEP_RESEND_SECONDS,
  renderTwoStepCodeEmail,
  type TwoStepSend,
} from "@silvicom/shared";
import { decodeSecretsKey, SecretBoxError } from "../../lib/secretBox.js";
import { makeSender } from "../../lib/mailer.js";
import { writeAudit } from "../../lib/audit.js";
import type { Env } from "../../env.js";

/**
 * Two-step sign-in by an emailed code (INSTALLED-APP-PLAN IA-S1 rev 2, Q-IA20; migration 0662). Sending a code
 * and entering it. The database functions hold the budget, the one-live-code rule and the attempt count under a
 * per-person lock; this file makes the code, keys its hash and moves the email.
 *
 * ── THE HASH IS AN HMAC, KEYED OUTSIDE THE DATABASE ──────────────────────────────────────────────────────────
 * A six-digit code has a million values, so a plain SHA-256 of it — what the alert-phone code uses
 * (`alertContacts.ts`) — is reversed by trying them all in well under a second by whoever holds a copy of the
 * table. Keyed by an HKDF subkey of SECRETS_ENCRYPTION_KEY (label "two-step-code", beside the step-up token's
 * "step-up-token"), a copy of `two_step_codes` alone yields nothing. Bound to person, company and device as well,
 * so a hash copied into another row matches nothing. A deploy WITHOUT the key cannot send codes and says so (503)
 * instead of sending one it could not check: the same key step-up already needs, which `/api/version` reports
 * as `stepUp` (`stepUpMissing`), so a host missing it is already a failed deploy check.
 */

function subkey(env: Env): Buffer | null {
  try {
    return Buffer.from(hkdfSync("sha256", decodeSecretsKey(env), Buffer.alloc(0), "two-step-code", 32));
  } catch (e) {
    if (e instanceof SecretBoxError) return null;
    throw e;
  }
}

export const hashTwoStepCode = (key: Buffer, who: TwoStepWho, code: string): string =>
  createHmac("sha256", key).update(`v1:${who.orgId}:${who.userId}:${who.deviceKey ?? `session:${who.sessionId ?? "-"}`}:${code}`).digest("hex");

const makeCode = (): string => String(randomInt(0, 10 ** TWO_STEP_CODE_LENGTH)).padStart(TWO_STEP_CODE_LENGTH, "0");

export interface TwoStepWho {
  orgId: string;
  userId: string;
  sessionId: string | null;
  /** The app's device key, already through `deviceKeyClaim` — null when none was usable. */
  deviceKey: string | null;
}

export type TwoStepRefusal = { status: number; code: string; message: string };
export const isTwoStepRefusal = (v: object): v is TwoStepRefusal => "status" in v;

const UNAVAILABLE: TwoStepRefusal = { status: 503, code: "two_step_unavailable", message: "Sign-in codes can't be sent right now. Try again in a few minutes." };

interface IssueRow {
  outcome: "issued" | "recent" | "throttled" | "no_device";
  code_id: string | null;
  expires_at: string | null;
}

/**
 * Send a code to the person's sign-in address, or say why not. A code whose email the provider refused is
 * revoked at once: nobody holds it, and a live row would read as "sent" (the password reset's rule, 0363).
 */
export async function sendTwoStepCode(
  admin: SupabaseClient,
  env: Env,
  args: { who: TwoStepWho; email: string | null },
): Promise<TwoStepSend | TwoStepRefusal> {
  const { who, email } = args;
  const key = subkey(env);
  if (!key || env.MAIL_PROVIDER === "none") return UNAVAILABLE;
  if (!email) return { status: 409, code: "no_email", message: "Your account has no email address to send a code to. Ask your administrator." };

  const code = makeCode();
  const { data, error } = await admin.rpc("two_step_code_issue", {
    p_org: who.orgId,
    p_user: who.userId,
    p_session: who.sessionId,
    p_device_key: who.deviceKey,
    p_code_hash: hashTwoStepCode(key, who, code),
    p_ttl_minutes: TWO_STEP_CODE_MINUTES,
    p_max_per_hour: TWO_STEP_MAX_PER_HOUR,
    p_resend_seconds: TWO_STEP_RESEND_SECONDS,
  });
  if (error) {
    console.error(`[two-step] two_step_code_issue failed: ${error.message}`);
    return UNAVAILABLE;
  }
  const row = ((data ?? []) as IssueRow[])[0];
  if (!row || row.outcome === "no_device") return { status: 409, code: "no_device", message: "This browser could not be identified. Reload the page and try again." };
  if (row.outcome === "throttled") {
    return { status: 429, code: "too_many_codes", message: `${TWO_STEP_MAX_PER_HOUR} codes were sent in the last hour. Wait a while, then ask for a new one.` };
  }
  if (row.outcome === "recent") return { outcome: "recent", expires_at: row.expires_at! };

  const mail = renderTwoStepCodeEmail(code);
  const sent = await makeSender(env)({ to: [email], subject: mail.subject, html: mail.html, text: mail.text });
  if (!sent) {
    await admin.rpc("two_step_code_revoke", { p_org: who.orgId, p_user: who.userId, p_code: row.code_id });
    console.error(`[two-step] the code email to ${who.userId} was refused by the mail provider`);
    return { status: 502, code: "send_failed", message: "The email with your code could not be sent. Try again in a minute." };
  }
  await writeAudit(admin, {
    orgId: who.orgId,
    actorId: who.userId,
    action: "auth.two_step_code_sent",
    entity: "users",
    entityId: who.userId,
    meta: { expiresAt: row.expires_at },
  });
  return { outcome: "sent", expires_at: row.expires_at! };
}

/** What `two_step_code_verify` (0662) answers. */
export type TwoStepVerdict = "ok" | "wrong" | "too_many" | "expired";

const VERDICT_REFUSAL: Record<Exclude<TwoStepVerdict, "ok">, TwoStepRefusal> = {
  wrong: { status: 422, code: "wrong_code", message: "That code is not right. Check the latest email and try again." },
  too_many: { status: 422, code: "too_many_attempts", message: "Too many wrong codes. Send a new code and use that one." },
  expired: { status: 422, code: "code_expired", message: "That code has expired or was replaced. Send a new code." },
};

/**
 * Enter a code. The right one trusts this device for the week (0662 writes `two_step_devices`). Audited on the two
 * outcomes worth a question later: passed, and a code killed by wrong entries — the latter is what a guessing
 * attacker looks like.
 */
export async function verifyTwoStepCode(
  admin: SupabaseClient,
  env: Env,
  args: { who: TwoStepWho; code: string },
): Promise<{ ok: true } | TwoStepRefusal> {
  const { who, code } = args;
  const key = subkey(env);
  if (!key) return UNAVAILABLE;
  const { data, error } = await admin.rpc("two_step_code_verify", {
    p_org: who.orgId,
    p_user: who.userId,
    p_session: who.sessionId,
    p_device_key: who.deviceKey,
    p_code_hash: hashTwoStepCode(key, who, code),
    p_max_attempts: TWO_STEP_MAX_ATTEMPTS,
  });
  if (error) {
    console.error(`[two-step] two_step_code_verify failed: ${error.message}`);
    return UNAVAILABLE;
  }
  const verdict = data as TwoStepVerdict;
  if (verdict === "ok" || verdict === "too_many") {
    await writeAudit(admin, {
      orgId: who.orgId,
      actorId: who.userId,
      action: verdict === "ok" ? "auth.two_step_passed" : "auth.two_step_code_exhausted",
      entity: "users",
      entityId: who.userId,
      meta: {},
    });
  }
  if (verdict === "ok") return { ok: true };
  return VERDICT_REFUSAL[verdict] ?? VERDICT_REFUSAL.expired;
}
