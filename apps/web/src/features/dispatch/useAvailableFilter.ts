import { computed, type ComputedRef } from "vue";
import { knownCityPoints, type DispatchBoardRow } from "@silvicom/shared";
import type { UrlQueryState } from "@silvicom/ui";
import type { AvailableFilter } from "./dispatchBoardView";

/**
 * The board's "available near" filter in the URL (DISPATCH-BOARD-V2-PLAN D-DBV3): State, Near a city
 * within a radius, and Free within N hours — so "trucks free in Florida within a day" is a link and a
 * saved view like every other filter here.
 *
 * ── A CITY IS FOUND ON THE BOARD'S OWN ROWS ──────────────────────────────────────────────────────
 * No geocoder is bought for v1 (§3.1): Near offers every city a delivery or a truck position names
 * (`knownCityPoints`). A link naming a city no row names any more (that load delivered) falls back to
 * the city's state, and `nearFellBack` lets the page say so rather than show a silently wider list.
 */
export const RADIUS_OPTIONS = [
  { value: "50", label: "50 mi" },
  { value: "100", label: "100 mi" },
  { value: "150", label: "150 mi" },
  { value: "250", label: "250 mi" },
];
export const DEFAULT_RADIUS = "100";
export const WITHIN_OPTIONS = [
  { value: "", label: "Any time" },
  { value: "0", label: "Free now" },
  { value: "12", label: "Within 12 h" },
  { value: "24", label: "Within 24 h" },
  { value: "48", label: "Within 48 h" },
  { value: "72", label: "Within 72 h" },
];

/**
 * `stateCounts` is a getter: the page counts states over the rows every OTHER filter admits
 * (`stateCounts` in `dispatchBoardView`, Q-DBV9), and that filter includes this one's Near and Free.
 */
export function useAvailableFilter(qs: UrlQueryState, rows: ComputedRef<readonly DispatchBoardRow[]>, stateCounts: () => ReadonlyMap<string, number>) {
  const states = computed({
    get: () => qs.list("state").map((s) => s.toUpperCase()),
    set: (v: string[]) => qs.set({ state: v.length ? v.join(",") : undefined }),
  });
  const near = qs.param("near");
  const radius = qs.param("radius", RADIUS_OPTIONS.map((o) => o.value), DEFAULT_RADIUS);
  const within = qs.param("within", WITHIN_OPTIONS.map((o) => o.value).filter(Boolean));

  const points = computed(() => knownCityPoints(rows.value));

  /**
   * Every state a truck is free in, with how many choosing it would show — the dispatchers' "States
   * (34)", as a filter. A chosen state stays listed at 0, so it can be unticked.
   */
  const stateOptions = computed(() => {
    const count = new Map(stateCounts());
    for (const s of states.value) if (!count.has(s)) count.set(s, 0);
    // The figure in the select's count column, not the label (FilterSelect `count`), as the Dispatcher's.
    return [...count.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([s, n]) => ({ value: s, label: s, count: n.toLocaleString("en-US") }));
  });
  const cityOptions = computed(() => [
    { value: "", label: "Anywhere" },
    ...[...points.value.entries()]
      .map(([key, p]) => ({ value: key, label: `${p.city}, ${p.state}` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ]);

  const nearPoint = computed(() => (near.value ? (points.value.get(near.value) ?? null) : null));
  /** The link's city is on no row; its state stands in for it. */
  const nearFellBack = computed(() => Boolean(near.value) && !nearPoint.value);

  const filter = computed<AvailableFilter>(() => {
    const fallbackState = nearFellBack.value ? near.value.split("|")[1] : undefined;
    return {
      states: fallbackState ? [...new Set([...states.value, fallbackState])] : states.value,
      near: nearPoint.value ? { lat: nearPoint.value.lat, lng: nearPoint.value.lng, radiusMiles: Number(radius.value) } : null,
      withinHours: within.value === "" ? null : Number(within.value),
    };
  });

  /** How many of these narrow the board, for FilterBar's count; the radius only refines Near. */
  const activeCount = computed(() => [states.value.length > 0, Boolean(near.value), within.value !== ""].filter(Boolean).length);
  const clear = { state: undefined, near: undefined, radius: undefined, within: undefined };

  return { states, near, radius, within, stateOptions, cityOptions, filter, nearFellBack, activeCount, clear };
}
