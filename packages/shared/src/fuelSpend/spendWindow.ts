/**
 * The reporting window — what it is, what it may be, and what to do with a bad one.
 *
 * ── WHY THIS IS PURE DOMAIN CODE AND NOT UI CONDITIONALS ─────────────────────────────────────────
 * The fuel-spend window lives in the URL, which means anything can put anything in it: a hand-edited
 * link, a stale bookmark, a range somebody typed backwards, a copy of a colleague's URL from a month
 * ago. Before this module the getter did `YMD.test(v) ? v : default` and nothing else, so a window that
 * PARSED but made no sense — `from` after `to`, a range ending in 2031 — sailed through and produced an
 * empty report that looked like a fleet that had bought no fuel. A report that cannot distinguish "no
 * data" from "nonsense input" is the failure this whole page exists to avoid.
 *
 * So normalisation is a function, with tests, and the composable is a thin wrapper over it. Every rule
 * below is one a reader can be told about, because `normalizeWindow` reports what it CHANGED rather
 * than quietly changing it.
 *
 * ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────────────────────────
 * It does not decide how the window is PICKED. That is `DateRangeFilter`'s job, the same control every
 * other page in the app uses, and this module deliberately holds no opinion about it — it validates
 * whatever arrives, from a picker or from a link, and nothing more.
 */

/** A calendar day, `YYYY-MM-DD`. The only date representation this module accepts or returns. */
export type Ymd = string;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse to a UTC instant, or null. Rejects `2026-02-31`, which `new Date()` would happily roll over. */
export function parseYmd(v: unknown): Ymd | null {
  if (typeof v !== "string" || !YMD_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Round-trip check: `new Date("2026-02-31")` yields March 3 rather than throwing, and a window
  // silently moved to a different month is worse than one rejected.
  return d.toISOString().slice(0, 10) === v ? v : null;
}

export const addDays = (ymd: Ymd, n: number): Ymd => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Inclusive day count. A window of one day is 1, not 0 — nobody reports "a 0-day period".
 *
 * ⚠ NOT named `daysBetween`. `anomalyRules/helpers.ts` already exports that name with different
 * semantics (exclusive, and fractional — it divides hours by 24), and the package root star-exports
 * anomalyRules BEFORE fuelSpend. A second `daysBetween` therefore did not collide loudly; it was
 * silently shadowed, and a 7-day preset measured 6 days everywhere outside this module's own tests.
 */
export const windowDays = (from: Ymd, to: Ymd): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export interface SpendWindow {
  from: Ymd;
  to: Ymd;
}

/** Default span: long enough to show a seasonal move and to support a trailing comparison at both ends. */
export const DEFAULT_WINDOW_DAYS = 90;

export const defaultWindow = (today: Ymd): SpendWindow => ({
  from: addDays(today, -(DEFAULT_WINDOW_DAYS - 1)),
  to: today,
});

/** What normalisation had to do. Empty means the input was already a sound window. */
export type WindowFix = "from-invalid" | "to-invalid" | "swapped" | "clamped-future";

export interface NormalizedWindow {
  window: SpendWindow;
  /** Applied fixes, in the order they were applied. The UI is expected to SAY these, not hide them. */
  fixes: WindowFix[];
  /** True when neither end was usable and the default was substituted wholesale. */
  usedDefault: boolean;
}

/**
 * Turn whatever is in the URL into a window that cannot produce a misleading report.
 *
 * Order matters and is deliberate: parse, then swap, then clamp. Swapping BEFORE clamping means a
 * reversed range whose later end is in the future is fixed once rather than twice, and the reader is
 * told about both.
 */
export function normalizeWindow(rawFrom: unknown, rawTo: unknown, today: Ymd): NormalizedWindow {
  const fixes: WindowFix[] = [];
  let from = parseYmd(rawFrom);
  let to = parseYmd(rawTo);

  // A value that was PRESENT but unparseable is a fix worth reporting; one that was simply absent is
  // not — an absent date is the normal case, not a mistake.
  if (rawFrom != null && rawFrom !== "" && from == null) fixes.push("from-invalid");
  if (rawTo != null && rawTo !== "" && to == null) fixes.push("to-invalid");

  if (from == null && to == null) {
    return { window: defaultWindow(today), fixes, usedDefault: true };
  }

  // One end given: the other is inferred rather than defaulted to the full 90 days, because a reader
  // who set an end date meant to bound the window, not to widen it.
  if (from == null) from = addDays(to!, -(DEFAULT_WINDOW_DAYS - 1));
  if (to == null) to = today;

  if (from > to) {
    [from, to] = [to, from];
    fixes.push("swapped");
  }
  if (to > today) {
    to = today;
    if (from > to) from = to;
    fixes.push("clamped-future");
  }
  return { window: { from, to }, fixes, usedDefault: false };
}

/** One sentence a reader can act on, or null when nothing was changed. */
export function describeFixes(fixes: readonly WindowFix[]): string | null {
  if (fixes.length === 0) return null;
  const parts: string[] = [];
  if (fixes.includes("from-invalid") || fixes.includes("to-invalid")) parts.push("a date in the link was not a real date");
  if (fixes.includes("swapped")) parts.push("the start was after the end, so they were swapped");
  if (fixes.includes("clamped-future")) parts.push("the end was in the future, so it was moved to today");
  return `Adjusted: ${parts.join("; ")}.`;
}

/** "Aug 5 – Aug 12" / "Aug 12" — the label the trigger shows. */
export function describeWindow(w: SpendWindow): string {
  const fmt = (d: Ymd) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return w.from === w.to ? fmt(w.from) : `${fmt(w.from)} – ${fmt(w.to)}`;
}
