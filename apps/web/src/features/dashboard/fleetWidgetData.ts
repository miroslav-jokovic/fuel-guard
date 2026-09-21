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
import { useFleetMpgSeries } from "@/composables/useFleetMpg";
import { useSessionStore } from "@/stores/session";
import { fleetMpgWindowNote, formatDisplayDayShort } from "@silvicom/shared";

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

  const rangeLabel = computed(() => {
    const { from: f, to: t } = range.value;
    return f === t ? labelDay(f) : `${labelDay(f)} – ${labelDay(t)}`;
  });

  return { s, isLoading, isFetching, canSeeMoney, mpgTotal, mpgWeeks, mpgSub, mpgTitle, rangeLabel };
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
