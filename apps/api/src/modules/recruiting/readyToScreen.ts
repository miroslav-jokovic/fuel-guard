import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { sendEmail } from "../../lib/mailer.js";
import { notify } from "../messaging/index.js";
import { usersWhoManage } from "../org/index.js";

/**
 * "Part 1 is finished — screen this person" (APPLICATION-FLOW-V2-PLAN Q-AW56; category from 0499).
 *
 * ── WHY THIS EXISTS (production, 2026-10-20) ──────────────────────────────────────────────────
 * Two of four applicants finished consent, Part 1, the documents and all six permissions on 10-01.
 * Nothing told anybody. Zero were screened; both links expired on 10-14 and 10-15 waiting on the
 * office. The module's only office-facing alert was `application_stalled`, which the nudge sweep
 * emits for an applicant who STOPPED — and the plan rules, rightly, that waiting on the office is not
 * abandonment (A10). So the one moment the process hands the baton to the office was the one moment
 * the office was not told.
 *
 * ── WHEN, AND WHY NOT EARLIER ─────────────────────────────────────────────────────────────────
 * Once per invitation, when the LAST permission lands (`record_driver_release` stamps
 * `releases_completed_at`; `recordRelease` answers `completed: true`). Not at `intake_completed_at`:
 * Part 1 alone authorises nothing — the MVR and PSP are pulled on the strength of the signatures
 * (`SCREENING_PREREQUISITES`), the two stamps are minutes apart in the same sitting, and a notice
 * the office could not act on is a notice that trains the office to ignore the next one.
 *
 * ── TO WHOM ───────────────────────────────────────────────────────────────────────────────────
 * The members who MANAGE the recruitment section (`usersWhoManage`, derived from the section matrix,
 * never a typed role list), each through `notify()` so the per-user mutes, quiet hours and the dedupe
 * key apply; and the org's `notification_emails`, one email, the same way the DQ scheduler reaches an
 * office that does not open the bell. The SAME dedupe key goes to every recipient (0432's ledger is
 * per user), so a retried request or a double-submitted last signature tells each person once.
 *
 * ⚠ Never throws into the route: the signature is already filed, and a notice that cannot be sent is
 * logged, not a 500 to an applicant who did everything right. ⚠ Every read org-filters itself: the
 * service role bypasses RLS.
 */

/** The email, in the office's words. Pure. */
export function readyToScreenEmail(
  driverName: string,
  boardLink: string,
): { subject: string; text: string; html: string } {
  const subject = `${driverName} is ready to screen`;
  const text = [
    `${driverName} has finished the first part of their driver application and signed every permission.`,
    "",
    "The next move is the office's: order the driving record and the PSP report, and arrange the drug test.",
    "",
    `Open the applicants board: ${boardLink}`,
  ].join("\n");
  const html = [
    `<p>${escapeHtml(driverName)} has finished the first part of their driver application and signed every permission.</p>`,
    "<p>The next move is the office's: order the driving record and the PSP report, and arrange the drug test.</p>",
    `<p><a href="${boardLink}">Open the applicants board</a></p>`,
  ].join("\n");
  return { subject, text, html };
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The board, opened on its "Ready to screen" view — the filter lives in the URL (D-US2), so the link
 * IS the queue. The web's `notificationRoute` sends the bell's copy to the same place.
 */
export const readyToScreenLink = (env: Env): string => `${env.WEB_APP_URL}/recruitment?waiting=screen`;

export interface ReadyToScreenResult {
  notified: number;
  emailed: boolean;
}

export async function announceReadyToScreen(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  invitationId: string,
  driverId: string,
): Promise<ReadyToScreenResult> {
  try {
    const { data: driver } = await admin
      .from("drivers")
      .select("full_name")
      .eq("org_id", orgId)
      .eq("id", driverId)
      .maybeSingle();
    const driverName = (driver as { full_name?: string } | null)?.full_name ?? "An applicant";

    const { data: org } = await admin
      .from("organizations")
      .select("notifications_enabled, notification_emails")
      .eq("id", orgId)
      .maybeSingle();
    const row = org as { notifications_enabled?: boolean; notification_emails?: string[] | null } | null;
    if (row?.notifications_enabled === false) return { notified: 0, emailed: false };

    let notified = 0;
    for (const userId of await usersWhoManage(admin, orgId, "recruitment")) {
      const id = await notify(admin, {
        orgId,
        userId,
        category: "application_ready_to_screen",
        title: `${driverName} is ready to screen`,
        body: "Part 1 and every permission are in. Order the driving record and the PSP report.",
        severity: "info",
        entityType: "driver",
        entityId: driverId,
        dedupeKey: `application_ready_to_screen:${invitationId}`,
      });
      if (id) notified += 1;
    }

    const emails = (row?.notification_emails ?? []).filter(Boolean);
    if (emails.length === 0) return { notified, emailed: false };
    const sent = await sendEmail(env, { to: emails, ...readyToScreenEmail(driverName, readyToScreenLink(env)) });
    return { notified, emailed: sent.ok };
  } catch (e) {
    console.error(`[ready-to-screen] org ${orgId} invitation ${invitationId}: could not tell the office —`, e instanceof Error ? e.message : e);
    return { notified: 0, emailed: false };
  }
}
