import { computed, type Ref } from "vue";
import { VIOLATION_CATEGORY_NAMES, type DayWindow, type RoadsideRate } from "@silvicom/shared";
import type { CountRow } from "@/components/ui/CountList.vue";
import { useRoadsideSummaryQuery } from "./useRoadsideInspections";

/**
 * The rows of "Roadside inspections", out of the card that draws them — why, in
 * `features/dispatch/useFleetNowRows.ts`.
 *
 * Over the range it is handed (IC16): each row's door opens the Roadside inspections list on that
 * range with the same predicate (D-FM7, D-FM9). The rates are FMCSA's (`roadsideStats.ts`); a rate of
 * no inspections is a dash, never 0% or 100% (US6b F14).
 */
export function useRoadsideRows(range: Ref<DayWindow>) {
  const { data: summary, isError } = useRoadsideSummaryQuery(range);

  const list = (extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ view: "all", from: range.value.from, to: range.value.to, ...extra });
    return `/roadside-inspections?${q.toString()}`;
  };
  const pct = (r: RoadsideRate | undefined) => (r?.share == null ? "—" : `${Math.round(r.share * 100)}%`);
  const ofCaption = (r: RoadsideRate | undefined, what: string) => (r ? `${r.count} of ${r.of} ${what}` : what);

  const rows = computed<CountRow[]>(() => {
    const s = summary.value?.stats;
    const out: CountRow[] = [
      { key: "inspections", label: "Inspections", value: s?.inspections ?? null, caption: "on our FMCSA record", to: list(), door: "Inspections" },
      { key: "clean", label: "Clean", value: s?.clean.count ?? null, display: s ? pct(s.clean) : undefined, caption: ofCaption(s?.clean, "with no violation"), to: list({ clean: "1" }), door: "Clean" },
      {
        key: "vehicle-oos", label: "Vehicle out-of-service rate", value: s?.vehicleOos.count ?? null, display: s ? pct(s.vehicleOos) : undefined,
        caption: ofCaption(s?.vehicleOos, "vehicle inspections"), to: list({ oos: "vehicle", insp: "vehicle" }), door: "Vehicle OOS", alarm: true,
      },
      {
        key: "driver-oos", label: "Driver out-of-service rate", value: s?.driverOos.count ?? null, display: s ? pct(s.driverOos) : undefined,
        caption: ofCaption(s?.driverOos, "driver inspections"), to: list({ oos: "driver", insp: "driver" }), door: "Driver OOS", alarm: true,
      },
      { key: "hazmat-oos", label: "Hazmat out of service", value: s?.hazmatOos ?? null, caption: "inspections with a hazmat order", to: list({ oos: "hazmat" }), door: "Hazmat OOS", alarm: true },
      { key: "points", label: "CSA points added", value: s?.points ?? null, caption: "today's weight of these inspections, verified categories" },
      { key: "needs", label: "Needs action", value: s?.needsAction ?? null, caption: "a repair, a ticket or the driver left", to: list({ view: "needs" }), door: "Needs action", alarm: true },
    ];
    for (const c of s?.topCategories ?? []) {
      out.push({
        key: `category-${c.categoryId}`,
        label: VIOLATION_CATEGORY_NAMES[c.categoryId] ?? `Category ${c.categoryId}`,
        value: c.inspections,
        caption: "inspections with this violation",
        to: list({ category: String(c.categoryId) }),
        door: "Inspections",
      });
    }
    return out;
  });
  return { summary, isError, rows };
}
