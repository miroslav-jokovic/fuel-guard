import { z } from "zod";
import { META_FORM_CATALOGUE } from "../../ads/metaLeadForm.js";
import { normalisePhone, type SmsConsentDocument } from "../../smsConsentContract.js";
import { normaliseEmail } from "./leadContract.js";
import type { HazmatMode } from "./hiringProfile.js";
import type { OpeningFacts } from "./opening.js";

/**
 * The public apply page (APPLY-PAGE-PLAN AP2/AP3; Q-APX31 (a), Q-APX34 (a)): what the page is told, what it sends,
 * and the record of the checks a submission went through. The server is the reader of every field; this file is
 * only what crosses the wire, so the API and the page hold one shape.
 *
 * ── A LEAD LIKE ANY OTHER ───────────────────────────────────────────────────────────────────────
 * A submission becomes a lead through the LeadSink with channel `apply_page` (D-AP3). Its answers are
 * `META_FORM_CATALOGUE` keys asked by `openingFormQuestions`, so `factsFor("apply_page")` is `metaFacts` and the
 * lead is judged exactly as an ad lead is. Nothing else is asked: no criminal history, DUI, age, address, ZIP,
 * licence number, SSN or EEO question exists in this contract, so none can be stored.
 */

export const APPLY_PAGE_CHANNEL = "apply_page";
/** The lead's `source`: which of our pages it came from. One today; the careers page doubles as Indeed's (Q-APX32). */
export const APPLY_PAGE_SOURCE = "careers_page";
/** Turnstile's `action` for this form: at most 32 of [A-Za-z0-9_-] (Cloudflare, read 2026-11-20). Checked on the server. */
export const APPLY_TURNSTILE_ACTION = "apply";

/**
 * The texting box (D-AP4): the drafted wording of Q-APX31 point 3, as the owner ruled it, with "[carrier legal name]"
 * filled on the server (`composeSmsConsent`). The Privacy Policy and SMS Terms links sit BESIDE it on the page, not in
 * it, for `SMS_CONSENT`'s reason: this body is stored on the consent row, and a URL in stored evidence is a promise
 * about a page that will change. Counsel's redline, when it comes, is the next version — every row keeps the words it
 * was given under.
 */
export const SMS_APPLY_PAGE_CONSENT: SmsConsentDocument = {
  version: "apply-page-2026-11-20",
  title: "Text me about my application (optional).",
  citation: "47 U.S.C. §227; 47 CFR §64.1200",
  body:
    "I agree to receive text messages from {{carrier}} at the mobile number above about my job application, such as "
    + "application links, interview and orientation scheduling, and hiring updates. Consent is not a condition of "
    + "applying or of employment. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP "
    + "for help. We will not share your mobile number or opt-in with third parties for marketing.",
  intent: "Text me about my application.",
};

// ── what the page is told ───────────────────────────────────────────────────────────────────────

/** One question as the page shows it: the catalogue's own English words, never retyped. */
export interface ApplyQuestion {
  key: string;
  label: string;
  options: Array<{ key: string; label: string }>;
}

/** The questions for these catalogue keys, in order. A key the catalogue does not hold is a programming error. */
export function applyQuestions(keys: readonly string[]): ApplyQuestion[] {
  return keys.map((key) => {
    const entry = META_FORM_CATALOGUE[key];
    if (!entry) throw new Error(`applyQuestions: ${key} is not a catalogue question`);
    return { key, label: entry.label.en, options: entry.options.map((o) => ({ key: o.key, label: o.value.en })) };
  });
}

/** What the job asks of a driver, from the opening's hiring profile version. */
export interface ApplyRequirements {
  minAge: number;
  minClassAYears: number;
  hazmat: HazmatMode;
}

/** Who applicants ask for an accommodation (D-AP7). At least one is set on a published page (0641). */
export interface ApplyAccommodation {
  email: string | null;
  phone: string | null;
}

/** One opening as the careers list shows it. */
export interface CareersListOpening {
  id: string;
  title: string;
  pay: OpeningFacts["pay"];
  areaLabel: string;
  equipment: OpeningFacts["equipment"];
  schedule: OpeningFacts["schedule"];
}

/** `GET /api/public/careers/:handle`. */
export interface CareersListView {
  carrier: string;
  handle: string;
  openings: CareersListOpening[];
  accommodation: ApplyAccommodation;
  /** This page's own address on the careers host (D-AP9): the page's canonical link, one per job for Google and Indeed. */
  pageUrl: string;
  /**
   * The office app's origin, where the Privacy Policy and SMS Terms live (D-AP9). They stay there: the toll-free
   * verification registered them on that host. The page adds the paths, which are the web app's own.
   */
  legalOrigin: string;
}

/** `GET /api/public/careers/:handle/jobs/:openingId`: the job, its form, and the token the form is sent back with. */
export interface ApplyJobView {
  carrier: string;
  handle: string;
  opening: {
    id: string;
    title: string;
    facts: OpeningFacts;
    areaLabel: string;
  };
  requirements: ApplyRequirements;
  questions: ApplyQuestion[];
  /** The box's wording as served, carrier named — shown whole beside the box. */
  consent: { version: string; title: string; body: string };
  accommodation: ApplyAccommodation;
  /**
   * Sealed by the server: which form was served, to whom, and when (D-AP5's fill time, measured on the server's
   * clock). Null when this server cannot seal; the submission is then recorded with its fill time "not measured".
   */
  formToken: string | null;
  /** Turnstile's site key, or null when the server holds no Turnstile keys (D-AP6): the page then shows no widget. */
  turnstileSiteKey: string | null;
  /** This page's own address on the careers host (D-AP9): the page's canonical link, one per job for Google and Indeed. */
  pageUrl: string;
  /**
   * The office app's origin, where the Privacy Policy and SMS Terms live (D-AP9). They stay there: the toll-free
   * verification registered them on that host. The page adds the paths, which are the web app's own.
   */
  legalOrigin: string;
}

// ── what the page sends ─────────────────────────────────────────────────────────────────────────

/**
 * The honeypot's field name (D-AP5): a word a form-filling bot fills and a person never sees. It is hidden from
 * people and from screen readers on the page, and the label says to leave it empty in case anything shows it.
 */
export const APPLY_HONEYPOT_FIELD = "company_website";

export const applySubmitSchema = z
  .object({
    formToken: z.string().max(4000).nullable(),
    fullName: z.string().trim().min(2, "Enter your full name.").max(200),
    phone: z.string().trim().max(40).nullable(),
    email: z.string().trim().max(320).nullable(),
    /** Catalogue key → option key. Which keys must be present is the opening's, checked by `applyAnswersProblem`. */
    answers: z.record(z.string().max(60), z.string().max(60)),
    smsOptIn: z.boolean(),
    /** Turnstile's token: at most 2048 characters (Cloudflare). Null when the widget did not run. */
    turnstileToken: z.string().max(2048).nullable(),
    [APPLY_HONEYPOT_FIELD]: z.string().max(500),
  })
  .strict()
  .superRefine((v, ctx) => {
    const phone = v.phone ? normalisePhone(v.phone) : null;
    if (v.phone && phone === null) ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a 10-digit mobile number." });
    if (v.email && normaliseEmail(v.email) === null) ctx.addIssue({ code: "custom", path: ["email"], message: "Enter an email address like name@example.com." });
    // D-LS10: a lead nobody can reach or recognise is no lead.
    if (!v.phone && !v.email) ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a mobile number or an email so we can reach you." });
    if (v.smsOptIn && phone === null) ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter the mobile number to text, or untick the box." });
  });
export type ApplySubmit = z.infer<typeof applySubmitSchema>;

/**
 * Whether the answers are exactly the opening's questions, each with one of its options. A key not asked, a missing
 * answer and an option that does not exist are all refused by name: the page cannot send them, so a body that does is
 * not a person's.
 */
export function applyAnswersProblem(questions: readonly ApplyQuestion[], answers: Record<string, string>): string | null {
  const asked = new Map(questions.map((q) => [q.key, q]));
  for (const key of Object.keys(answers)) if (!asked.has(key)) return `${key} is not a question on this form.`;
  for (const q of questions) {
    const a = answers[q.key];
    if (a === undefined) return `Answer: ${q.label}`;
    if (!q.options.some((o) => o.key === a)) return `${a} is not an answer to: ${q.label}`;
  }
  return null;
}

// ── what the checks found (stored on the lead's `raw.checks`; D-AP5) ───────────────────────────

export const APPLY_MIN_FILL_MS = 4_000;
export const APPLY_MAX_PER_ADDRESS_HOUR = 5;
export const APPLY_MAX_PER_NUMBER_DAY = 3;

export type TurnstileOutcome =
  /** Cloudflare said success, for our host and our action. */
  | "passed"
  /** Cloudflare said no, or said yes for another host or action. */
  | "failed"
  /** The page sent no token: the widget did not run (blocked, no script) or a bot skipped it. */
  | "missing"
  /** This server holds no Turnstile secret (D-AP6). Not a flag. */
  | "not_configured"
  /** Cloudflare could not be asked (timeout, 5xx, `internal-error`). Not a flag: their outage is not the person's. */
  | "unavailable";

export type FillOutcome = "ok" | "too_fast" | "token_invalid" | "not_measured";

export interface ApplyChecks {
  turnstile: TurnstileOutcome;
  /** Cloudflare's `error-codes`, as sent, when it said no. */
  turnstile_errors: string[];
  honeypot: "empty" | "filled";
  fill: FillOutcome;
  /** Milliseconds from the form being served to it being sent, on the server's clock; null when not measured. */
  fill_ms: number | null;
  /** Earlier apply-page leads from this address in the hour before, and for this number in the day before. */
  address_last_hour: number;
  number_last_day: number;
  /** Every check that failed, by name; empty = not flagged. */
  flags: ApplyFlag[];
}

export type ApplyFlag = "robot_check_failed" | "robot_check_missing" | "honeypot_filled" | "too_fast" | "form_token_invalid" | "address_busy" | "number_busy";

/** The flags a set of check results raises (D-AP5). Pure, so the rule is read in one place. */
export function applyFlags(c: Omit<ApplyChecks, "flags">): ApplyFlag[] {
  const flags: ApplyFlag[] = [];
  if (c.turnstile === "failed") flags.push("robot_check_failed");
  if (c.turnstile === "missing") flags.push("robot_check_missing");
  if (c.honeypot === "filled") flags.push("honeypot_filled");
  if (c.fill === "too_fast") flags.push("too_fast");
  if (c.fill === "token_invalid") flags.push("form_token_invalid");
  if (c.address_last_hour >= APPLY_MAX_PER_ADDRESS_HOUR) flags.push("address_busy");
  if (c.number_last_day >= APPLY_MAX_PER_NUMBER_DAY) flags.push("number_busy");
  return flags;
}

/**
 * The flags a STORED lead carries, read back from `raw.checks.flags` (D-AP5). The background readers that act on a
 * lead after it is stored — the "nobody has called" alarm, the phone-lookup retry, the cost report — select it with
 * `APPLY_FLAGS_SELECT` and ask `isFlaggedLead`, so a flagged lead stays as quiet later as it was on arrival: listed,
 * never rung, never paid for, never counted as a real lead. Only the careers page writes the path, so every other
 * channel's lead (and a purged lead, whose raw is `{}`) reads as not flagged. A value that is not a list of known
 * flags reads as not flagged, never a guess: a missed bell costs more than a false one.
 */
export const APPLY_FLAGS_SELECT = "apply_flags:raw->checks->flags";
export function isFlaggedLead(row: { apply_flags?: unknown }): boolean {
  const f = row.apply_flags;
  // The known flags are `APPLY_FLAG_TEXT`'s keys — a Record over `ApplyFlag`, so a new flag cannot be missed here.
  return Array.isArray(f) && f.some((x) => typeof x === "string" && Object.hasOwn(APPLY_FLAG_TEXT, x));
}

/** The office's words for each flag (the lead drawer, AP4). */
export const APPLY_FLAG_TEXT: Record<ApplyFlag, string> = {
  robot_check_failed: "Cloudflare's robot check said this was not a person.",
  robot_check_missing: "The robot check did not run in their browser (blocked, or skipped).",
  honeypot_filled: "A hidden field only a program fills in was filled in.",
  too_fast: "Sent less than 4 seconds after the form opened.",
  form_token_invalid: "Sent without the form the page served.",
  address_busy: `${APPLY_MAX_PER_ADDRESS_HOUR} or more applications came from the same internet address within an hour.`,
  number_busy: `${APPLY_MAX_PER_NUMBER_DAY} or more applications gave the same number within a day.`,
};

/**
 * The texting box's outcome on the lead (`raw.sms`): what was ticked and what was recorded.
 *  · `recorded`     an `sms_consents` row was written (a clean submission with a number);
 *  · `not_ticked`   the box was left empty;
 *  · `held_flagged` ticked, NOT recorded, because the submission was flagged: a bot can type a stranger's number;
 *  · `held_stopped` ticked, NOT recorded, because the number texted STOP to this carrier (`sms_suppressions`), and a
 *                   box on a form must not overrule that (`recordSmsConsent`'s `number_stopped`).
 */
export type ApplySmsOutcome = "recorded" | "not_ticked" | "held_flagged" | "held_stopped";
