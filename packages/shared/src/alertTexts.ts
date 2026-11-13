import { z } from "zod";
import { wallClockInZone } from "./calendarDay.js";

/**
 * Alert texts to the office (HOME-TIME-PLAN HT6, D-HT16..D-HT18; NOTIFICATION-ROUTING-PLAN D-NR5): the
 * hours a text waits, the words of one, and how a person confirms the number it goes to.
 *
 * These are STAFF texts — an employee's own mobile, confirmed by a code they typed. The applicant
 * texts (`smsConsentContract.ts`) are a different consent with a different record; nothing here reads
 * or writes it.
 */

// ── the hours a text waits (D-HT18) ───────────────────────────────────────────────────────────────

/** The quiet window, minutes past midnight on the carrier's clock — `notification_channel_settings`' two columns. */
export const alertTextQuietSchema = z
  .object({ startMin: z.number().int().min(0).max(1439), endMin: z.number().int().min(0).max(1439) })
  // Equal ends would be "no quiet hours" to one reader and "always quiet" to another; neither is offered.
  .refine((v) => v.startMin !== v.endMin, { message: "The start and the end cannot be the same time." });
export type AlertTextQuiet = z.infer<typeof alertTextQuietSchema>;

/** A carrier that has saved none: 21:00 to 07:00 (owner's ruling Q-HT5, 2026-11-13). Written once, here. */
export const ALERT_TEXT_QUIET_DEFAULT: AlertTextQuiet = { startMin: 21 * 60, endMin: 7 * 60 };

const minuteOfDay = (at: Date, zone: string): number => {
  const c = wallClockInZone(at, zone);
  return c.hour * 60 + c.minute;
};

/** Is this instant inside the quiet window on the carrier's clock? The window usually wraps midnight. */
export function inAlertTextQuiet(at: Date, zone: string, quiet: AlertTextQuiet): boolean {
  const m = minuteOfDay(at, zone);
  return quiet.startMin < quiet.endMin ? m >= quiet.startMin && m < quiet.endMin : m >= quiet.startMin || m < quiet.endMin;
}

/**
 * When a text queued now may leave: null for "now", else the instant the quiet window ends.
 *
 * Minutes are added to the instant, so across a clock change the answer can be an hour early or late on
 * the wall. That is why the sender ALSO asks `inAlertTextQuiet` at the moment of sending: early is held
 * again, late is one hour late twice a year.
 */
export function alertTextNotBefore(now: Date, zone: string, quiet: AlertTextQuiet): Date | null {
  if (!inAlertTextQuiet(now, zone, quiet)) return null;
  const wait = (quiet.endMin - minuteOfDay(now, zone) + 1440) % 1440;
  const at = new Date(now.getTime() + wait * 60_000);
  at.setUTCSeconds(0, 0);
  return at;
}

/** "9:00 PM" for a minute of the day — the page's words for the window. */
export function alertTextClock(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "21:00" ⇄ minutes, for an `<input type="time">`. */
export const alertTextClockValue = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export function alertTextClockMinutes(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

// ── the words of a text (D-HT16) ──────────────────────────────────────────────────────────────────

/** Two SMS segments. A longer text is cut and says how many lines it left out. */
export const ALERT_TEXT_MAX = 300;
const SENDER = "Silvicom 360";
const OPT_OUT = "Reply STOP to end.";

/**
 * ONE text for everything new for a person in a run (D-HT16): who sent it, the alert, each event's
 * sentence, and how to stop. The sentences are the bell's own — names, trucks and times, never a note.
 */
export function alertTextBody(label: string, lines: readonly string[]): string {
  const head = `${SENDER}: ${label}.`;
  const room = ALERT_TEXT_MAX - head.length - OPT_OUT.length - 2;
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const sentence = /[.!?]$/.test(line) ? line : `${line}.`;
    // Keep room for "+N more." while lines remain.
    const reserve = kept.length + 1 < lines.length ? 10 : 0;
    if (used + sentence.length + 1 + reserve > room && kept.length > 0) break;
    kept.push(sentence);
    used += sentence.length + 1;
  }
  const left = lines.length - kept.length;
  return [head, ...kept, ...(left > 0 ? [`+${left} more.`] : []), OPT_OUT].join(" ");
}

// ── confirming the number (D-HT17) ────────────────────────────────────────────────────────────────

export const ALERT_PHONE_CODE_MINUTES = 10;
export const ALERT_PHONE_CODE_ATTEMPTS = 5;
/** A new code may be asked for this long after the last one — a text costs money and a loop costs trust. */
export const ALERT_PHONE_RESEND_SECONDS = 60;

/**
 * What the person agrees to, shown above the button and stored with the confirmation
 * (`notification_contacts.consent_text`, `consent_version`). Changing a word means a new version.
 */
export const ALERT_TEXT_CONSENT = {
  version: "staff-alerts-2026-11-13",
  text: "Text me work alerts from Silvicom 360 at this number. Message frequency varies. Message and data rates may apply. Reply STOP to end, HELP for help.",
} as const;

export const alertPhoneCodeText = (code: string): string => `${SENDER} code: ${code}. It expires in ${ALERT_PHONE_CODE_MINUTES} minutes. If you did not ask for it, ignore this text.`;

/** `POST /api/me/alerts/phone` — text a code to this number. `agreed` is the consent above, as a literal. */
export const alertPhoneStartSchema = z.object({ phone: z.string().min(7).max(24), agreed: z.literal(true) });
export type AlertPhoneStart = z.infer<typeof alertPhoneStartSchema>;

/** `POST /api/me/alerts/phone/confirm` — the six digits. */
export const alertPhoneConfirmSchema = z.object({ code: z.string().regex(/^\d{6}$/, "Six digits") });
export type AlertPhoneConfirm = z.infer<typeof alertPhoneConfirmSchema>;

/**
 * Where a person's text alerts stand. `pending`: a code was sent and not typed yet. `stopped`: they
 * replied STOP or switched texts off; confirming the number again turns them back on.
 */
export const ALERT_CONTACT_STATES = ["none", "pending", "verified", "stopped"] as const;
export type AlertContactState = (typeof ALERT_CONTACT_STATES)[number];

export const myAlertContactSchema = z.object({
  /** False when this server cannot send a text at all: the form is not offered. */
  available: z.boolean(),
  state: z.enum(ALERT_CONTACT_STATES),
  /** The number's last four digits; the whole number is never sent back to the page. */
  last4: z.string().nullable(),
});
export type MyAlertContact = z.infer<typeof myAlertContactSchema>;

export function alertContactState(row: { verified_at: string | null; stopped_at: string | null; code_hash: string | null } | null): AlertContactState {
  if (!row) return "none";
  if (row.code_hash !== null) return "pending";
  if (row.stopped_at !== null) return "stopped";
  return row.verified_at !== null ? "verified" : "none";
}
