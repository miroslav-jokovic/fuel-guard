/**
 * The store's ONE clock (D-FIN9, FINANCE-GO-LIVE-PLAN §1.9), decided by measurement on 2026-09-03.
 *
 * Three sources kept three clocks: McLeod stamps arrive as local wall time with a `Z` appended,
 * EFS `fueled_at` is a true instant, and API windows are `YYYY-MM-DD` compared at UTC midnight.
 * The plan's first draft said "convert everything to instants in the org zone". Measured against
 * production before doing that: McLeod's accrual, bill and transaction dates are DATE-valued —
 * `2026-07-01T00:00:00` — so treating them as UTC and shifting into America/Chicago would move
 * 890 canonical entries ($1.29M) from the first of a month into the LAST EVENING of the month
 * before. Those rows are already correct: a wall-time date compared with a wall-time window is
 * the carrier's own calendar. Only the true-instant source is wrong, and it is wrong by exactly
 * the org's offset at month edges: 59 EFS fills ($30k) sit in the neighbouring month.
 *
 * So the convention is: **`financial_entries.occurred_at` holds the organisation's local wall-clock
 * time, labelled UTC** — what McLeod has always sent, and what this helper turns an EFS instant
 * into on its way in. Every window in the money store is then a local calendar window by
 * construction, with no per-read conversion to get wrong. The label is documented on the column;
 * a reader that wants the true instant of an EFS fill has `fuel_transactions.fueled_at`.
 *
 * Pure. The zone is the org's `operating_hours.tz` (IANA), read by the caller.
 */
const CACHE = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = CACHE.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    CACHE.set(tz, f);
  }
  return f;
}

/**
 * The wall-clock reading of `instant` in `tz`, written as an ISO string with a `Z` label —
 * `2026-06-30T23:30:00.000Z` for a fill at 23:30 Chicago on June 30 — so it compares as a local
 * calendar value against every other row in the store. Throws on an unknown zone: a wrong clock
 * is worse than a failed projection.
 */
export function localWallClock(instant: string | Date, tz: string): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) throw new Error(`localWallClock: not an instant: ${String(instant)}`);
  const parts = Object.fromEntries(formatter(tz).formatToParts(d).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour; // some engines print 24:00 for midnight
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}.000Z`;
}
