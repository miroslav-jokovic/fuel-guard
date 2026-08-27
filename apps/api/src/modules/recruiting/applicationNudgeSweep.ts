import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICATION_SECTION_LABELS,
  INVITE_TTL_DAYS_DEFAULT,
  planApplicationNudges,
  type NudgeCandidate,
  type PlannedNudge,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { sendEmail } from "../../lib/mailer.js";
import { notify } from "../messaging/index.js";
import { mintInvitationToken } from "./applicationIntake.js";
import { sendApplicationSms } from "./applicationSms.js";

/**
 * The abandonment sweep (A10, D-APP15) — one email to a driver who walked away, and one alert to the
 * office.
 *
 * ── ⚠ IT ROTATES THE TOKEN, BECAUSE THERE IS NO LINK TO RE-SEND ───────────────────────────────
 * The plan asks for "here is your link back". The plaintext token was never stored — 0220 keeps a
 * SHA-256 and nothing else — so the only way to put a working link in an email is to mint a new token
 * and rotate the invitation's hash to match. Same invitation row, so the draft, the phase stamps and
 * any signed releases all survive; the driver's ORIGINAL email stops working, and the copy says so.
 * 0232's header carries the full argument, including why sealing a copy of the token was rejected.
 *
 * ── THE ORDER OF OPERATIONS, AND WHY IT IS THIS WAY ROUND ─────────────────────────────────────
 * Rotate first, then send. The reverse — send, then rotate — would email a link that does not work
 * yet, and any failure between the two leaves the driver holding a dead link with no way back. This
 * way a failure after the rotation costs the driver an email they never got and the office an alert
 * that says they stalled, which is the state a human can act on. The stamp is inside the rotation
 * (0232), so a crash mid-sweep cannot produce a second attempt.
 */

/** The link the driver is sent back to — the same shape `applicationInvites.ts` mints at invite time. */
const applyLink = (env: Env, token: string): string => `${env.WEB_APP_URL}/apply/${token}`;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The email itself.
 *
 * Written to a person who is doing the carrier a favour by applying at all: what is saved, where they
 * stopped, one link, and the one caveat that matters — the older email's link is dead now. No
 * deadline, no chasing, and no second reminder, because there will not be one.
 */
export function nudgeEmail(
  carrier: string,
  link: string,
  sectionLabel: string | null,
): { subject: string; text: string; html: string } {
  const where = sectionLabel ? ` You had reached "${sectionLabel}".` : "";
  const subject = `Your ${carrier} application is saved`;
  const text =
    `You started an application for ${carrier} and it is still saved.${where}\n\n`
    + `Pick up where you left off: ${link}\n\n`
    + "This link replaces the one in the earlier email, which no longer works. "
    + "If you would rather not continue, you can ignore this — we will not send another reminder.";
  const html = [
    `<p>You started an application for ${escapeHtml(carrier)} and it is still saved.`,
    sectionLabel ? ` You had reached &quot;${escapeHtml(sectionLabel)}&quot;.` : "",
    "</p>",
    `<p><a href="${escapeHtml(link)}">Pick up where you left off</a></p>`,
    "<p>This link replaces the one in the earlier email, which no longer works. If you would rather "
    + "not continue, you can ignore this — we will not send another reminder.</p>",
  ].join("");
  return { subject, text, html };
}

/** Every live invitation for one org, joined to whatever draft it holds. */
async function candidates(admin: SupabaseClient, orgId: string): Promise<NudgeCandidate[]> {
  const { data, error } = await admin
    .from("application_invitations")
    .select("id, driver_id, email, expires_at, revoked_at, submitted_at, nudged_at")
    // The service role bypasses RLS; every query on this path carries its own tenant scope.
    .eq("org_id", orgId)
    .is("submitted_at", null)
    .is("revoked_at", null)
    .is("nudged_at", null);
  if (error) throw new Error(error.message);
  const invitations = (data ?? []) as Omit<NudgeCandidate, "draft_updated_at" | "furthest_section">[];
  if (invitations.length === 0) return [];

  const { data: drafts, error: draftError } = await admin
    .from("application_drafts")
    .select("invitation_id, updated_at, furthest_section")
    .eq("org_id", orgId)
    .in("invitation_id", invitations.map((i) => i.id));
  if (draftError) throw new Error(draftError.message);
  const byInvitation = new Map(
    ((drafts ?? []) as { invitation_id: string; updated_at: string; furthest_section: string | null }[])
      .map((d) => [d.invitation_id, d]),
  );

  return invitations.map((i) => {
    const draft = byInvitation.get(i.id);
    return {
      ...i,
      draft_updated_at: draft?.updated_at ?? null,
      furthest_section: draft?.furthest_section ?? null,
    };
  });
}

/** Tell the office, whether or not the driver could be emailed. */
async function alertOffice(
  admin: SupabaseClient,
  orgId: string,
  userIds: readonly string[],
  nudge: PlannedNudge,
  driverName: string,
): Promise<void> {
  for (const userId of userIds) {
    // `emit_notification` applies entitlement, mutes, quiet hours and the dedupe key — never insert a
    // notification row by hand. The SAME key goes to every recipient, so each office user gets one
    // row and the sweep can run every six hours in silence.
    await notify(admin, {
      orgId,
      userId,
      category: "application_stalled",
      title: `${driverName} stopped part-way through their application`,
      severity: "info",
      entityType: "driver",
      entityId: nudge.driverId,
      dedupeKey: nudge.dedupeKey,
    });
  }
}

export interface NudgeSweepResult {
  stalled: number;
  emailed: number;
  /** Texts that actually went out — always 0 until 10DLC registration completes (A11b, §6). */
  messaged: number;
}

/**
 * The text, in the 160 characters a segment gets.
 *
 * Carrier identification is not decoration: every US carrier's messaging rules require the sender to
 * be identifiable in the body, and `STOP` has to be discoverable from the message itself rather than
 * from a consent somebody signed weeks ago. What is left after those two is the link, so the copy says
 * the one thing the email says at length — this link is the live one — and nothing else.
 */
export const smsBody = (carrier: string, link: string): string =>
  `${carrier}: your driver application is saved. Finish it here: ${link} `
  + "(this replaces any earlier link). Reply STOP to opt out.";

/**
 * One org's sweep.
 *
 * ⚠ An invitation with no address still alerts the office and is NOT stamped. The office alert is the
 * cue to pick up the phone; stamping would spend the one nudge this invitation gets on an email that
 * was never sent, and leaving it unstamped costs nothing — the dedupe key means the office is told
 * once, and the candidate falls out of the fold by itself when the link expires.
 */
export async function runApplicationNudgesOnce(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  officeUserIds: readonly string[],
  now: Date,
): Promise<NudgeSweepResult> {
  const planned = planApplicationNudges(await candidates(admin, orgId), now.toISOString());
  if (planned.length === 0) return { stalled: 0, emailed: 0, messaged: 0 };

  const { data: org } = await admin
    .from("organizations")
    .select("name, notifications_enabled")
    .eq("id", orgId)
    .maybeSingle();
  const carrier = (org as { name?: string } | null)?.name ?? "the carrier";
  const notificationsOn = (org as { notifications_enabled?: boolean } | null)?.notifications_enabled !== false;

  let emailed = 0;
  let messaged = 0;
  for (const nudge of planned) {
    const { data: driver } = await admin
      .from("drivers")
      .select("full_name")
      .eq("org_id", orgId)
      .eq("id", nudge.driverId)
      .maybeSingle();
    const driverName = (driver as { full_name?: string } | null)?.full_name ?? "An applicant";

    if (notificationsOn) await alertOffice(admin, orgId, officeUserIds, nudge, driverName);
    if (!nudge.email || !env.APPLICATION_NUDGE_ENABLED) continue;

    // Rotate FIRST — see the header. `false` means the driver submitted, revoked or expired between
    // the read and here, and the correct response is to leave them alone.
    const { token, hash } = mintInvitationToken();
    const { data: rotated, error } = await admin.rpc("nudge_application_invitation", {
      p_org: orgId,
      p_invitation: nudge.invitationId,
      p_token_hash: hash,
      p_extend_days: INVITE_TTL_DAYS_DEFAULT,
    });
    if (error || rotated !== true) continue;

    const label = nudge.furthestSection ? APPLICATION_SECTION_LABELS[nudge.furthestSection] : null;
    const link = applyLink(env, token);

    /**
     * A11b: a text FIRST when the driver agreed to one, and the email regardless.
     *
     * Not either/or, and the reason is the rotation. The token has already changed by the time either
     * goes out, so a driver who consented to SMS and also has the original email would otherwise be
     * left with a dead link in their inbox and a live one they might not see. Both carry the same new
     * link, and every gate that could refuse the text — no consent, draft wording, quiet hours, an
     * opt-out — leaves the email untouched, so a refusal is never a driver hearing nothing.
     */
    const texted = await sendApplicationSms(admin, env, orgId, nudge.driverId, smsBody(carrier, link), now);
    if (texted.sent) messaged += 1;

    const { subject, text, html } = nudgeEmail(carrier, link, label);
    const sent = await sendEmail(env, { to: [nudge.email], subject, text, html });
    if (sent.ok) emailed += 1;
    else {
      // The token is already rotated and `nudged_at` is stamped, so this driver's older link is dead
      // and no second attempt will be made. Loud, because the office alert is now the only way they
      // hear about it — and because a mail provider refusing an applicant's address is worth knowing.
      console.error("[application-nudge] rotated but could not send", {
        invitationId: nudge.invitationId,
        detail: sent.detail,
      });
    }
  }
  return { stalled: planned.length, emailed, messaged };
}
