import { z } from "zod";

/**
 * Do not disturb for office chat notifications (CHAT-WEB-PUSH-PLAN WP5; D-WP13, D-WP14; migration 0603).
 *
 * Per PERSON, not per device: pausing on the PC also quiets the phone. While it holds, no chat line buzzes
 * anywhere — a direct line or a mention alike — and nothing is replayed when it ends: the inbox holds every line.
 * Two halves, either or both:
 *   · a PAUSE until an instant (for an hour, until tomorrow morning) — at most seven days, so a forgotten pause
 *     cannot silence somebody for good;
 *   · a nightly WINDOW in the person's own timezone, wrapping midnight. It is the bell's existing quiet hours
 *     (`notification_preferences`), so it also quiets the bell's non-critical alerts, as it always has.
 *
 * WHETHER IT HOLDS is the database's answer (`person_quiet_at`, read as `quiet_now`), never recomputed from
 * the window here — the only reckoning in this file is when "tomorrow morning" falls, which is a choice the
 * person makes, not a rule.
 */

/** "22:00" — a wall-clock time, 24-hour. */
const wallTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const chatDndStateSchema = z.object({
  /** The pause, while it lasts; null when not paused. */
  paused_until: z.string().nullable(),
  /** The nightly window; both null when there is none. */
  quiet_start: wallTime.nullable(),
  quiet_end: wallTime.nullable(),
  /** The IANA zone the window is read in. */
  timezone: z.string(),
  /** Whether chat notifications are being held back right now (the pause or the window). */
  quiet_now: z.boolean(),
});
export type ChatDndState = z.infer<typeof chatDndStateSchema>;

/** Nothing set: what a person who never touched it has. */
export const CHAT_DND_NONE: ChatDndState = { paused_until: null, quiet_start: null, quiet_end: null, timezone: "UTC", quiet_now: false };

export const CHAT_DND_MAX_PAUSE_DAYS = 7;

export const chatDndPauseRequestSchema = z.object({
  /** Pause until this instant; null resumes now. */
  until: z.iso.datetime({ offset: true }).nullable(),
});
export type ChatDndPauseRequest = z.infer<typeof chatDndPauseRequestSchema>;

export const chatDndScheduleRequestSchema = z
  .object({
    start: wallTime.nullable(),
    end: wallTime.nullable(),
    timezone: z.string().min(1).max(64),
  })
  .refine((s) => (s.start === null) === (s.end === null), "a window needs both a start and an end, or neither")
  .refine((s) => s.start === null || s.start !== s.end, "a window cannot start where it ends");
export type ChatDndScheduleRequest = z.infer<typeof chatDndScheduleRequestSchema>;

/** The default nightly window offered the first time: 10 PM to 7 AM. */
export const CHAT_DND_DEFAULT_WINDOW = { start: "22:00", end: "07:00" } as const;
/** "Until tomorrow morning" means the next 8:00 in the person's zone. */
export const CHAT_DND_MORNING = { hour: 8, minute: 0 } as const;

/** Milliseconds a zone is ahead of UTC at instant `t` (negative west of Greenwich). */
function zoneOffsetMs(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asUtc - Math.floor(t / 1000) * 1000;
}

/**
 * The next instant the wall clock in `timeZone` reads `hour:minute` — later today if that is still ahead,
 * else tomorrow. Correct across a daylight-saving change: the offset is read AT the answer, not now. An
 * unknown zone throws (Intl's RangeError); callers pass the browser's own zone.
 */
export function nextWallClock(now: Date, timeZone: string, hour: number, minute: number): Date {
  const local = new Date(now.getTime() + zoneOffsetMs(now.getTime(), timeZone));
  const ahead = local.getUTCHours() * 60 + local.getUTCMinutes() < hour * 60 + minute;
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + (ahead ? 0 : 1));
  const d = new Date(day);
  const wall = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute);
  let guess = wall - zoneOffsetMs(wall, timeZone);
  guess = wall - zoneOffsetMs(guess, timeZone);
  return new Date(guess);
}
