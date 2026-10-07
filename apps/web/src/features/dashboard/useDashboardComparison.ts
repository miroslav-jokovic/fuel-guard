/**
 * The previous window's figures, for the delta pills (DR2b, D-DR12; FLEET-OVERVIEW-REDESIGN-PROPOSAL
 * D-FO3 and D-FO11).
 *
 * ── D-FO11: A SECOND CLIENT FETCH, NOT A SERVER AGGREGATE ────────────────────────────────────────
 * D-DR12 named the choice — "one more round trip or a server-side aggregate is DR2b's first
 * decision" — and this is the round trip. Reasons, in order: the endpoints already answer any
 * window, so there is no API change and nothing to hold behind a release; the previous window is
 * HISTORY, so it is cached hard (`staleTime` ten minutes, no refetch interval) where the live
 * window polls every two minutes; and every query here is keyed on its inputs, so every widget
 * that asks for the comparison shares one request between them, exactly as `fleetWidgetData.ts`
 * already relies on for the current window.
 *
 * ⚠ The cost is real and is why this is its own composable rather than a flag on `useDashboard`:
 * `/api/dashboard` is the heaviest read on the site (the 2026-10-06 audit measured it at the
 * centre of the event-loop freezes that `claude/api-event-loop-freeze` fixed the same day), and
 * this doubles its calls per RANGE CHANGE, not per render. If that ever shows in the request
 * metrics, the fix is a server aggregate that reads `previousWindow` from `@silvicom/shared` —
 * the arithmetic is already where the API can reach it.
 *
 * ── WHAT IS FETCHED, AND WHY EACH ────────────────────────────────────────────────────────────────
 * · the summary — spend, gallons, idle, reefer, declines (the Fuel card and the attention rail);
 * · the fleet-MPG FIGURE — the window's own MPG, never averaged from its weeks (D-MPG6);
 * · the fleet-MPG WEEKS — so the Efficiency card can draw where last period's weeks sat as a quiet
 *   band behind this period's line (D-FO3: the comparison is the chart);
 * · the fuel range totals — fill-ups and miles, for the activity strip's pills. Passed the
 *   calendar days undecorated, as the current window is (D-PREC5).
 */
import { computed, type Ref, toValue } from "vue";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import { previousWindow, type DashboardSummary, type DayWindow } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { useFleetMpg, useFleetMpgSeries } from "@/composables/useFleetMpg";
import { useFuelRangeTotals } from "@/composables/useFuelLog";
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

  const { data: mpgPrevious } = useFleetMpg(computed(() => ({ ...previousRange.value })));
  const { data: mpgPreviousSeries } = useFleetMpgSeries(computed(() => ({ ...previousRange.value, grain: "week" as const })));
  const mpgPreviousWeeks = computed(() => mpgPreviousSeries.value?.periods ?? []);

  const { data: fuelPrevious } = useFuelRangeTotals(computed(() => ({ from: previousRange.value.from, to: previousRange.value.to })));

  return { previousRange, previous, mpgPrevious, mpgPreviousWeeks, fuelPrevious, isLoading };
}
