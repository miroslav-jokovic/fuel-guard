import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICATION_SECTION_LABELS,
  planApplicationNudges,
  type NudgeCandidate,
  type NudgePart,
  type PlannedNudge,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { sendEmail } from "../../lib/mailer.js";
import { fetchAllPaged } from "../../lib/paging.js";
import { notify } from "../messaging/index.js";
import { mintInvitationToken } from "./applicationIntake.js";
import { sendOrQueueSms } from "./smsOutbox.js";
import { recruitingSettings } from "./recruitingSettings.js";

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
 * The last sentence, per part. Part 2's reminder is the last one the invitation can get; Part 1's is
 * not — a driver reminded now may be reminded once more, about the form, weeks later (Q-AW37 (b)) —
 * so Part 1's promise is narrower, and true.
 */
const NO_MORE: Record<NudgePart, string> = {
  part_one: "we will not remind you about this step again.",
  part_two: "we will not send another reminder.",
};

/**
 * The email itself.
 *
 * Written to a person who is doing the carrier a favour by applying at all: what is saved, where they
 * stopped, one link, and the one caveat that matters — the older email's link is dead now. No
 * deadline, no chasing, and no second reminder about the same step, because there will not be one.
 */
export function nudgeEmail(
  carrier: string,
  link: string,
  sectionLabel: string | null,
  part: NudgePart = "part_two",
): { subject: string; text: string; html: string } {
  const where = sectionLabel ? ` You had reached "${sectionLabel}".` : "";
  const subject = `Your ${carrier} application is saved`;
  const text =
    `You started an application for ${carrier} and it is still saved.${where}\n\n`
    + `Pick up where you left off: ${link}\n\n`
    + "This link replaces the one in the earlier email, which no longer works. "
    + `If you would rather not continue, you can ignore this — ${NO_MORE[part]}`;
  const html = [
    `<p>You started an application for ${escapeHtml(carrier)} and it is still saved.`,
    sectionLabel ? ` You had reached &quot;${escapeHtml(sectionLabel)}&quot;.` : "",
    "</p>",
    `<p><a href="${escapeHtml(link)}">Pick up where you left off</a></p>`,
    "<p>This link replaces the one in the earlier email, which no longer works. If you would rather "
    + `not continue, you can ignore this — ${NO_MORE[part]}</p>`,
  ].join("");
  return { subject, text, html };
}

/**
 * The column list, named rather than inlined — the same shape `applicantChecklist.ts` uses, and for
 * the same reason: supabase-js derives the row type from the STRING LITERAL, so a list broken across
 * two concatenated lines to fit the margin types as `GenericStringError[]` and the cast below stops
 * compiling. One `const` keeps the literal and the margin both.
 */
const CANDIDATE_COLS =
  "id, driver_id, email, expires_at, revoked_at, submitted_at, nudged_at, review_requested_at, approved_at, application_sent_at, consented_at, releases_completed_at";

/**
 * Part 1's writes outside the draft — the intake row, the photographs, the signed permissions — as one
 * latest instant per invitation (C3c3b). Read for EVERY candidate, not only the ones that look like
 * Part 1: a narrower read than the fold's own test would hand it a null for a driver active yesterday,
 * and a null reads as "nothing written", which is a reminder sent to somebody mid-way through.
 *
 * Paged (PostgREST caps a response at 1,000 rows), and each select a literal of its own, for the
 * reason `CANDIDATE_COLS` gives — and no aliases, because `supabaseRecorder` hands back whole rows,
 * so an alias would be the one thing about this read its tests could not see.
 */
async function partOneActivity(
  admin: SupabaseClient,
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const [intakes, captures, permissions] = await Promise.all([
    fetchAllPaged<{ invitation_id: string; updated_at: string }>((from, to) =>
      admin.from("application_intakes").select("invitation_id, updated_at")
        .eq("org_id", orgId).in("invitation_id", ids).order("id").range(from, to)),
    fetchAllPaged<{ invitation_id: string; captured_at: string }>((from, to) =>
      admin.from("application_captures").select("invitation_id, captured_at")
        .eq("org_id", orgId).in("invitation_id", ids).order("id").range(from, to)),
    fetchAllPaged<{ invitation_id: string | null; created_at: string }>((from, to) =>
      admin.from("driver_authorizations").select("invitation_id, created_at")
        .eq("org_id", orgId).in("invitation_id", ids).order("id").range(from, to)),
  ]);
  const out = new Map<string, string>();
  const stamps = [
    ...intakes.map((r) => [r.invitation_id, r.updated_at] as const),
    ...captures.map((r) => [r.invitation_id, r.captured_at] as const),
    ...permissions.map((r) => [r.invitation_id, r.created_at] as const),
  ];
  for (const [id, at] of stamps) {
    if (!id || !at) continue;
    const held = out.get(id);
    if (!held || Date.parse(at) > Date.parse(held)) out.set(id, at);
  }
  return out;
}

/**
 * Every live invitation for one org, joined to whatever draft it holds.
 *
 * ⚠ `review_requested_at` and `approved_at` are SELECTED here and excluded in the fold, not filtered
 * here (A1). The `.is(...)` filters below are about volume — there is no reason to drag submitted,
 * revoked and already-nudged invitations across the wire — whereas "waiting on the office is not
 * abandonment" is a rule about somebody's inbox, and `applicationNudge.ts`'s header argues at length
 * that every one of those lives in the pure fold where it can be read back and tested without a
 * database. A column selected but not filtered looks redundant; it is the fold's input.
 *
 * ⚠ `application_sent_at` too (AF4), and its absence would fail SILENT rather than loud: the fold
 * skips an unsent application, the row is cast rather than typed, and a column nobody selected reads
 * `undefined` — so every candidate would look unsent and the sweep would quietly nudge nobody, ever.
 * `consented_at` and `releases_completed_at` are Part 1's (C3c3b), and fail the same silent way.
 *
 * ⚠ `nudged_at` is NOT filtered here any more (Q-AW37 (b), 0377): a driver reminded in Part 1 is
 * still owed Part 2's reminder, and "is this part's reminder spent" compares two columns, which is
 * the fold's to decide.
 */
async function candidates(admin: SupabaseClient, orgId: string): Promise<NudgeCandidate[]> {
  const { data, error } = await admin
    .from("application_invitations")
    .select(CANDIDATE_COLS)
    // The service role bypasses RLS; every query on this path carries its own tenant scope.
    .eq("org_id", orgId)
    .is("submitted_at", null)
    .is("revoked_at", null);
  if (error) throw new Error(error.message);
  const invitations = (data ?? []) as Omit<NudgeCandidate, "draft_updated_at" | "furthest_section" | "part_one_activity_at">[];
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

  const activity = await partOneActivity(admin, orgId, invitations.map((i) => i.id));

  return invitations.map((i) => {
    const draft = byInvitation.get(i.id);
    return {
      ...i,
      draft_updated_at: draft?.updated_at ?? null,
      furthest_section: draft?.furthest_section ?? null,
      part_one_activity_at: activity.get(i.id) ?? null,
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
      title: nudge.part === "part_one"
        ? `${driverName} stopped before finishing getting started on their application`
        : `${driverName} stopped part-way through their application`,
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
  /** Texts that actually went out — none for an applicant who has not agreed on their waiting screen (SMS-OPT-IN-PLAN D-SMS1). */
  messaged: number;
}

/**
 * One org's sweep.
 *
 * ⚠ THE CARRIER'S REMINDER (Q-AW41). Its delay is the fold's `staleHours` — a driver counts as stalled
 * after the carrier's number of hours, for the office's alert and the driver's reminder alike. Switched
 * OFF, the driver is sent nothing and the link is not rotated or extended, but the office is still told:
 * the switch is about pestering the applicant, and "this person stopped" is the office's cue to call.
 * That is exactly the no-address path below, so an unstamped, alerted-once invitation is a state the
 * sweep already knew how to hold.
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
  const settings = await recruitingSettings(admin, orgId);
  const planned = planApplicationNudges(await candidates(admin, orgId), now.toISOString(), settings.reminder_after_hours);
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
    if (!nudge.email || !env.APPLICATION_NUDGE_ENABLED || !settings.reminders_enabled) continue;

    // Rotate FIRST — see the header. `false` means the driver submitted, revoked or expired between
    // the read and here, and the correct response is to leave them alone.
    const { token, hash } = mintInvitationToken();
    const { data: rotated, error } = await admin.rpc("nudge_application_invitation", {
      p_org: orgId,
      p_invitation: nudge.invitationId,
      p_token_hash: hash,
      p_extend_days: settings.invite_ttl_days,
    });
    if (error || rotated !== true) continue;

    const label = nudge.furthestSection ? APPLICATION_SECTION_LABELS[nudge.furthestSection] : null;
    const link = applyLink(env, token);

    /**
     * A11b: a text FIRST when the driver agreed to one, and the email regardless.
     *
     * Not either/or: every gate that could refuse the text — no consent, draft wording, an opt-out —
     * leaves the email untouched, so a refusal is never a driver hearing nothing. Through the outbox
     * since Q-AW29: after hours it waits for the driver's morning rather than being dropped, and its link
     * is minted when it goes, on the invitation's TEXT token (0378) — never `link` above, which the email
     * carries and which a later rotation of the text's token leaves alone.
     */
    const texted = await sendOrQueueSms(admin, env, {
      orgId, driverId: nudge.driverId, invitationId: nudge.invitationId, template: "nudge", params: {},
    }, now);
    if (texted.sent) messaged += 1;

    const { subject, text, html } = nudgeEmail(carrier, link, label, nudge.part);
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
