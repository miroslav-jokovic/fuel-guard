/**
 * EFS timestamps are Central Time — always.
 *
 * The vendor guide is explicit on both halves of this and both bite:
 *   • "All of our servers are central time." (p10)
 *   • Datetime fields are ISO 8601 `yyyy-mm-ddThh:mm:ss-zz:zz`, timezone optional (p11).
 *
 * A timezone-optional ISO string from a Central-Time server is the classic silent-corruption shape: a
 * bare `2026-08-10T14:30:00` parsed as UTC lands five or six hours off depending on the month, which
 * renders a fill at the wrong hour and quietly undermines every screen that shows one. The daily
 * session reset "around 3:00 AM CT" (p11) has the same problem from the other direction — computing
 * it with a fixed offset is wrong on one side of each DST boundary.
 *
 * No timezone dependency: `Intl.DateTimeFormat` with an IANA zone is in the Node and browser
 * baselines, and it knows the DST rules. Everything here is pure and side-effect free so both the API
 * and the web app can use one implementation.
 */

export const EFS_TIME_ZONE = "America/Chicago";

export interface EfsWallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

const FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: EFS_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** What an instant looks like on a clock in Central Time. */
export function efsWallClock(at: Date): EfsWallClock {
  const parts: Record<string, string> = {};
  for (const part of FORMATTER.formatToParts(at)) {
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
 * The UTC instant for a Central-Time wall clock.
 *
 * Two-pass fixed point: assume the wall clock IS UTC, look at what that instant actually reads in
 * Chicago, correct by the difference, then repeat once. The second pass is what makes DST land
 * correctly — on the two transition nights a year, the offset at the first guess differs from the
 * offset at the answer, and a single pass would be an hour out.
 *
 * Ambiguous local times (the repeated hour when clocks go back) resolve to the first occurrence.
 * Non-existent ones (the skipped hour in spring) resolve BACKWARD — ask for 02:55 on a night that
 * jumps 02:00 → 03:00 and you get 01:55 CST. That direction is the useful one for the caller that
 * matters: the EFS session boundary. Expiring a token earlier than the vendor's ~03:00 reset costs
 * one extra login a year; expiring later means an operator meets `InvalidClientId` instead.
 */
export function efsWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
): number {
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  let ts = wanted;
  for (let pass = 0; pass < 2; pass++) {
    const seen = efsWallClock(new Date(ts));
    ts += wanted - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second, 0);
  }
  return ts;
}

/** The next occurrence of a Central-Time hour:minute strictly after `now`, as an epoch ms. */
export function nextEfsWallClock(now: Date, hour: number, minute: number): number {
  const today = efsWallClock(now);
  const candidate = efsWallClockToUtc(today.year, today.month, today.day, hour, minute);
  if (candidate > now.getTime()) return candidate;
  const next = efsWallClock(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  return efsWallClockToUtc(next.year, next.month, next.day, hour, minute);
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/**
 * Format an instant the way EFS wants it on the wire: ISO 8601 in Central Time, WITH the offset.
 * Sending the offset explicitly is the whole point — it is the one form the vendor cannot misread,
 * whichever way their parser leans on a bare local timestamp.
 */
export function efsDateTime(at: Date): string {
  const w = efsWallClock(at);
  // Read the local clock AS IF it were UTC and compare to the real instant. (Do NOT use
  // efsWallClockToUtc here: it round-trips back to `at` by construction, so the difference would
  // always be zero and every timestamp would go out claiming +00:00.)
  const offsetMinutes = Math.round(
    (Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, 0) - at.getTime()) / 60_000,
  );
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return (
    `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/**
 * Parse an EFS datetime to an ISO instant.
 *
 * A string carrying its own offset (or a trailing `Z`) is taken at face value. A BARE one is
 * interpreted as Central Time — the guide says the servers are Central and the offset is optional, so
 * "no offset" means "Central", never "UTC". Returns null rather than an Invalid Date so a caller
 * cannot accidentally persist `NaN`.
 */
export function parseEfsDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const withOffset = new Date(text);
    return Number.isNaN(withOffset.getTime()) ? null : withOffset.toISOString();
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (!m) {
    const loose = new Date(text);
    return Number.isNaN(loose.getTime()) ? null : loose.toISOString();
  }
  const ts = efsWallClockToUtc(
    Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? "0"),
  );
  return Number.isNaN(ts) ? null : new Date(ts).toISOString();
}
