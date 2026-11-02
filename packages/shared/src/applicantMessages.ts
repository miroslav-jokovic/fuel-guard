import { escapeEmailHtml as esc, type RenderedEmail } from "./email.js";
import type { NudgePart } from "./applicationNudge.js";
import {
  STANDARD_WORDING,
  resolveMessageParts,
  type MessageVars,
  type MessageWording,
  type RecruitingMessageKey,
} from "./recruitingMessages.js";

/**
 * The emails and texts an applicant is sent with a link, rendered from the catalogue's parts
 * (`recruitingMessages.ts`) and the fixed pieces no carrier writes (HIRING-WORKFLOW-AUDIT §12 D-MT2).
 *
 * ── ONE FUNCTION FOR THE SENDER AND THE PREVIEW (D-MT7) ───────────────────────────────────────
 * `renderApplicantEmail` / `renderApplicantText` are what the API sends with and what Settings →
 * Recruiting previews with, so the preview cannot say one thing while the inbox says another. Until §12
 * each message was its own function (`renderApplicationInviteEmail` in `email.ts`,
 * `renderApplicationSentEmail` in `applicationSentEmail.ts`, `nudgeEmail` in the API's sweep,
 * `renderOrientationVideosEmail` and the four `sms…` texts); they are kept below as the standard-wording
 * calls, so their callers and tests did not move.
 *
 * ── WHAT IS FIXED, AND WHY (the comments that used to sit on each function) ───────────────────
 * · The carrier's name first and Silvicom 360's nowhere: the applicant's relationship is with the
 *   carrier. Every text starts `{carrier}:` because every US programme requires the sender in the body.
 * · The expiry sentence is said because the link really does expire, and "your earlier link no longer
 *   works" because sending rotates the token (0232, 0365) — a driver holding the older email would tap
 *   a dead link. Neither is a carrier's to remove.
 * · The invitation by text (Q-AW55, D-SMS11) is the first message the number ever gets: "You asked us
 *   to text you" is the office's attestation said back, so a wrong number reads it as the mistake it is,
 *   and it carries what CTIA §5.1.2.1 asks of a first contact — rates, HELP, STOP. Those stay.
 * · No link shortener — carriers block public shorteners on sight — so the full link.
 * · The reminder promises no second reminder about the same step (Q-AW37 (b)), and that is true.
 */

/** Anything that is not a part: the reminder's "where you stopped" and which part it is about. */
export interface ApplicantMessageExtra {
  sectionLabel?: string | null;
  part?: NudgePart;
}

const daysWords = (n: number | null): string => `${n ?? 0} ${n === 1 ? "day" : "days"}`;

/** The reminder's last sentence, per part (Q-AW37 (b)): Part 1's promise is narrower, and true. */
const NO_MORE: Record<NudgePart, string> = {
  part_one: "we will not remind you about this step again.",
  part_two: "we will not send another reminder.",
};

interface Fixed {
  button: string;
  textLabel: string;
  footer: (v: MessageVars) => string;
}

const FIXED: Record<Exclude<RecruitingMessageKey, "reminder">, Fixed> = {
  invitation: {
    button: "Start my application →",
    textLabel: "Start your application:",
    footer: (v) => `This link is yours alone and stops working in ${daysWords(v.days)}. If you were not expecting it, you can ignore this email.`,
  },
  application_ready: {
    button: "Open my application →",
    textLabel: "Open your application:",
    footer: (v) => `Use this link from now on — the one in the earlier email no longer works. It is yours alone and stops working in ${daysWords(v.days)}.`,
  },
  videos: {
    button: "Open my videos →",
    textLabel: "Open your videos:",
    footer: (v) => `This link also opens your application. Any earlier link we sent you no longer works. This one is yours alone and stops working in ${daysWords(v.days)}.`,
  },
};

/** A carrier's paragraph keeps its line breaks; the HTML says them as <br>. */
const paragraphHtml = (s: string): string => esc(s).replace(/\r?\n/g, "<br>");

const withStop = (s: string): string => (/[.!?:]$/.test(s) ? s : `${s}.`);

/** The email for one message, with this carrier's wording (null parts = the standard words). */
export function renderApplicantEmail(
  key: RecruitingMessageKey,
  vars: MessageVars,
  url: string,
  wording: MessageWording = STANDARD_WORDING,
  extra: ApplicantMessageExtra = {},
): RenderedEmail {
  const p = resolveMessageParts(key, vars, wording);
  if (key === "reminder") return reminderEmail(p.emailSubject, p.emailHeading, p.emailParagraph, url, extra);
  const f = FIXED[key];
  const heading = p.emailHeading ?? "";
  const html =
    `<div style="font-family:system-ui,sans-serif;color:#111">`
    + (heading ? `<h2 style="margin:0 0 8px">${esc(heading)}</h2>` : "")
    + `<p style="color:#555">${paragraphHtml(p.emailParagraph)}</p>`
    + `<p style="margin:20px 0"><a href="${esc(url)}" style="background:#4f46e5;color:#fff;`
    + `padding:10px 16px;border-radius:6px;text-decoration:none">${f.button}</a></p>`
    + `<p style="color:#888;font-size:12px">If the button doesn't work, paste this link into your `
    + `browser:<br>${esc(url)}</p>`
    + `<p style="color:#aaa;font-size:12px">${esc(f.footer(vars))}</p>`
    + `</div>`;
  const text = (heading ? `${withStop(heading)}\n\n` : "")
    + `${p.emailParagraph}\n\n`
    + `${f.textLabel} ${url}\n\n`
    + f.footer(vars);
  return { subject: p.emailSubject, html, text };
}

/**
 * The reminder (A10, D-APP15): what is saved, where they stopped, one link, and the one caveat that
 * matters — the older email's link is dead now. Its own shape: a plain link, not a button.
 */
function reminderEmail(
  subject: string, heading: string | null, paragraph: string, url: string, extra: ApplicantMessageExtra,
): RenderedEmail {
  const label = extra.sectionLabel ?? null;
  const last = NO_MORE[extra.part ?? "part_two"];
  const where = label ? ` You had reached "${label}".` : "";
  const text = (heading ? `${withStop(heading)}\n\n` : "")
    + `${paragraph}${where}\n\n`
    + `Pick up where you left off: ${url}\n\n`
    + "This link replaces the one in the earlier email, which no longer works. "
    + `If you would rather not continue, you can ignore this — ${last}`;
  const html = [
    heading ? `<h2 style="margin:0 0 8px">${esc(heading)}</h2>` : "",
    `<p>${paragraphHtml(paragraph)}`,
    label ? ` You had reached &quot;${esc(label)}&quot;.` : "",
    "</p>",
    `<p><a href="${esc(url)}">Pick up where you left off</a></p>`,
    "<p>This link replaces the one in the earlier email, which no longer works. If you would rather "
    + `not continue, you can ignore this — ${last}</p>`,
  ].join("");
  return { subject, text, html };
}

/** The text for one message: `{carrier}: <lead> {link} <fixed tail>`, the tail never the carrier's. */
export function renderApplicantText(
  key: RecruitingMessageKey,
  vars: MessageVars,
  link: string,
  wording: MessageWording = STANDARD_WORDING,
): string {
  const lead = resolveMessageParts(key, vars, wording).textLead;
  const c = vars.carrier;
  switch (key) {
    case "invitation":
      return `${c}: You asked us to text you your driver application. ${lead} ${link} `
        + `This link works for ${vars.days ?? 0} days. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`;
    case "application_ready":
      return `${c}: ${lead} ${link} Your earlier link no longer works. Reply STOP to opt out.`;
    case "reminder":
      return `${c}: ${lead} ${link} This link replaces any earlier one. Reply STOP to opt out.`;
    case "videos":
      return `${c}: ${lead} ${link} Reply STOP to opt out.`;
  }
}

// ── the standard-wording calls, kept for their callers and tests ─────────────────────────────────

const std = (carrier: string, days: number | null = null): MessageVars => ({ carrier, firstName: null, days });

export const applicationInviteSubject = (carrier: string): string =>
  renderApplicantEmail("invitation", std(carrier, 1), "").subject;
export const renderApplicationInviteEmail = (carrier: string, applyUrl: string, expiresInDays: number): RenderedEmail =>
  renderApplicantEmail("invitation", std(carrier, expiresInDays), applyUrl);
export const applicationSentSubject = (carrier: string): string =>
  renderApplicantEmail("application_ready", std(carrier, 1), "").subject;
export const renderApplicationSentEmail = (carrier: string, applyUrl: string, expiresInDays: number): RenderedEmail =>
  renderApplicantEmail("application_ready", std(carrier, expiresInDays), applyUrl);
export const renderOrientationVideosEmail = (carrier: string, url: string, expiresInDays: number): RenderedEmail =>
  renderApplicantEmail("videos", std(carrier, expiresInDays), url);
export const nudgeEmail = (carrier: string, link: string, sectionLabel: string | null, part: NudgePart = "part_two"): RenderedEmail =>
  renderApplicantEmail("reminder", std(carrier), link, STANDARD_WORDING, { sectionLabel, part });

export const smsApplicationInvite = (carrier: string, link: string, days: number): string =>
  renderApplicantText("invitation", std(carrier, days), link);
export const smsApplicationReady = (carrier: string, link: string): string =>
  renderApplicantText("application_ready", std(carrier), link);
export const smsApplicationReminder = (carrier: string, link: string): string =>
  renderApplicantText("reminder", std(carrier), link);
export const smsOrientationVideos = (carrier: string, link: string): string =>
  renderApplicantText("videos", std(carrier), link);
