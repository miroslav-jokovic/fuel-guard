import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applicantVideosPath,
  canResendApplicationLink,
  renderOrientationVideosEmail,
  type ApplicantOrientationVideos,
  type ApplicantVideoPage,
  type OrientationVideoAttest,
  type OrientationVideosSent,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { isApplicationLinkError, resendOnInvitation } from "./applicationLink.js";
import { resolveInvitation, isIntakeError, type IntakeError, type SubmitContext } from "./applicationIntake.js";
import { carrierName } from "./applicationMail.js";
import { textOutcome } from "./applicationSendForSigning.js";
import { listOrientationVideos, type OrientationVideoError } from "./orientationVideos.js";
import { sendOrQueueSms } from "./smsOutbox.js";

/**
 * One applicant's orientation videos (HW8a, 0539): the office's view and its "Send the videos", and the
 * applicant's page — the list of links, a pressed link recorded, and the one tick "I watched these".
 *
 * ── THE SEND REUSES THE APPLICATION LINK (no new token scheme) ────────────────────────────────
 * The videos go out on the invitation's own link, `/apply/<token>/videos`, rotated exactly as "send the
 * link again" rotates it (`resendOnInvitation`): the email says the earlier link no longer works, the
 * text rides the invitation's TEXT token (0378) like every other text, and `orientation_videos_sent_at`
 * is stamped in the SAME conditional UPDATE as the new token — so "sent" never exists without a link
 * that works, and a revoke or a handbook filing racing the press is honoured, not overwritten.
 *
 * ── THE APPLICANT'S HALF RESOLVES THE TOKEN LIKE EVERY OTHER PAGE ON THE LINK ─────────────────
 * Any of the invitation's three doors opens it (`resolveInvitation`), and a dead link is the one neutral
 * `invalid_link` the rest of the surface answers. The tick's videos are checked against the carrier's
 * live list by 0539's trigger, which also snapshots them — never from the request.
 *
 * ⚠ Every office query org-filters itself: the service role bypasses RLS.
 */

type LiveInvitation = { id: string; driver_id: string; email: string | null; expires_at: string; revoked_at: string | null; handbook_filed_at: string | null; orientation_videos_sent_at: string | null };

/** The newest unrevoked invitation — `readLiveInvitation`'s rule — with what the send needs. */
async function liveInvitation(admin: SupabaseClient, orgId: string, driverId: string): Promise<LiveInvitation | null> {
  const { data } = await admin
    .from("application_invitations")
    .select("id, driver_id, email, expires_at, revoked_at, handbook_filed_at, orientation_videos_sent_at")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? []) as LiveInvitation[])[0] ?? null;
}

const NOT_FOUND: OrientationVideoError = { status: 404, code: "not_found", message: "That applicant is not in this organization." };

/** Which links they opened and which ticks covered what — newest tick first. */
async function driverEvidence(admin: SupabaseClient, orgId: string, driverId: string) {
  const [ticks, opens] = await Promise.all([
    admin
      .from("orientation_video_attestations")
      .select("video_ids, signer_name, attested_at")
      .eq("org_id", orgId)
      .eq("driver_id", driverId)
      .order("attested_at", { ascending: false }),
    admin
      .from("orientation_video_opens")
      .select("video_id, opened_at")
      .eq("org_id", orgId)
      .eq("driver_id", driverId)
      .order("opened_at", { ascending: true }),
  ]);
  if (ticks.error) throw new Error(`Could not read the videos watched: ${ticks.error.message}`);
  if (opens.error) throw new Error(`Could not read the videos opened: ${opens.error.message}`);
  const attestedAt = new Map<string, string>();
  const tickRows = (ticks.data ?? []) as Array<{ video_ids: string[]; signer_name: string; attested_at: string }>;
  // Ticks arrive newest first, so each video keeps the newest tick that covered it.
  for (const t of tickRows) for (const id of t.video_ids) if (!attestedAt.has(id)) attestedAt.set(id, t.attested_at);
  const openedAt = new Map<string, string>();
  for (const o of (opens.data ?? []) as Array<{ video_id: string; opened_at: string }>) {
    if (!openedAt.has(o.video_id)) openedAt.set(o.video_id, o.opened_at);
  }
  const last = tickRows[0];
  return {
    attestedAt,
    openedAt,
    lastAttestation: last ? { signerName: last.signer_name, attestedAt: last.attested_at } : null,
  };
}

/** The office's view of one applicant's videos. */
export async function applicantOrientationVideos(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<ApplicantOrientationVideos | OrientationVideoError> {
  const { data: driver } = await admin.from("drivers").select("id").eq("org_id", orgId).eq("id", driverId).maybeSingle();
  if (!driver) return NOT_FOUND;
  const [videos, invitation, evidence] = await Promise.all([
    listOrientationVideos(admin, orgId),
    liveInvitation(admin, orgId, driverId),
    driverEvidence(admin, orgId, driverId),
  ]);
  return {
    videos: videos.map((v) => ({
      id: v.id, title: v.title, url: v.url, minutes: v.minutes, required: v.required,
      openedAt: evidence.openedAt.get(v.id) ?? null,
      attestedAt: evidence.attestedAt.get(v.id) ?? null,
    })),
    sentAt: invitation?.orientation_videos_sent_at ?? null,
    lastAttestation: evidence.lastAttestation,
    canSend: invitation !== null && canResendApplicationLink(invitation),
  };
}

/** "Send the videos": the application link, rotated, pointed at the videos page, by email and text. */
export async function sendOrientationVideos(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  driverId: string,
  userId: string,
  now: Date,
): Promise<OrientationVideosSent | OrientationVideoError> {
  const { data: driver } = await admin.from("drivers").select("id").eq("org_id", orgId).eq("id", driverId).maybeSingle();
  if (!driver) return NOT_FOUND;
  const invitation = await liveInvitation(admin, orgId, driverId);
  if (!invitation) {
    return { status: 409, code: "needs_invitation", message: "Send the invitation first — the videos go out on the same link." };
  }
  if (!canResendApplicationLink(invitation)) {
    return { status: 409, code: "application_finished", message: "This application is finished, so its link can no longer be sent." };
  }
  if ((await listOrientationVideos(admin, orgId)).length === 0) {
    return { status: 409, code: "no_videos", message: "There are no videos to send. Add them in Settings → Recruiting first." };
  }
  const sentAt = now.toISOString();
  const rotated = await resendOnInvitation(admin, env, { orgId, userId, invitation }, now, {
    stamp: { orientation_videos_sent_at: sentAt },
    path: applicantVideosPath,
    email: renderOrientationVideosEmail,
    auditAction: "compliance.orientation_videos_sent",
  });
  if (isApplicationLinkError(rotated)) return rotated;
  const text = await sendOrQueueSms(admin, env, {
    orgId, driverId, invitationId: invitation.id, template: "orientation_videos", params: {},
  }, now);
  return { sentAt, email: rotated.delivery, text: textOutcome(text) };
}

/** The applicant's page: the carrier's live list, which of them they have ticked, and their last tick. */
export async function applicantVideoPage(admin: SupabaseClient, token: string, now: Date): Promise<ApplicantVideoPage | IntakeError> {
  const inv = await resolveInvitation(admin, token, now);
  if (isIntakeError(inv)) return inv;
  const [videos, evidence, carrier] = await Promise.all([
    listOrientationVideos(admin, inv.org_id),
    driverEvidence(admin, inv.org_id, inv.driver_id),
    carrierName(admin, inv.org_id),
  ]);
  return {
    carrier,
    videos: videos.map((v) => ({
      id: v.id, title: v.title, url: v.url, minutes: v.minutes, required: v.required,
      attested: evidence.attestedAt.has(v.id),
    })),
    lastAttestation: evidence.lastAttestation,
  };
}

const LIST_CHANGED: IntakeError = { code: "list_changed", message: "The list of videos changed. Reload the page and try again." };

/** A link pressed on the page — that it was opened, never that it was watched. */
export async function recordVideoOpened(
  admin: SupabaseClient,
  token: string,
  videoId: string,
  now: Date,
): Promise<{ ok: true } | IntakeError> {
  const inv = await resolveInvitation(admin, token, now);
  if (isIntakeError(inv)) return inv;
  const { error } = await admin
    .from("orientation_video_opens")
    .insert({ org_id: inv.org_id, driver_id: inv.driver_id, invitation_id: inv.id, video_id: videoId });
  if (error) return error.code === "OV024" || error.code === "22P02" ? LIST_CHANGED : { code: "write_failed", message: "Could not record that." };
  return { ok: true };
}

/** "I watched these" — the videos the page showed, and the name the applicant typed. */
export async function attestVideos(
  admin: SupabaseClient,
  token: string,
  body: OrientationVideoAttest,
  ctx: SubmitContext,
  now: Date,
): Promise<{ attestedAt: string } | IntakeError> {
  const inv = await resolveInvitation(admin, token, now);
  if (isIntakeError(inv)) return inv;
  const { data, error } = await admin
    .from("orientation_video_attestations")
    .insert({
      org_id: inv.org_id, driver_id: inv.driver_id, invitation_id: inv.id, video_ids: body.videoIds,
      signer_name: body.name, ip: ctx.ip, user_agent: ctx.userAgent,
    })
    .select("attested_at")
    .single();
  if (error || !data) {
    return error?.code === "OV024" ? LIST_CHANGED : { code: "write_failed", message: "Could not save that. Try again." };
  }
  return { attestedAt: (data as { attested_at: string }).attested_at };
}
