/**
 * ISO-week boundaries (Mon–Sun by default) in a given IANA timezone, plus the UTC window strings used for
 * Samsara API calls (pure, §3.1). Reuses the tenant's tz machinery (zonedWallTimeToUtcIso) so week edges
 * line up with how the rest of the app treats local time.
 */
import { zonedWallTimeToUtcIso } from "../efsImport/index.js";

export interface WeekWindow {
  /** Local calendar dates (YYYY-MM-DD) for the week. */
  weekStart: string;
  weekEnd: string;
  /** UTC ISO instants: [windowStartIso, windowEndIso) covers the whole local week (end is exclusive). */
  windowStartIso: string;
  windowEndIso: string;
}

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function localYmd(ms: number, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** The week containing `nowMs`, in `tz`. `weekStartsOn`: 1 = Monday (ISO), 0 = Sunday. */
export function weekWindow(nowMs: number, tz: string, weekStartsOn = 1): WeekWindow {
  const { y, m, d } = localYmd(nowMs, tz);
  const anchor = Date.UTC(y, m - 1, d); // date-only anchor (midnight UTC) for pure calendar math
  const dow = new Date(anchor).getUTCDay(); // 0=Sun..6=Sat
  const offset = (dow - weekStartsOn + 7) % 7;
  const startMs = anchor - offset * DAY;
  const weekStart = fmt(new Date(startMs));
  const weekEnd = fmt(new Date(startMs + 6 * DAY));
  const nextStart = fmt(new Date(startMs + 7 * DAY));
  return {
    weekStart,
    weekEnd,
    windowStartIso: zonedWallTimeToUtcIso(weekStart, "00:00:00", tz),
    windowEndIso: zonedWallTimeToUtcIso(nextStart, "00:00:00", tz),
  };
}

/** The `n` most-recent weeks (index 0 = current), stepping back cleanly from each week's start. */
export function recentWeeks(nowMs: number, tz: string, n: number, weekStartsOn = 1): WeekWindow[] {
  const out: WeekWindow[] = [weekWindow(nowMs, tz, weekStartsOn)];
  for (let i = 1; i < n; i++) {
    const [yy, mm, dd] = out[i - 1]!.weekStart.split("-").map(Number);
    const prevMs = Date.UTC(yy!, mm! - 1, dd!) - 7 * DAY + 12 * 3_600_000; // noon of 7 days prior (tz-edge safe)
    out.push(weekWindow(prevMs, tz, weekStartsOn));
  }
  return out;
}
