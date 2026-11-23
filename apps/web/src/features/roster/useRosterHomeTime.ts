import { computed, type Ref } from "vue";
import { HOME_TIME_FILTER_LABELS, HOME_TIME_FILTERS, type Driver, type DriverOverviewRow, type HomeTimeFilter, type HomeTimeState } from "@silvicom/shared";
import { useHomeTimeVisible, useLiveHomeTimes } from "@/components/homeTime/useHomeTime";
import { homeTimeFilterCounts, type RosterRowFilters } from "./rosterRows";

/**
 * Home time on the Drivers list (HOME-TIME-VISIBILITY-PLAN D-HT23, D-HT24): each driver's live period
 * for the Status column's badge, their states for the filter, and the filter's options with the number
 * each would leave. Out of `DriversPage.vue`, which stood at 459 of its 500 lines.
 *
 * Read only for somebody who may read home time (Q-HT9 (a)); for anybody else `visible` is false, the
 * page shows no badge and no filter, and nothing is asked of the API.
 */
export function useRosterHomeTime(home: Ref<string>) {
  const visible = useHomeTimeVisible();
  const { list, byDriver } = useLiveHomeTimes(visible);
  const states = computed<ReadonlyMap<string, HomeTimeState>>(() => new Map([...byDriver.value].map(([id, p]) => [id, p.state])));

  /** "Home now (3)" — counted by the list's own predicate with every other control as set (D-DQ18). */
  function options(drivers: Ref<readonly Driver[]>, overview: Ref<ReadonlyMap<string, DriverOverviewRow>>, filters: Ref<RosterRowFilters>) {
    return computed(() => {
      const counts = list.data.value ? homeTimeFilterCounts(drivers.value, overview.value, filters.value) : null;
      return [
        { value: "", label: "Any" },
        ...HOME_TIME_FILTERS.map((k) => ({ value: k, label: counts ? `${HOME_TIME_FILTER_LABELS[k]} (${counts[k]})` : HOME_TIME_FILTER_LABELS[k] })),
      ];
    });
  }

  /** The filter as the predicate reads it: none for a reader who cannot see home time. */
  const filter = computed(() => (visible.value ? home.value : ""));
  /** The More-filters chip (contract §5.5 rule 6). */
  const chips = computed(() => (filter.value ? [{ key: "home", label: "Home time", value: HOME_TIME_FILTER_LABELS[filter.value as HomeTimeFilter] }] : []));

  return { visible, byDriver, states, filter, chips, options };
}
