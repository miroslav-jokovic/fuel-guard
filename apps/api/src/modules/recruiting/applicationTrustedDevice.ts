import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TRUSTED_DEVICE_MAX, TRUSTED_DEVICE_TTL_DAYS, type TrustedDeviceEarnedBy } from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";

/**
 * A device the applicant asked to be remembered (APPLICATION-FIX-PLAN.md U2; 0604).
 *
 * ── WHAT MAKES ONE ────────────────────────────────────────────────────────────────────────────
 * A RIGHT answer and the applicant's own request, together: `unlockDraft` on a matching date of birth,
 * `unlockWithCode` on a right code — each only when the page sent `remember_device`. Nothing else
 * mints. In particular an unlock on a link with nothing gated yet mints nothing: a token handed out
 * before a date of birth exists would open the application once one does.
 *
 * ── WHAT ONE OPENS ────────────────────────────────────────────────────────────────────────────
 * The same release the date of birth gives, on the same invitation, and only on a link that resolves
 * (`unlockWithDevice`, in `applicationDraft.ts`, beside the two other ways in). The hash is salted by
 * the invitation, so a token from one application is not a token on another.
 *
 * ── FAILING SOFT ──────────────────────────────────────────────────────────────────────────────
 * Remembering is a convenience on top of an unlock that already succeeded. If the row cannot be
 * written — the table not there yet in a deploy window, the cap reached — the unlock still answers,
 * with no token, and the next visit asks the date of birth as it always did. It never fails an unlock.
 *
 * ⚠ Every query org-filters itself: the service role bypasses RLS, and 0604's table has no policies.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const hashDeviceToken = (invitationId: string, token: string): string =>
  createHash("sha256").update(`${invitationId}:device:${token}`).digest("hex");

/** 32 bytes from the CSPRNG, base64url — `DEVICE_TOKEN_PATTERN`'s 43 characters. */
export const mintDeviceToken = (): string => randomBytes(32).toString("base64url");

interface DeviceRow {
  id: string;
  token_hash: string;
  expires_at: string;
}

// ⚠ Expiries compared as instants, never as text (PostgREST serves `…+00:00`; see `unlockWithCode`).
const live = (row: DeviceRow, now: Date): boolean => Date.parse(row.expires_at) > now.getTime();

async function devicesOf(admin: SupabaseClient, orgId: string, invitationId: string): Promise<DeviceRow[] | null> {
  const { data, error } = await admin
    .from("application_trusted_devices")
    .select("id, token_hash, expires_at")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId);
  return error ? null : ((data ?? []) as DeviceRow[]);
}

/**
 * Remember the device that just gave a right answer. Answers the token to hand it, or null when
 * nothing was remembered (see "failing soft"). `mint` is injectable for tests.
 */
export async function rememberDevice(
  admin: SupabaseClient,
  invitation: { id: string; org_id: string; driver_id: string },
  earnedBy: TrustedDeviceEarnedBy,
  now: Date,
  mint: () => string = mintDeviceToken,
): Promise<string | null> {
  const held = await devicesOf(admin, invitation.org_id, invitation.id);
  if (!held || held.filter((d) => live(d, now)).length >= TRUSTED_DEVICE_MAX) return null;

  const token = mint();
  const { error } = await admin.from("application_trusted_devices").insert({
    org_id: invitation.org_id,
    invitation_id: invitation.id,
    token_hash: hashDeviceToken(invitation.id, token),
    earned_by: earnedBy,
    expires_at: new Date(now.getTime() + TRUSTED_DEVICE_TTL_DAYS * DAY_MS).toISOString(),
    created_at: now.toISOString(),
  });
  if (error) return null;

  await writeAudit(admin, {
    orgId: invitation.org_id,
    actorId: null,
    action: "compliance.device_remembered",
    entity: "application_invitations",
    entityId: invitation.id,
    // How it was earned and whose application — never the token.
    meta: { driverId: invitation.driver_id, earnedBy },
  });
  return token;
}

const sameHash = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Is this token one of the invitation's live devices? Stamps the visit when it is. */
export async function deviceIsRemembered(
  admin: SupabaseClient,
  invitation: { id: string; org_id: string },
  token: string,
  now: Date,
): Promise<boolean> {
  const held = await devicesOf(admin, invitation.org_id, invitation.id);
  const hash = hashDeviceToken(invitation.id, token);
  const found = (held ?? []).find((d) => live(d, now) && sameHash(d.token_hash, hash));
  if (!found) return false;
  // Best effort: the stamp says when the device last opened the application, and gates nothing.
  await admin
    .from("application_trusted_devices")
    .update({ last_used_at: now.toISOString() })
    .eq("org_id", invitation.org_id)
    .eq("id", found.id);
  return true;
}
