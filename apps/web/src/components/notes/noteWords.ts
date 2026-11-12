import { formatDisplayDate } from "@silvicom/shared";

/**
 * How old a unit's newest note is, in the Notes column (D-UN12): "today", "3 d ago", and past a week
 * the day itself (MM/DD/YYYY) — a week is where "41 d ago" stops being something a reader can place.
 * Whole days, floored, as the applicant board's "Last note" line counts them (`lastNoteLine`), so the
 * office reads one kind of age on both.
 */
export function noteAge(lastAt: string, now: Date = new Date()): string {
  const days = Math.max(0, Math.floor((now.getTime() - Date.parse(lastAt)) / 86_400_000));
  if (days === 0) return "today";
  if (days < 7) return `${days} d ago`;
  return formatDisplayDate(lastAt);
}

export const noteCount = (n: number): string => `${n} ${n === 1 ? "note" : "notes"}`;
