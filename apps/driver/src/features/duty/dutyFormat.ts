/**
 * Small, pure duty formatters (Phase 3C). Kept out of `useDuty.ts` so they carry no React-Query
 * dependency and can be unit-tested directly.
 */

/**
 * Elapsed on-duty time as a compact label: "6h 12m", "48m", "1h 00m". Returns null for a missing or
 * unparseable start. A clock skew that puts `now` before the start clamps to "0m" rather than showing
 * a negative duration.
 */
export function shiftDurationLabel(startedAtIso: string | null, now: number = Date.now()): string | null {
  if (!startedAtIso) return null;
  const start = new Date(startedAtIso).getTime();
  if (!Number.isFinite(start)) return null;
  const minutes = Math.max(0, Math.round((now - start) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
