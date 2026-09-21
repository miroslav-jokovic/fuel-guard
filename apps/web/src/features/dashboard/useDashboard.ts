import { type Ref, toValue } from "vue";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import type { DashboardSummary } from "@silvicom/shared";
import { apiFetch, type ApiResult } from "@/lib/api";

/**
 * The executive dashboard for one window — ONE call (queue item 5 step 4,
 * `docs/plans/fuel/DATA-PRECISION-AUDIT-2026-09-20.md` §7.2c).
 *
 * ── WHAT THIS FILE USED TO BE ───────────────────────────────────────────────────────────────────
 * Ten reads across six modules: fills and idle days each paged 1,000 rows at a time,
 * `declined_transactions` — a sealed raw table — read straight from the browser, a chunked
 * `N × 100` `.in()` loop to attach a driver to every flagged fill, and the org's `operating_hours`
 * fetched inline so the trend could be bucketed in the carrier's own zone. D-PREC8 named that as
 * the architectural root of the audit's date defects: a component that builds its own window cannot
 * see the org's timezone, the station's business date, or how fresh the tables it is dividing are.
 * All three are COLUMNS, and none of them is reachable from here.
 *
 * It is now `GET /api/dashboard`, which measures in SQL (migration 0347), asks `fuel` for the
 * declined count and `idle` for the cost basis through their own module interfaces, and applies the
 * same `summariseDashboard` verdict this file's `aggregateDashboard` call used to. The returned
 * SHAPE is `DashboardSummary`, unchanged — which is what made this a substitution rather than a
 * rewrite: every widget, every test and every snapshot binds to exactly what it bound to before.
 *
 * Measured over 31 days of production data on 2026-09-21: 15 round trips and 1,791 ms became three
 * parallel server-side calls of 302 / 130 / 209 ms, with 2,009 fills and 4,974 idle rows no longer
 * crossing the wire at all.
 *
 * ⚠ The window is two CALENDAR DAYS, `YYYY-MM-DD`, and the API refuses anything else with a 400
 * rather than coercing it (D-PREC5). An instant is what put the viewer's timezone into these
 * figures in the first place, and the picker has always emitted days.
 */
interface DashboardEnvelope {
  ok: boolean;
  data?: DashboardSummary;
  error?: { message?: string };
}

/**
 * The request, as a path. Split out so a test can read it: the two things that can go wrong here —
 * sending an instant instead of a day, or swapping the bounds — are silent, and both are the shape
 * of defect this queue item exists to close.
 */
export function dashboardPath(range: { from: string; to: string }): string {
  return `/api/dashboard?${new URLSearchParams({ from: range.from, to: range.to }).toString()}`;
}

/** The API's standard `{ ok, data }` envelope, inside apiFetch's own result. */
export function unwrapDashboardResponse(res: ApiResult<DashboardEnvelope>): DashboardSummary {
  const body = res.data;
  if (!res.ok || !body?.ok || !body.data) {
    throw new Error(body?.error?.message ?? res.error?.message ?? "Could not load the dashboard");
  }
  return body.data;
}

export function useDashboard(range: Ref<{ from: string; to: string }>) {
  return useQuery({
    queryKey: ["dashboard", range],
    // Reflect background sync + nightly-reconcile results without a manual reload.
    refetchInterval: 120_000,
    // Changing the range keeps the previous frame (dimmed) instead of a skeleton flash.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<DashboardSummary> =>
      unwrapDashboardResponse(await apiFetch<DashboardEnvelope>(dashboardPath(toValue(range)))),
  });
}
