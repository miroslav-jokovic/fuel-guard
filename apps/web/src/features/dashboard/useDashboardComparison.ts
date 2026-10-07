/**
 * The previous window's figures, for the delta pills (DR2b, D-DR12; FLEET-OVERVIEW-REDESIGN-PROPOSAL
 * D-FO3 and D-FO11).
 *
 * ── D-FO11: A SECOND CLIENT FETCH, NOT A SERVER AGGREGATE ────────────────────────────────────────
 * D-DR12 named the choice — "one more round trip or a server-side aggregate is DR2b's first
 * decision" — and this is the round trip. Reasons, in order: the endpoint already answers any
 * window, so there is no API change and nothing to hold behind a release; the previous window is
 * HISTORY, so it is cached hard (`staleTime` ten minutes, no refetch interval) where the live
 * window polls every two minutes; and the summary and fleet-MPG queries are keyed on their inputs,
 * so every widget that asks for the comparison shares one request between them, exactly as
 * `fleetWidgetData.ts` already relies on for the current window.
 *
 * ⚠ The cost is real and is why this is its own composable rather than a flag on `useDashboard`:
 * `/api/dashboard` is the heaviest read on the site (the 2026-10-06 audit measured it at the
 * centre of the event-loop freezes that `claude/api-event-loop-freeze` fixed the same day), and
 * this doubles its calls per RANGE CHANGE, not
 * per render. If that ever shows in the request metrics, the fix is a server aggregate that reads
 * `previousWindow` from `@silvicom/shared` — the arithmetic is already where the API can reach it.
 *
 * ── `enabled` FOLLOWS THE CURRENT WINDOW ─────────────────────────────────────────────────────────
 * The previous summary is useless without the current one, so a caller whose current query is off
 * (a test harness, a tab that never mounted it) should not pay for the comparison either.
 */
import { computed, type Ref, toValue } from "vue";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import { previousWindow, type DashboardSummary, type DayWindow } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { useFleetMpg } from "@/composables/useFleetMpg";
import { dashboardPath, unwrapDashboardResponse, type DashboardEnvelope } from "./useDashboard";

/** History moves only when a late fill or a reconcile lands — minutes, not seconds. */
const PREVIOUS_STALE_MS = 10 * 60_000;

export function useDashboardComparison(range: Ref<DayWindow>) {
  const previousRange = computed(() => previousWindow(range.value));

  const { data: previous, isLoading } = useQuery({
    queryKey: ["dashboard-previous", previousRange],
    staleTime: PREVIOUS_STALE_MS,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<DashboardSummary> =>
      unwrapDashboardResponse(await apiFetch<DashboardEnvelope>(dashboardPath(toValue(previousRange)))),
  });

  /**
   * The previous window's own MPG — the single figure, not the weekly series (D-MPG6: a window's
   * MPG is measured over the window, never averaged from the weeks under it).
   */
  const { data: mpgPrevious } = useFleetMpg(computed(() => ({ ...previousRange.value })));

  return { previousRange, previous, mpgPrevious, isLoading };
}
