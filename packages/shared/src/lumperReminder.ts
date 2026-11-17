import { wallClockInZone, type CalendarDay } from "./calendarDay.js";
import { formatDisplayDate } from "./displayDate.js";
import type { LumperCaseState } from "./lumperCase.js";
import type { NotificationSeverity } from "./notificationsContract.js";

/**
 * The daily lumper reminder — LUMPER-REVISED-RC-PLAN LRC4 (D-LRC4, D-LRC6, Q-LRC2, Q-LRC9).
 *
 * Pure: WHEN the reminder is due, WHICH alert a case belongs to, and the WORDS of its line. The run that
 * reads the cases and sends them is `apps/api/src/modules/mcleod/lumper/lumperReminders.ts`; it reads the
 * cases through the page's own reader, so a case the page shows open is the case the reminder names.
 */

/** Q-LRC2, ruled 2026-11-13: 08:00 on the carrier's clock, Monday to Friday. Written once, here. */
export const LUMPER_REMINDER_SCHEDULE = { hour: 8, minute: 0, weekdays: [1, 2, 3, 4, 5] as readonly number[] } as const;

/**
 * The carrier's calendar day when the reminder is due at `now` — a weekday, at or after 08:00 on its
 * clock — or null. The run asks this every tick; the day is what it claims, so a day is sent at most once
 * whenever in the day the first tick after 08:00 lands (a restart at 10:00 still sends that morning's).
 */
export function lumperReminderDay(now: Date, zone: string): CalendarDay | null {
  const c = wallClockInZone(now, zone);
  const weekday = new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay();
  if (!LUMPER_REMINDER_SCHEDULE.weekdays.includes(weekday)) return null;
  if (c.hour * 60 + c.minute < LUMPER_REMINDER_SCHEDULE.hour * 60 + LUMPER_REMINDER_SCHEDULE.minute) return null;
  return `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;
}

export const LUMPER_REMINDER_ALERTS = ["lumper_rc_waiting", "lumper_rc_missing_billed", "lumper_billing_gap"] as const;
export type LumperReminderAlert = (typeof LUMPER_REMINDER_ALERTS)[number];

/** Money already invoiced and still at risk is a warning; a paper still owed before billing is information. */
export const LUMPER_REMINDER_SEVERITY: Record<LumperReminderAlert, NotificationSeverity> = {
  lumper_rc_waiting: "info",
  lumper_rc_missing_billed: "warning",
  lumper_billing_gap: "warning",
};

/** The word on the bell for several loads, per alert: "Revised RC missing on 4 loads". */
const BELL_PHRASE: Record<LumperReminderAlert, string> = {
  lumper_rc_waiting: "Revised RC missing",
  lumper_rc_missing_billed: "Invoiced without the revised RC",
  lumper_billing_gap: "Lumper not billed in full",
};

/**
 * Which reminder a case is in, from D-LRC4's "who is reminded" column; null for the states nobody is
 * reminded about (RC received, billed with the RC on file, closed, charge removed).
 *
 * `factsCurrent` (Q-LRC9): false when the last sweep did not carry the order — it is older than the
 * read's 90 days, so its paid and billed facts are frozen at the last read that did. The two revised-RC
 * reminders still go: whether the RC is on file is 360's own fact and never goes stale. The billing-gap
 * one does not: a re-bill after the order left the window would not reach 360, and telling accounting
 * every morning to re-bill a load they already re-billed is the false alarm that teaches people to
 * ignore the reminder. The page still lists such a case, marked with the day its facts are from.
 */
export function lumperReminderAlertFor(state: LumperCaseState, factsCurrent: boolean): LumperReminderAlert | null {
  switch (state) {
    case "waiting_for_rc":
      return "lumper_rc_waiting";
    case "billed_no_rc":
      return "lumper_rc_missing_billed";
    case "billed_without_lumper":
    case "billed_short":
      return factsCurrent ? "lumper_billing_gap" : null;
    default:
      return null;
  }
}

export interface LumperReminderCase {
  orderId: string;
  state: LumperCaseState;
  customerName: string | null;
  consigneeCity: string | null;
  consigneeState: string | null;
  paidAmount: number;
  paidAt: string | null;
  chargeAmount: number;
  billedAmount: number;
  shortAmount: number;
}

const usd = (n: number): string => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
/** McLeod's dates are calendar days sent as midnight `Z`: shown from their first ten characters. */
const day = (v: string | null): string | null => (v ? formatDisplayDate(v.slice(0, 10)) : null);

/**
 * One load, one line, for the email, the text and the case list: the order, the broker, what and when we
 * paid, where it delivered, and — for a billing gap — what the invoice carried. The order number leads
 * because it is what billing and dispatch type into McLeod.
 */
export function lumperReminderLine(c: LumperReminderCase): string {
  const paid = c.paidAmount > 0 ? `paid ${usd(c.paidAmount)}${day(c.paidAt) ? ` on ${day(c.paidAt)}` : ""}` : `keyed ${usd(c.chargeAmount)}, payment not recorded yet`;
  const town = [c.consigneeCity, c.consigneeState].filter(Boolean).join(", ");
  const parts = [`Order ${c.orderId}`, c.customerName, paid, town || null];
  if (c.state === "billed_without_lumper") parts.push("invoiced with no lumper");
  if (c.state === "billed_short") parts.push(`invoiced ${usd(c.billedAmount)}, ${usd(c.shortAmount)} short`);
  return parts.filter((p): p is string => !!p).join(" · ");
}

/** The bell's title for one person's loads in one alert, and the note when McLeod has not been read lately. */
export function lumperReminderBellTitle(alert: LumperReminderAlert, loads: number, staleSince: string | null): string {
  const base = `${BELL_PHRASE[alert]} on ${loads} ${loads === 1 ? "load" : "loads"}`;
  return staleSince ? `${base} (McLeod last read ${formatDisplayDate(staleSince)})` : base;
}

/**
 * The connector reads McLeod every hour; past this, the reminder says the list may be out of date
 * (plan §4, "the reminder says so when it is older than a day"). A day plus two missed reads.
 */
export const LUMPER_SWEEP_STALE_HOURS = 26;

/** The time of the last sweep when it is older than the limit, else null. */
export function lumperSweepStaleSince(sweptAt: string | null, now: Date): string | null {
  if (!sweptAt) return null;
  return now.getTime() - Date.parse(sweptAt) > LUMPER_SWEEP_STALE_HOURS * 3_600_000 ? sweptAt : null;
}

/** The dedupe keys: one bell per person per alert per day; one email or text line per case per day. */
export const lumperBellKey = (alert: LumperReminderAlert, onDay: CalendarDay): string => `lumper:${alert}:${onDay}`;
export const lumperLineKey = (alert: LumperReminderAlert, onDay: CalendarDay, caseId: string): string => `lumper:${alert}:${onDay}:${caseId}`;
