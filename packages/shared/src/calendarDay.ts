/**
 * A calendar day is not an instant (D-PREC5, D-PREC6; DATA-PRECISION-AUDIT-2026-09-20 §1).
 *
 * ── THE BUG THIS EXISTS TO RETIRE, MEASURED ────────────────────────────────────────────────────
 * Five web surfaces turned a picked day into an instant the same way:
 *
 *     new Date(`${from}T00:00:00`).toISOString()
 *
 * With no `Z`, that is parsed at **the browser's** midnight and then moved to UTC. Where it lands on
 * an RPC whose parameters are `date`, Postgres casts it straight back to a calendar day — the wrong
 * one. For a Central-time viewer asking for 08/09 → 08/09 on the dashboard's operating card:
 * **104 fills instead of 45, 11,471 gallons instead of 4,788**, on the same card whose neighbouring
 * tiles were right. A viewer east of Greenwich gets the mirror image, a day early.
 *
 * The round trip is the whole defect. A day was never an instant, so nothing is gained by making it
 * one and slicing it back — and two surfaces were doing exactly that (`useIdleBreakdown`'s
 * `rangeBounds` sliced `f.to.slice(0, 10)` off a string the picker had just decorated).
 *
 * ── SO THIS MODULE MAKES THE THREE ANSWERS SEPARATE AND NAMED ──────────────────────────────────
 * There are three legitimate definitions of "a day" in this product, and the audit's finding was not
 * that one of them is wrong — it is that no surface said which one it meant:
 *
 *   1. **the station's business date** — `fuel_transactions.business_date`, a `date` column. A day
 *      here is a day. Pass `YYYY-MM-DD` through untouched; there is no zone to consult and asking
 *      for one is the bug. `dayRangeInstants` is NOT for these.
 *   2. **the carrier's operating day** — for a `timestamptz` column (`anomalies.fueled_at`,
 *      `idle_events.started_at`). A day here is a half-open instant interval in the ORG's zone
 *      (`organizations.operating_hours->>'tz'`), never the viewer's. That is `dayRangeInstants`.
 *   3. **a UTC instant** — what the code above produced by accident, and what nothing should choose
 *      on purpose. There is deliberately no helper for it here.
 *
 * **The rule that decides between them is not taste: it is the COLUMN.** A `date` column takes (1),
 * a `timestamptz` column takes (2). A surface that cannot say which column it is filtering does not
 * yet know what it is asking.
 *
 * ── HALF-OPEN, NOT INCLUSIVE ───────────────────────────────────────────────────────────────────
 * `dayRangeInstants` returns `endExclusive`, so callers write `.lt(col, endExclusive)` rather than
 * `.lte(col, …T23:59:59.999)`. The inclusive form was live in four of the five surfaces with three
 * different precisions between them (`T23:59:59`, `T23:59:59.999`, and one with none), each of which
 * drops a sliver of the last second. A half-open interval cannot express that mistake.
 *
 * ── NO DEPENDENCY ──────────────────────────────────────────────────────────────────────────────
 * `Intl.DateTimeFormat` with an IANA zone is in both the Node and browser baselines and knows the
 * DST rules. `efsTime.ts` proved the two-pass fixed point below against a real vendor clock; this
 * module generalises it to an arbitrary zone and `efsTime.ts` now calls it, so there is one
 * DST-correct implementation rather than two that can drift.
 */

/** A calendar day, `YYYY-MM-DD`. Not an instant, and never to be parsed into one without a zone. */
export type CalendarDay = string;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Is this the `YYYY-MM-DD` shape? Shape only — `2026-02-31` passes and is normalised by the maths. */
export const isCalendarDay = (v: string | null | undefined): v is CalendarDay =>
  typeof v === "string" && DAY_RE.test(v);

/**
 * The leading calendar day of anything day-shaped — `YYYY-MM-DD`, or a timestamp whose date part is
 * already in the zone the caller means. ⚠ It does NOT convert: handing it a `timestamptz` read from
 * Postgres gives you that stamp's UTC day, which is a different question. Use it to UNDECORATE a day
 * that a caller decorated, never to extract a day from an instant.
 */
export const calendarDayOf = (value: string): CalendarDay => value.slice(0, 10);

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

/** One formatter per zone; constructing an `Intl.DateTimeFormat` is the expensive part. */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    FORMATTERS.set(zone, f);
  }
  return f;
}

/** What an instant reads on a clock in `zone`. */
export function wallClockInZone(at: Date, zone: string): WallClock {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(zone).formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Some ICU builds still emit "24" for midnight under hour12:false. Normalise rather than trust it.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * The UTC instant (epoch ms) for a wall clock in `zone`.
 *
 * Two-pass fixed point: assume the wall clock IS UTC, look at what that instant actually reads in the
 * zone, correct by the difference, then repeat once. The second pass is what makes DST land correctly
 * — on the two transition nights a year the offset at the first guess differs from the offset at the
 * answer, and a single pass would be an hour out.
 *
 * Ambiguous local times (the repeated hour when clocks go back) resolve to the first occurrence.
 * Non-existent ones (the skipped hour in spring) resolve BACKWARD. Both matter for a very small
 * number of zones where the transition happens AT midnight — Santiago, Havana, Lord Howe — where the
 * day's first instant is 01:00, not 00:00. Resolving backward gives 23:00 the previous day, which
 * over-covers by an hour rather than dropping one; a range that includes an hour it need not is a
 * wrong count of one hour, where a range that drops one is a wrong count AND a missing row.
 */
export function wallClockToUtc(wc: WallClock, zone: string): number {
  const wanted = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second, 0);
  let ts = wanted;
  for (let pass = 0; pass < 2; pass++) {
    const seen = wallClockInZone(new Date(ts), zone);
    ts += wanted - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second, 0);
  }
  return ts;
}

const pad = (n: number): string => String(n).padStart(2, "0");

const dayOf = (wc: WallClock): CalendarDay => `${wc.year}-${pad(wc.month)}-${pad(wc.day)}`;

/**
 * Today, on a clock in `zone`.
 *
 * ⚠ This is D-PREC6's fix and the reason it is not `new Date().toISOString().slice(0, 10)`. That
 * expression is UTC, so after 19:00 Central the dashboard's default "last 30 days" ran to
 * **tomorrow** and started a day late — which is why the window reproducing the owner's 8.61 MPG was
 * 08/22 – 09/21 rather than 08/21 – 09/20. It was live in three places.
 */
export const todayInZone = (now: Date, zone: string): CalendarDay =>
  dayOf(wallClockInZone(now, zone));

/**
 * `n` days from `day`, as a calendar day. Pure calendar arithmetic through UTC — no zone, because
 * "30 days earlier" is a question about the calendar and not about any clock. Negative goes back.
 */
export function shiftDay(day: CalendarDay, n: number): CalendarDay {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from `from` to `to` inclusive — 1 when they are the same day. Never below 1. */
export function daysInRange(from: CalendarDay, to: CalendarDay): number {
  const at = (day: CalendarDay): number => {
    const [y, m, d] = day.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.max(1, Math.round((at(to) - at(from)) / 86_400_000) + 1);
}

export interface DayRangeInstants {
  /** The first instant of `from`, in `zone`. Compare with `.gte`. */
  start: string;
  /** The first instant of the day AFTER `to`, in `zone`. Compare with `.lt`, never `.lte`. */
  endExclusive: string;
}

/**
 * A picked day range as the half-open instant interval a `timestamptz` column needs, in the CARRIER's
 * zone.
 *
 * Use this and only this when the column is a `timestamptz`. When the column is a `date` — a
 * `business_date`, an `idle_rollup_days.day` — pass the `YYYY-MM-DD` straight through instead: there
 * is no instant in that question and inventing one is the defect this module is named after.
 */
export function dayRangeInstants(
  from: CalendarDay,
  to: CalendarDay,
  zone: string,
): DayRangeInstants {
  const startOf = (day: CalendarDay): string => {
    const [y, m, d] = day.split("-").map(Number) as [number, number, number];
    return new Date(
      wallClockToUtc({ year: y, month: m, day: d, hour: 0, minute: 0, second: 0 }, zone),
    ).toISOString();
  };
  return { start: startOf(from), endExclusive: startOf(shiftDay(to, 1)) };
}

/*
 * ── WHAT THIS MODULE WAS BEFORE QUEUE ITEM 4, KEPT VERBATIM ────────────────────────────────────
 * `exclusiveEnd` lived in `apps/web/src/lib/dateWindow.ts`, whose header explains the rule it exists
 * for: page state holds the INCLUSIVE day a person picked, and the query layer converts it on the way
 * to an API that windows `.gte(from).lt(to)`. That rule has not changed and that file still states
 * it. It moved here because the API came to need the same step — FUEL-P2's decline export windows
 * `declined_transactions` exactly as the Declines tab does, through `efsRejectDayWindow`, and a
 * second implementation of "the day after this one" is a copy of a rule.
 *
 * It is the same idea `dayRangeInstants` above applies to a `timestamptz` column, one level down: a
 * half-open window whose end is the NEXT day. Deliberately NOT re-expressed as `shiftDay(day, 1)` —
 * it has a documented contract about malformed input that `shiftDay` does not make, and its callers
 * rely on it.
 */

/**
 * Turn the inclusive end date a person picked into the exclusive bound a window is built on.
 *
 * Calendar arithmetic in UTC on purpose: `new Date("2026-06-30")` is parsed as UTC midnight, and adding
 * a day there cannot be knocked into the wrong date by a DST transition the way local-time arithmetic
 * can. Only the Y-M-D parts are ever read back out, so UTC is a pure counting frame here, not a
 * timezone claim.
 *
 * Malformed input comes back unchanged rather than becoming a guess — the caller's problem, not this
 * function's to invent.
 */
export function exclusiveEndYmd(inclusive: string): string {
  const day = inclusive.slice(0, 10);
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}
