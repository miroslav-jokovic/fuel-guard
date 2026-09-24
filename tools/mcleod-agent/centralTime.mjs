/**
 * McLeod's clock → an instant. The ONE place a McLeod time is given a time zone (LOADS-MIRROR-PLAN.md
 * §4, LR3).
 *
 * McLeod stores `datetime`: a wall-clock reading with no offset. At this carrier it is Central time —
 * the server itself reported `2026-09-24T12:30:18-05` while the dispatch board showed the same hour.
 * The statements hand every time over as `CONVERT(varchar(19), <col>, 126)`, i.e. the string
 * `2026-09-30T17:00:00`, precisely so that nothing between SQL Server and this function can guess a
 * zone for it (the `mssql` driver, given a raw `datetime`, reads it as UTC by default).
 *
 * ⚠ The bug this exists to end, measured 2026-09-24: the load feed posted those strings bare, and
 * Postgres read a zoneless string as UTC. Order 0135527's second stop is 17:00 Central in McLeod and
 * was stored as 17:00 UTC — twelve noon Central, five hours early on every appointment in production,
 * six after the November change. The same shape as `weather_cache`'s `raw + "Z"` (NaN on every row):
 * a time zone decided by accident rather than by anybody.
 *
 * DST is Intl's, not ours: the offset is read for the instant itself, so 2026-11-01 and 2027-03-14 need
 * no table. Two wall times are not a single instant, and what happens to them is pinned by tests:
 *   · the repeated hour (01:00–01:59 on the first Sunday of November) resolves to the FIRST pass, CDT;
 *   · the skipped hour (02:00–02:59 on the second Sunday of March) cannot be a Central reading at all
 *     and resolves an hour back, to CST. McLeod accepting one would be a data-entry slip; it is kept
 *     rather than refused, because refusing a stop would drop a real load from the board.
 */

export const TIME_ZONE = "America/Chicago";

/** The offset, in ms, of `tz` from UTC at instant `t`. */
export function tzOffset(t, tz = TIME_ZONE) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(t))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** The UTC instant (epoch ms) of a wall-clock reading in `tz`. Two passes settle a DST boundary. */
export function zonedToUtc(year, month, day, hour, minute = 0, second = 0, tz = TIME_ZONE) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = guess - tzOffset(guess, tz);
  return guess - tzOffset(first, tz);
}

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

/**
 * `2026-09-30T17:00:00` (Central, as McLeod stored it) → `2026-09-30T22:00:00.000Z`.
 *
 * Null and the empty string are "McLeod has no time here" and stay null. Anything else that is not
 * exactly the zoneless shape above THROWS: a value that already carries `Z` or an offset means a
 * statement stopped converting to varchar and something upstream has picked a zone, and converting it
 * again would move it by five hours without a word.
 */
export function centralToIso(wall) {
  if (wall == null || wall === "") return null;
  const m = WALL.exec(String(wall));
  if (!m) throw new Error(`centralToIso: expected a zoneless McLeod time like 2026-09-30T17:00:00, got ${JSON.stringify(wall)}`);
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return new Date(zonedToUtc(y, mo, d, h, mi, s)).toISOString();
}
