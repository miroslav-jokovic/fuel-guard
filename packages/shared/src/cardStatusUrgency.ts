import { wallClockInZone } from "./calendarDay.js";

/**
 * Which card status changes are worth an immediate message (Q-F3, owner's ruling 2026-10-06; F02-F04
 * PLAN.md chunk 3a). Every change still writes its audit row; this only decides who is interrupted.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
 * The status poll sent one message per change to every fuel manager: 1,422 in 30 days. Measured
 * 2026-10-07, 237 of 245 changes fell Monday–Friday, 7 am–6 pm Central, and none was FRAUD. They are
 * people in the office working in the WEX portal, so a message telling the office what the office just
 * did is noise. A change nobody in the office could have made — at night, at a weekend — or one that
 * names FRAUD is the one somebody must see now. The daytime changes go into one daily summary (3b).
 *
 * ⚠ OFFICE HOURS ARE NOT `organizations.operating_hours`. That column is when the TRUCKS run, read by
 * the off-hours fueling rule; its default is 05:00–20:00 with no weekdays, and the real fleet's is
 * 00:00–00:00 ("24/7", `isOffHours`). Read as office hours it would make every change an office-hours
 * change and send nothing. Only the zone is taken from it (`organizationTimezone`).
 */
export const OFFICE_HOURS = {
  /** Monday to Friday, as `Date.getUTCDay()` numbers them. */
  weekdays: [1, 2, 3, 4, 5] as readonly number[],
  /** Minutes after local midnight: 07:00 inclusive to 18:00 exclusive. */
  startMinute: 7 * 60,
  endMinute: 18 * 60,
};

/** Was `at` inside office hours, on the org's clock? */
export function isOfficeHours(at: Date, timeZone: string): boolean {
  const clock = wallClockInZone(at, timeZone);
  // The weekday of the LOCAL calendar date, not of the UTC instant: 22:00 Friday in Chicago is
  // already Saturday in UTC.
  const weekday = new Date(Date.UTC(clock.year, clock.month - 1, clock.day)).getUTCDay();
  const minute = clock.hour * 60 + clock.minute;
  return OFFICE_HOURS.weekdays.includes(weekday) && minute >= OFFICE_HOURS.startMinute && minute < OFFICE_HOURS.endMinute;
}

/** Either side names FRAUD — EFS spells it `FRAUD`, `Fraud`, or inside a longer status. */
export const isFraudStatusChange = (from: string, to: string): boolean => /fraud/i.test(from) || /fraud/i.test(to);

/** Send it now, or leave it for the daily summary. */
export function cardStatusChangeIsUrgent(change: { from: string; to: string; at: Date; timeZone: string }): boolean {
  return isFraudStatusChange(change.from, change.to) || !isOfficeHours(change.at, change.timeZone);
}
