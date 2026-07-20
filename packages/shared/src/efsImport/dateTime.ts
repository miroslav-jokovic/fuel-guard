/** EFS date / time-of-day / station-timezone parsing (split from efsImport.ts). */
import type { EfsTimePrecision } from "./types.js";

// ── helpers ───────────────────────────────────────────────────────────────────
export const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

export const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** EFS Tran Date is date-only (no time) — anchor at org-local noon to avoid tz day-flips (docs/08 §4). */
export function efsDateToIso(date: string | null | undefined): string | null {
  const s = str(date);
  if (!s) return null;
  const datePart = s.slice(0, 10); // handles "2026-06-29" and "2026-06-29 07:37:00"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return `${datePart}T12:00:00.000Z`;
}

/** Reject Report has a real timestamp ("YYYY-MM-DD HH:mm:ss"); treat naive time as UTC (deterministic). */
export function rejectDateToIso(date: string | null | undefined): string | null {
  const s = str(date);
  if (!s) return null;
  const iso = s.replace(" ", "T");
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? efsDateToIso(s) : d.toISOString();
}

/** Extract the business date (YYYY-MM-DD, as printed on the report) from an EFS date cell. */
export function efsLocalDate(date: string | null | undefined): string | null {
  const d = str(date);
  if (!d) return null;
  const iso = d.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const m = d.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/); // US M/D/Y
  if (m) {
    const mo = m[1]!.padStart(2, "0");
    const da = m[2]!.padStart(2, "0");
    const yr = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${yr}-${mo}-${da}`;
  }
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

// ── station-local time → UTC ─────────────────────────────────────────────────
// EFS POS timestamps are STATION-LOCAL wall-clock times. Previously they were stored as if they were
// UTC, which mis-dated evening fills and broke time-of-day rules. We convert wall time → UTC using the
// station state's IANA timezone (DST-correct via Intl). Known limitation, documented: states that span
// two zones (TX/KY/TN/ID/…) use their DOMINANT zone — worst case ±1h, absorbed by the wide matching
// windows downstream. When the state is unknown/unmappable we fall back to naive-UTC (deterministic).

const STATE_IANA_TZ: Record<string, string> = {
  // Eastern
  CT: "America/New_York", DE: "America/New_York", FL: "America/New_York", GA: "America/New_York",
  IN: "America/New_York", KY: "America/New_York", MA: "America/New_York", MD: "America/New_York",
  ME: "America/New_York", MI: "America/New_York", NC: "America/New_York", NH: "America/New_York",
  NJ: "America/New_York", NY: "America/New_York", OH: "America/New_York", PA: "America/New_York",
  RI: "America/New_York", SC: "America/New_York", VA: "America/New_York", VT: "America/New_York",
  WV: "America/New_York", DC: "America/New_York", ON: "America/Toronto", QC: "America/Toronto",
  // Atlantic / Newfoundland (Canada)
  NB: "America/Halifax", NS: "America/Halifax", PE: "America/Halifax", NL: "America/St_Johns",
  // Central
  AL: "America/Chicago", AR: "America/Chicago", IA: "America/Chicago", IL: "America/Chicago",
  KS: "America/Chicago", LA: "America/Chicago", MN: "America/Chicago", MO: "America/Chicago",
  MS: "America/Chicago", ND: "America/Chicago", NE: "America/Chicago", OK: "America/Chicago",
  SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", WI: "America/Chicago",
  MB: "America/Winnipeg", SK: "America/Regina",
  // Mountain
  AZ: "America/Phoenix", CO: "America/Denver", ID: "America/Denver", MT: "America/Denver",
  NM: "America/Denver", UT: "America/Denver", WY: "America/Denver", AB: "America/Edmonton",
  // Pacific
  CA: "America/Los_Angeles", NV: "America/Los_Angeles", OR: "America/Los_Angeles",
  WA: "America/Los_Angeles", BC: "America/Vancouver",
  AK: "America/Anchorage", HI: "Pacific/Honolulu",
  NT: "America/Yellowknife", NU: "America/Iqaluit", YT: "America/Whitehorse",
};

/** Dominant IANA timezone for a US state / Canadian province code, or null when unknown. */
export function stateTimeZone(state: string | null | undefined): string | null {
  const s = str(state)?.toUpperCase() ?? null;
  return s ? (STATE_IANA_TZ[s] ?? null) : null;
}

/** Offset (ms) such that wallClock(tz, utcMs) = utcMs + offset. */
function tzOffsetMs(tz: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - utcMs;
}

/**
 * Convert a wall-clock date+time in `tz` to a UTC ISO instant (DST-correct). Two-pass fixpoint:
 * exact except during the 1h spring-forward gap, where it resolves deterministically.
 */
export function zonedWallTimeToUtcIso(ymd: string, hms: string, tz: string): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi, s] = hms.split(":").map(Number);
  const wallMs = Date.UTC(y!, mo! - 1, d!, h ?? 0, mi ?? 0, s ?? 0);
  let utc = wallMs - tzOffsetMs(tz, wallMs);
  utc = wallMs - tzOffsetMs(tz, utc);
  return new Date(utc).toISOString();
}

export interface EfsInstant {
  iso: string;
  precision: EfsTimePrecision;
  /** Station-local business date (YYYY-MM-DD) as printed on the report. */
  tranDate: string;
}

/** True when an ISO instant is exactly the EFS date-only sentinel (noon UTC) → no real time-of-day. */
export function isNoonSentinelIso(iso: string): boolean {
  const d = new Date(iso);
  return (
    d.getUTCHours() === 12 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

/**
 * Parse an EFS date (+ optional POS time, + station state) into a true UTC instant.
 * - date + time + mappable state → station-local wall time converted to UTC ("instant").
 * - date + time, unknown state    → naive-UTC fallback, deterministic ("instant").
 * - date only                     → noon-UTC sentinel ("date"); never fabricates a time-of-day.
 */
export function efsInstant(
  date: string | null | undefined,
  time?: string | null,
  state?: string | null,
): EfsInstant | null {
  const d = str(date);
  if (!d) return null;
  const ymd = efsLocalDate(d);
  if (!ymd) return null;
  // Explicit time column wins; else look for a time embedded in the date string ("… 14:25:00").
  const embedded = d.match(/\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?/);
  const hms = parseEfsTime(time) ?? (embedded ? parseEfsTime(embedded[0]) : null);
  if (!hms) return { iso: `${ymd}T12:00:00.000Z`, precision: "date", tranDate: ymd };
  const tz = stateTimeZone(state);
  const iso = tz ? zonedWallTimeToUtcIso(ymd, hms, tz) : `${ymd}T${hms}.000Z`;
  return { iso, precision: "instant", tranDate: ymd };
}

/**
 * Combine a date + optional time into an ISO instant. Handles "YYYY-MM-DD" and US "M/D/YYYY", and
 * times "HH:MM[:SS]" / "H:MM[:SS] AM|PM" / "HHMMSS". A naive time is treated as UTC (deterministic).
 * Date-only → anchored at noon. Prefer `efsInstant` (station-timezone-aware) for new code.
 */
export function efsDateTimeToIso(date: string | null | undefined, time?: string | null): string | null {
  return efsInstant(date, time, null)?.iso ?? null;
}

/** Parse an EFS POS time into "HH:MM:SS" (24h). Finds a time inside longer strings (e.g. a full
 *  timestamp in a "Time" column). Null when absent/unparseable. */
export function parseEfsTime(time: string | null | undefined): string | null {
  const t = str(time);
  if (!t) return null;
  const m = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (m) {
    let h = parseInt(m[1]!, 10);
    const ap = m[4]?.toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
  }
  if (/^\d{4,6}$/.test(t)) return `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6) || "00"}`; // "1425"/"142500"
  return null;
}
