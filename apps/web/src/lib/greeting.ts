/**
 * The dashboard's greeting (D-DR14, DESIGN-REFRESH-2026-09.md).
 *
 * Pure and separate from the component for the usual reason — a function that depends on the
 * clock is the one thing a rendered test cannot pin without freezing time, and the boundaries
 * between morning, afternoon and evening are exactly where it will be wrong.
 *
 * ── THE NAME IS OPTIONAL, AND ITS ABSENCE IS NOT AN ERROR ──────────────────────────────────────
 * `session.fullName` comes from `GET /api/me` and is legitimately null: before that call returns,
 * and for a member who has never been given one. "Good morning, null" and "Good morning, " are both
 * worse than "Good morning", so the comma is part of the name branch rather than part of the
 * template. Only the FIRST name is used — the comps show "Good morning, Miki", and a greeting that
 * reads "Good morning, Miroslav Jokovic" is addressing a record, not a person.
 */
export type DayPart = "morning" | "afternoon" | "evening";

/**
 * Local-clock boundaries, deliberately: this greets whoever is reading it, wherever they are, so
 * the browser's own hour is the right input and a UTC hour would greet a night-shift dispatcher in
 * Denver with someone else's afternoon.
 *
 * Midnight–04:59 counts as "evening" rather than gaining a fourth part. Dispatch runs overnight, and
 * a driver manager reading this at 02:00 is finishing a day rather than starting one.
 */
export function dayPart(at: Date): DayPart {
  const hour = at.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

/** "Good morning, Miki" · "Good afternoon" when there is no name to use. */
export function greeting(at: Date, fullName: string | null | undefined): string {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? `Good ${dayPart(at)}, ${first}` : `Good ${dayPart(at)}`;
}
