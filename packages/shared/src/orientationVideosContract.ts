import { z } from "zod";
import { escapeEmailHtml as esc, type RenderedEmail } from "./email.js";
import { recordId } from "./recordId.js";
import type { SigningTextOutcome } from "./signingSend.js";

/**
 * Orientation videos, first version (HIRING-WORKFLOW-AUDIT-2026-10-31 §4.8, §8.2, §5 HW8a; the tables
 * are 0538): the carrier's list of LINKS in Settings → Recruiting, the office's "Send the videos", and
 * the applicant's one tick, "I watched these", with their name.
 *
 * ── A LINK LIST AND A TICK, ON PURPOSE (§8.2) ─────────────────────────────────────────────────
 * "Watched to the end" needs a player we host; that is `DRIVER-TRAINING-PLAN.md`'s micro-LMS and stays
 * the later version. So the evidence is what the applicant SAYS — which videos, their name, when — and,
 * beside it, which links they pressed on our page (`openedAt`). The words say "Opened", never "Watched",
 * because a pressed link is all a link list can know.
 *
 * ── WHAT "DONE" MEANS (§4.8) ──────────────────────────────────────────────────────────────────
 * Every REQUIRED, live video attested — by any tick, old or new: a carrier that adds a required video
 * after a driver's tick has a driver who has not watched it, and the step re-opens. A carrier with no
 * required video has nothing for the step to measure: the fold leaves the step out (not "done" — a
 * vacuous "every video" certifies nothing) and the record says to add the videos in Settings →
 * Recruiting. `orientationVideosMeasurable` is that rule, stated once for the fold and the screens.
 *
 * ⚠ The lengths and the https rule are 0538's CHECKs, restated so the browser can say so before a
 * round trip; the database stays the authority.
 */

export const ORIENTATION_VIDEO_TITLE_MAX = 200;
export const ORIENTATION_VIDEO_URL_MAX = 2000;
export const ORIENTATION_VIDEO_MINUTES_MAX = 600;
/** 0538's `position between 0 and 1000`. */
export const ORIENTATION_VIDEO_POSITION_MAX = 1000;
/** 0538's `orientation_video_attestations.signer_name`, after trimming. */
export const ORIENTATION_VIDEO_SIGNER_MAX = 200;

const title = z
  .string()
  .trim()
  .min(1, "Give the video a title.")
  .max(ORIENTATION_VIDEO_TITLE_MAX, `A title can be at most ${ORIENTATION_VIDEO_TITLE_MAX} characters.`);
const minutes = z.number().int().min(1).max(ORIENTATION_VIDEO_MINUTES_MAX).nullable();

/** A new video on the carrier's list. The link is fixed from here on (OV011): a new link is a new video. */
export const orientationVideoCreateSchema = z.object({
  title,
  url: z
    .string()
    .trim()
    .max(ORIENTATION_VIDEO_URL_MAX, "That link is too long.")
    .regex(/^https:\/\/\S+$/i, "Paste the video's full link, starting with https://"),
  minutes: minutes.optional().default(null),
  required: z.boolean().optional().default(true),
});
export type OrientationVideoCreate = z.infer<typeof orientationVideoCreateSchema>;

/**
 * What the office may change on a video: its words, its length, whether it is required, its place — or
 * retire it, which is one-way (OV012). Never the link (OV011), so there is no `url` here.
 */
export const orientationVideoUpdateSchema = z
  .object({
    title: title.optional(),
    minutes: minutes.optional(),
    required: z.boolean().optional(),
    position: z.number().int().min(0).max(ORIENTATION_VIDEO_POSITION_MAX).optional(),
    retire: z.literal(true).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change." });
export type OrientationVideoUpdate = z.infer<typeof orientationVideoUpdateSchema>;

/** One video on the carrier's list, as the API returns it — 0538's row. */
export interface OrientationVideo {
  id: string;
  title: string;
  url: string;
  minutes: number | null;
  required: boolean;
  position: number;
  created_at: string;
  retired_at: string | null;
}

/** The applicant's "I watched these" — the videos the page showed, and their name. */
export const orientationVideoAttestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Type your full name.")
    .max(ORIENTATION_VIDEO_SIGNER_MAX, `A name can be at most ${ORIENTATION_VIDEO_SIGNER_MAX} characters.`),
  videoIds: z.array(recordId()).min(1).max(100),
});
export type OrientationVideoAttest = z.infer<typeof orientationVideoAttestSchema>;

/**
 * What the fold is given about one applicant (`HiringChecklistInputs.orientationVideos`): the carrier's
 * required, live video ids, every video this driver has attested, and the office's last send.
 */
export interface OrientationVideoFacts {
  required: readonly string[];
  attested: readonly string[];
  sentAt: string | null;
}

/** Can the step be measured for this carrier? Only with at least one required video on the list. */
export const orientationVideosMeasurable = (facts: OrientationVideoFacts | null | undefined): facts is OrientationVideoFacts =>
  facts != null && facts.required.length > 0;

/** The required videos this driver has not attested yet, in the list's order. */
export function orientationVideosOutstanding(facts: OrientationVideoFacts): string[] {
  const attested = new Set(facts.attested);
  return facts.required.filter((id) => !attested.has(id));
}

/** One video as the office's drawer shows it for one applicant. */
export interface ApplicantOrientationVideo extends Pick<OrientationVideo, "id" | "title" | "url" | "minutes" | "required"> {
  /** The first time the applicant pressed its link on our page. Not "watched" — a pressed link. */
  openedAt: string | null;
  /** The tick that covered it, if any. */
  attestedAt: string | null;
}

/** `GET /api/recruitment/applicants/:driverId/orientation-videos`. */
export interface ApplicantOrientationVideos {
  videos: ApplicantOrientationVideo[];
  /** The office's last send on the live invitation; null when never sent (or no invitation). */
  sentAt: string | null;
  /** The newest tick: the name the applicant typed and when. */
  lastAttestation: { signerName: string; attestedAt: string } | null;
  /** False with no live invitation — there is no link to send the videos on. */
  canSend: boolean;
}

/** `POST …/orientation-videos/send` — where the link went. Never the link itself. */
export interface OrientationVideosSent {
  sentAt: string;
  email: { sent: boolean; email: string | null; reason: string | null };
  text: SigningTextOutcome;
}

/** `GET /api/public/application/:token/videos` — the applicant's page. */
export interface ApplicantVideoPage {
  carrier: string;
  videos: Array<Pick<OrientationVideo, "id" | "title" | "url" | "minutes" | "required"> & { attested: boolean }>;
  /** The newest tick on this applicant, if any. */
  lastAttestation: { signerName: string; attestedAt: string } | null;
}

/** The path the videos link opens, on any of the invitation's doors. */
export const applicantVideosPath = (token: string): string => `/apply/${token}/videos`;

/** The text (`sms_outbox` template `orientation_videos`). */
export const smsOrientationVideos = (carrier: string, link: string): string =>
  `${carrier}: Please watch your orientation videos before you come in: ${link} Reply STOP to opt out.`;

/**
 * The email. A sibling of the application emails (`email.ts`) and in their voice — the carrier's name
 * first — kept here beside the rest of the videos' words. It says the earlier link no longer works,
 * because sending it replaces the application link's token exactly as "send the link again" does.
 */
export function renderOrientationVideosEmail(carrier: string, url: string, expiresInDays: number): RenderedEmail {
  const subject = `Your ${carrier} orientation videos`;
  const days = `${expiresInDays} ${expiresInDays === 1 ? "day" : "days"}`;
  const html =
    `<div style="font-family:system-ui,sans-serif;color:#111">`
    + `<h2 style="margin:0 0 8px">${esc(carrier)} has sent your orientation videos</h2>`
    + `<p style="color:#555">Please watch them before you come in. When you have, tick "I watched these" `
    + `and type your name — it shortens your day in the office.</p>`
    + `<p style="margin:20px 0"><a href="${esc(url)}" style="background:#4f46e5;color:#fff;`
    + `padding:10px 16px;border-radius:6px;text-decoration:none">Open my videos →</a></p>`
    + `<p style="color:#888;font-size:12px">If the button doesn't work, paste this link into your `
    + `browser:<br>${esc(url)}</p>`
    + `<p style="color:#aaa;font-size:12px">This link also opens your application. Any earlier link we `
    + `sent you no longer works. This one is yours alone and stops working in ${days}.</p>`
    + `</div>`;
  const text =
    `${carrier} has sent your orientation videos.\n\n`
    + `Please watch them before you come in. When you have, tick "I watched these" and type your name:\n`
    + `${url}\n\n`
    + `This link also opens your application. Any earlier link we sent you no longer works. This one is `
    + `yours alone and stops working in ${days}.`;
  return { subject, html, text };
}
