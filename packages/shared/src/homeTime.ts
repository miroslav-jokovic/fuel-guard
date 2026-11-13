/**
 * Home time's rules, pure (`docs/plans/dispatch-loads/HOME-TIME-PLAN.md` §3, step HT2).
 *
 * Every verdict about a period — its state, what the board says about it, whether it holds the truck —
 * is decided HERE, once. The API composes with these and the screens draw the result; neither restates
 * a threshold or a comparison. All inputs are instants, so a clock change moves nothing (plan §4).
 */
import type { HomeTimeChip, HomeTimeDisposition, HomeTimeSettings, HomeTimeState } from "./homeTimeContract.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** How far back a period may be started: the dispatcher who forgot to mark it (plan §4). */
export const HOME_TIME_BACKDATE_DAYS = 30;

/** The times a period's state is read from. */
export interface HomeTimeTimes {
  startAt: string;
  expectedReturnAt: string;
  endAt: string | null;
  canceledAt: string | null;
}

/** Still open: neither ended nor canceled. The one-live-period rule (D-HT3) counts exactly these. */
export const isHomeTimeLive = (p: Pick<HomeTimeTimes, "endAt" | "canceledAt">): boolean =>
  p.endAt === null && p.canceledAt === null;

/**
 * The period's state at `now` (D-HT2). Canceled before ended: a canceled row keeps a null `endAt`, and
 * a reader that looked at the end first would call a mistake "still home".
 */
export function homeTimeState(p: HomeTimeTimes, now: Date): HomeTimeState {
  if (p.canceledAt !== null) return "canceled";
  if (p.endAt !== null) return "ended";
  const t = now.getTime();
  if (Date.parse(p.startAt) > t) return "scheduled";
  return Date.parse(p.expectedReturnAt) <= t ? "overdue" : "active";
}

/** The driver is away now: the period has started and nobody has closed it. */
export const isHomeNow = (state: HomeTimeState): boolean => state === "active" || state === "overdue";

/**
 * Why a new period, or a new return time, is refused before it is written; null when it may be. The
 * form and the API both ask this, so the form says it without a round trip and the API cannot be
 * talked past it.
 */
export function homeTimeTimesRefusal(times: { startAt: string; expectedReturnAt: string }, now: Date): string | null {
  const start = Date.parse(times.startAt);
  const back = Date.parse(times.expectedReturnAt);
  if (!Number.isFinite(start) || !Number.isFinite(back)) return "Enter a date and time";
  if (back <= start) return "The return must be after the start";
  return homeTimeStartRefusal(times.startAt, now) ?? homeTimeReturnRefusal(times.expectedReturnAt, now);
}

/** A start may be entered late, but only so far back (`HOME_TIME_BACKDATE_DAYS`). */
export function homeTimeStartRefusal(startAt: string, now: Date): string | null {
  return Date.parse(startAt) < now.getTime() - HOME_TIME_BACKDATE_DAYS * DAY_MS
    ? `Home time can start at most ${HOME_TIME_BACKDATE_DAYS} days back`
    : null;
}

/** A return time is a promise about the future: one already passed is refused when it is entered. */
export function homeTimeReturnRefusal(expectedReturnAt: string, now: Date): string | null {
  return Date.parse(expectedReturnAt) <= now.getTime() ? "That return time has passed" : null;
}

/** Has the truck been with its driver past the carrier's limit (D-HT12)? Counted from the start, in whole 24-hour days. */
export function truckPastLimit(
  p: { startAt: string; disposition: HomeTimeDisposition },
  state: HomeTimeState,
  settings: Pick<HomeTimeSettings, "truckLimitDays">,
  now: Date,
): boolean {
  return p.disposition === "with_driver" && isHomeNow(state) && now.getTime() - Date.parse(p.startAt) >= settings.truckLimitDays * DAY_MS;
}

/**
 * What the Warnings cell says about one seat's period (D-HT11), most pressing first. `availableSaysIt`
 * is true when the row's Available cell already reads "Home until …" (`homeTimeHold`): the plain
 * "home" chip is then left out, so one fact is not printed twice on one row.
 */
export function homeTimeChips(
  p: { startAt: string; expectedReturnAt: string; disposition: HomeTimeDisposition },
  state: HomeTimeState,
  settings: Pick<HomeTimeSettings, "returnDueHours" | "truckLimitDays">,
  now: Date,
  availableSaysIt: boolean,
): HomeTimeChip[] {
  if (state === "scheduled") return ["scheduled"];
  if (!isHomeNow(state)) return [];
  const chips: HomeTimeChip[] = [];
  if (state === "overdue") chips.push("overdue");
  if (truckPastLimit(p, state, settings, now)) chips.push("truck_limit");
  if (state === "active") {
    const dueSoon = Date.parse(p.expectedReturnAt) - now.getTime() <= settings.returnDueHours * HOUR_MS;
    if (dueSoon) chips.push("return_due");
    else if (!availableSaysIt) chips.push("home");
  }
  return chips;
}

/** The two a dispatcher must act on: they set the row's `homeTimeUrgent` flag and count as Needs attention. */
export const homeTimeChipUrgent = (chip: HomeTimeChip): boolean => chip === "overdue" || chip === "truck_limit";

/**
 * Does home time hold this truck, and until when (D-HT10)? Only when EVERY seat is home now and the
 * truck is with one of them: a team truck with one seat home still runs, and a truck left at the yard
 * is free for another driver. `seats` has one entry per seat the truck has — null for a seat that is
 * not home — so a truck with no driver is never held. The later return decides.
 */
export function homeTimeHold(
  seats: ReadonlyArray<{ state: HomeTimeState; disposition: HomeTimeDisposition; expectedReturnAt: string } | null>,
): { until: string } | null {
  if (seats.length === 0) return null;
  const home: { disposition: HomeTimeDisposition; expectedReturnAt: string }[] = [];
  for (const s of seats) {
    if (!s || !isHomeNow(s.state)) return null;
    home.push(s);
  }
  if (!home.some((s) => s.disposition === "with_driver")) return null;
  return { until: home.reduce((a, s) => (Date.parse(s.expectedReturnAt) > Date.parse(a) ? s.expectedReturnAt : a), home[0]!.expectedReturnAt) };
}

const STATE_ORDER: Record<HomeTimeState, number> = { overdue: 0, active: 1, scheduled: 2, ended: 3, canceled: 3 };

/**
 * The Home time tab's order (D-HT8): overdue first, then who is home, then who is scheduled, each by
 * the return time, soonest first; closed periods last, newest first.
 */
export function compareHomeTimes(
  a: { state: HomeTimeState; expectedReturnAt: string; startAt: string },
  b: { state: HomeTimeState; expectedReturnAt: string; startAt: string },
): number {
  const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
  if (byState !== 0) return byState;
  if (STATE_ORDER[a.state] === 3) return Date.parse(b.startAt) - Date.parse(a.startAt);
  return Date.parse(a.expectedReturnAt) - Date.parse(b.expectedReturnAt);
}
