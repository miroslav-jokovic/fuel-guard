/**
 * The financial sweep's calendar arithmetic, pure and testable (D-FIN4, FINANCE-GO-LIVE-PLAN §1.4).
 *
 * Split out of agent.mjs on 2026-09-03 so it can be tested without importing the agent, which
 * connects to SQL Server at import. Two rules live here, and both were untested until now:
 *
 *   1. THE TRAILING WINDOW. Every run re-reads a trailing number of days ending tomorrow (so today's
 *      accruals are inside). It was 45 days against a McLeod entry lag the owner measures at about
 *      a month — a late journal entry older than the window was never seen again. It is 75 by
 *      default now: the lag plus a margin.
 *   2. THE HARDENING PASS. On the first three days of a month the window is extended back to the
 *      first day of the month BEFORE LAST, so the two previous calendar months are re-read WHOLE,
 *      every column, every table. That is D-MC14's "periodic full-period reconciliation" with a
 *      date on it, and it is what lets the monthly close (D-FIN14) call a month hardened: the
 *      sweep has read it again after McLeod finished posting it. `--harden` forces the same pass
 *      on any day, for the first live weeks when it runs daily.
 *
 * Dates are calendar days in UTC here, as they are throughout the agent (the org time zone is
 * D-FIN9's step, not this one); a window is half-open [start, end).
 */

/** YYYY-MM-DD of a Date's UTC calendar day. */
export const ymd = (d) => d.toISOString().slice(0, 10);

/** First day of the month `offset` months from `d`'s month (offset −2 = the month before last). */
export function firstOfMonth(d, offset = 0) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + offset; // may go negative; Date.UTC normalises
  return ymd(new Date(Date.UTC(y, m, 1)));
}

/** Every calendar month [first, first-of-next) that [windowStart, windowEnd) touches. */
export function monthsTouching(windowStart, windowEnd) {
  const months = [];
  let [y, m] = windowStart.split("-").map(Number);
  for (;;) {
    const periodStart = `${y}-${String(m).padStart(2, "0")}-01`;
    if (periodStart >= windowEnd) break;
    m === 12 ? ((y += 1), (m = 1)) : (m += 1);
    months.push({ periodStart, periodEnd: `${y}-${String(m).padStart(2, "0")}-01` });
  }
  return months;
}

export const HARDEN_ON_DAYS_OF_MONTH = [1, 2, 3];
export const HARDEN_MONTHS_BACK = 2;

/**
 * The window one run sweeps. Returns `{ windowStart, windowEnd, hardening }`; `hardening` is true
 * when the start was pulled back to cover the two previous months whole.
 */
export function financialWindow({ now = new Date(), trailingDays = 75, harden = false } = {}) {
  const end = new Date(now.getTime() + 86_400_000); // tomorrow, so today's accruals are inside
  const trailingStart = ymd(new Date(end.getTime() - trailingDays * 86_400_000));
  const hardening = harden || HARDEN_ON_DAYS_OF_MONTH.includes(now.getUTCDate());
  const hardenedStart = firstOfMonth(now, -HARDEN_MONTHS_BACK);
  const windowStart = hardening && hardenedStart < trailingStart ? hardenedStart : trailingStart;
  return { windowStart, windowEnd: ymd(end), hardening };
}
