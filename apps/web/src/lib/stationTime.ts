import { stateTimeZone, isNoonSentinelIso } from "@fuelguard/shared";

/**
 * Fueling times must be shown in the STATION's local timezone so they match the printed EFS report. On import,
 * the station-local wall time is converted to UTC using the location's state→timezone (see
 * `zonedWallTimeToUtcIso`), so `fueled_at` is UTC. Formatting it back in the station's zone is the exact inverse
 * of that transform — it reproduces the time the report printed. Showing the raw UTC (a slice of the ISO string)
 * or the viewer's browser time both drift by the timezone offset, which is the bug this fixes.
 *
 * When the state has no timezone mapping, import stored the value as naive-UTC (the printed wall time in the
 * UTC slot), so we render in UTC — again reproducing the printed time.
 */
function tzFor(state: string | null | undefined): string {
  return stateTimeZone(state ?? null) ?? "UTC";
}

/** Time-of-day as 24h "HH:MM" in the station's local timezone. "—" for date-only rows (noon-UTC sentinel). */
export function stationTime(iso: string | null | undefined, state: string | null | undefined): string {
  if (!iso || isNoonSentinelIso(iso)) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tzFor(state), hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

/** Date + time (e.g. "Jun 29, 2026, 14:25") in the station's local timezone. Date-only rows show just the date.
 *  Pass `short` to omit the year (compact tables). */
export function stationDateTime(iso: string | null | undefined, state: string | null | undefined, opts: { short?: boolean } = {}): string {
  if (!iso) return "—";
  const dateOnly = isNoonSentinelIso(iso);
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tzFor(state),
      month: "short",
      day: "numeric",
      ...(opts.short ? {} : { year: "numeric" }),
      ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit", hour12: false }),
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, dateOnly ? 10 : 16).replace("T", " ");
  }
}

/**
 * Format the EFS BUSINESS DATE ("YYYY-MM-DD", station-local calendar date as printed on the report)
 * as "Jun 7, 2026". Constructed and formatted in UTC on purpose: tran_date is a plain calendar date,
 * not an instant, so passing it through a station/browser timezone would drift it a day near midnight
 * (the classic "2026-06-07 → Jun 6" bug). This keeps it byte-for-byte the day EFS printed.
 */
export function businessDate(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(d);
  } catch {
    return ymd;
  }
}

/** Date only, in the station's local timezone (avoids the browser-tz off-by-a-day near midnight). */
export function stationDate(iso: string | null | undefined, state: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tzFor(state), month: "numeric", day: "numeric", year: "numeric" }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}
