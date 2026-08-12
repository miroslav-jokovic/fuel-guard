/**
 * One rolling source window for the idle foundation feeds consumed by its derived rollup (the separate
 * learned-envelope history intentionally remains 400 days).
 *
 * WHY (idle precision incident 2026-08-12): the rollup used 35 days while engine/session/HOS sources
 * reconciled 30 days. That left a five-day derived tail which could not converge after source cleanup.
 */
export const IDLE_SOURCE_WINDOW_DAYS = 30;

/** Keep the derived day window stable while a sync/verifier runs across the moving 30-day boundary. */
export function idleCalendarStartIso(endIso: string, days = IDLE_SOURCE_WINDOW_DAYS): string {
  const end = new Date(endIso);
  const exactStart = new Date(end.getTime() - days * 86_400_000);
  return new Date(
    Date.UTC(exactStart.getUTCFullYear(), exactStart.getUTCMonth(), exactStart.getUTCDate()),
  ).toISOString();
}
