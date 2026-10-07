/**
 * The figures every fleet-tab widget draws from (LM9, D-DW1).
 *
 * ── WHY EACH WIDGET FETCHES FOR ITSELF INSTEAD OF BEING HANDED THE DATA ──────────────────────────
 * A widget the user may hide, reorder or (at LM10) not have at all cannot depend on a parent having
 * already fetched something for it. So every widget calls this, and this calls the composables —
 * which is free: `useDashboard`, `useFleetMpgSeries`, `useFuelRangeTotals` and
 * `useFindingsSummaryQuery` are all keyed on their inputs, so nine callers with the same range share
 * one cache entry and issue one request between them. Verified against the query keys, not assumed.
 *
 * The alternative — provide/inject from the tab — would have made the tab the owner of every
 * widget's data and quietly undone the independence the catalogue exists to buy.
 */
import { computed, type Ref } from "vue";
import { useDashboard } from "./useDashboard";
import { useDashboardComparison } from "./useDashboardComparison";
import { useFleetMpgSeries } from "@/composables/useFleetMpg";
import { useSessionStore } from "@/stores/session";
import { fleetMpgWindowNote, formatDisplayDayShort, periodDelta } from "@silvicom/shared";

export interface FleetRange {
  from: string;
  to: string;
}

/** Human label for the active window, in the picker's own "Jul 1 – Jul 13" style. */
const labelDay = (d: string) => formatDisplayDayShort(d, d);

export function useFleetWidgetData(range: Ref<FleetRange>) {
  const session = useSessionStore();
  /**
   * `canView` and never `session.role`: going through the matrix is what makes an org's sparse
   * section override (D-PERM4) work here without a code change. It is ALSO the widget gate's own
   * answer for the two money widgets — the same fact read twice for two purposes, not two facts.
   */
  const canSeeMoney = computed(() => session.canView("accounting"));

  const { data: s, isLoading, isFetching } = useDashboard(range);
  const { data: fleetMpg } = useFleetMpgSeries(computed(() => ({ ...range.value, grain: "week" as const })));

  /** The window's own figure — NOT the mean of the weeks under it (D-MPG6). */
  const mpgTotal = computed(() => fleetMpg.value?.total ?? null);
  const mpgWeeks = computed(() => fleetMpg.value?.periods ?? []);

  /**
   * What the number is standing on, in the space a tile has. A null mpg carries the service's own
   * `reason`, which is a sentence a fleet manager can act on — a bare dash sends them looking for a
   * bug (D-MPG1).
   */
  const mpgSub = computed(() => {
    const t = mpgTotal.value;
    if (t == null) return "measured miles ÷ fuel";
    if (t.mpg == null) return "not enough measured distance";
    /**
     * ⚠ A PARTIAL window outranks the coverage percentage in the one line a tile has, and that
     * ordering is the finding rather than a preference. Both are true at once and they answer
     * different questions: "97% of fuel measured" is about which TRUCKS are behind the number, and
     * during the 2026-09-13 outage it read 97% while five of the window's thirty days had miles and
     * no gallons at all (D-PREC3). The reader who needs to act needs the dates, not the percentage.
     */
    if (t.partial) return `measured to ${formatDisplayDayShort(t.to, t.to)}`;
    return t.measuredShare == null ? "measured miles ÷ fuel" : `${Math.round(t.measuredShare * 100)}% of fuel measured`;
  });
  /** The hover, which is where the full sentence goes when the tile only had room for the dates. */
  const mpgTitle = computed(() => fleetMpgWindowNote(mpgTotal.value ?? { partial: false, to: "", requestedTo: "" }) ?? mpgTotal.value?.reason ?? undefined);

  const windowLabel = (w: { from: string; to: string }) =>
    w.from === w.to ? labelDay(w.from) : `${labelDay(w.from)} – ${labelDay(w.to)}`;
  const rangeLabel = computed(() => windowLabel(range.value));

  /**
   * ── THE COMPARISON (DR2b, D-FO3) ──────────────────────────────────────────────────────────────
   * Each delta is `null` until both windows have answered, and stays null for a measure the
   * previous window could not give (an MPG withheld for too little measured distance). A null
   * delta draws no pill — never a dash, never a zero — because a pill against an absent number is
   * the thing D-DR12 refused to ship.
   *
   * ⚠ Deliberately NOT derived from `spendTrend`'s own points: the spark is thirty days INSIDE the
   * selected range and a previous-period delta is a different window entirely (Q-DT4's warning).
   *
   * ⚠ No delta for the alert figures. `openAnomalies` and `anomaliesBySeverity` are CURRENT STATE
   * (open now), and "open now vs open a month ago" is a comparison of two snapshots the summary
   * does not take. The previous window's summary carries the same current-state counts, so a delta
   * computed from it would always read flat — a number that looks right and is not.
   */
  const { previousRange, previous, mpgPrevious } = useDashboardComparison(range);
  const previousLabel = computed(() => windowLabel(previousRange.value));
  const deltas = computed(() => ({
    spend: periodDelta(s.value?.totalSpend, previous.value?.totalSpend),
    gallons: periodDelta(s.value?.totalGallons, previous.value?.totalGallons),
    idleHours: periodDelta(s.value?.idleHours, previous.value?.idleHours),
    idleCost: periodDelta(s.value?.idleCostUsd, previous.value?.idleCostUsd),
    reefer: periodDelta(s.value?.reeferSpend, previous.value?.reeferSpend),
    declined: periodDelta(s.value?.declinedCount, previous.value?.declinedCount),
    mpg: periodDelta(mpgTotal.value?.mpg, mpgPrevious.value?.mpg),
  }));

  return {
    s, isLoading, isFetching, canSeeMoney, mpgTotal, mpgWeeks, mpgSub, mpgTitle, rangeLabel,
    previousRange, previousLabel, deltas,
  };
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
