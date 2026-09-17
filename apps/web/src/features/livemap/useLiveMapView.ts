import { computed, ref, type ComputedRef, type Ref } from "vue";
import type { LiveMapVehicle, VehicleMapState } from "@silvicom/shared";
import { useLiveMapBoard } from "./useLiveMapBoard";
import {
  MAP_STATES,
  STATE_LABEL,
  EMPTY_FILTERS,
  filterVehicles,
  stateCounts,
  type LiveMapFilters,
} from "./liveMapLayer";

/**
 * Everything the live map knows that is NOT a layout (DESIGN-REFRESH-2026-09.md §4, D-DR5).
 *
 * ── WHY THIS EXISTS: THE BOARD NOW HAS TWO SHAPES, NOT TWO HOMES ─────────────────────────────────
 * `LiveMapPanel` already had two homes — `/live-map` and the Dashboard's Dispatch tab (D-DW5) — and
 * one shape served both: a vertical document. DR5 gives the PAGE a second shape, a full-bleed
 * workspace with floating panels, and the dashboard widget keeps the document, because a widget that
 * floated panels over a card inside a grid would be a workspace in a 400px box.
 *
 * Two shapes is the moment the state has to leave the template. Filters, selection, the census and
 * the two different empty sentences are the same decisions in both, and a second copy of them is
 * what this repo's register calls a workaround with a delay fuse — it would be one wrong empty
 * message, or one filter that cleared in only one of the two, away from being visible.
 *
 * ⚠ What is NOT here: anything that only one shape can answer. The map instance, the fly-to and the
 * panel open/closed set belong to their own component, because a document has no floating panels and
 * a workspace has no card around its canvas.
 */
export interface LiveMapView {
  board: ReturnType<typeof useLiveMapBoard>;
  filters: Ref<LiveMapFilters>;
  /** Which truck the reader has opened, in whichever surface opened it. `null` is "none". */
  selectedId: Ref<string | null>;
  vehicles: ComputedRef<LiveMapVehicle[]>;
  filtered: ComputedRef<LiveMapVehicle[]>;
  counts: ComputedRef<Record<VehicleMapState, number>>;
  selected: ComputedRef<LiveMapVehicle | null>;
  /** The status filter's options, with the census in the labels. */
  stateOptions: ComputedRef<{ value: string; label: string }[]>;
  /** The state filter as `FilterSelect` wants it — a plain string array, both ways. */
  stateFilter: Ref<string[]>;
  emptyText: ComputedRef<string>;
  errorMessage: ComputedRef<string>;
  setSearch: (value: string) => void;
}

/**
 * ⚠ `LIVE_MAP_COLUMNS` WAS HERE AND WENT WITH THE DOCK (D-DR25). It described a seven-column
 * `DataTable` — unit, driver, status, speed, last fix, location, load — shared by the two shapes of
 * this board. There is one shape now (D-DR24) and its fleet list is a 320px rail, where seven columns
 * do not fit and never could: that is D-DR17's lesson, which this programme has now paid for three
 * times. `LiveMapRail` renders rows rather than cells, and the ordering the headers used to offer
 * survives as `sortVehicles` in `liveMapLayer.ts`.
 */

export function useLiveMapView(): LiveMapView {
  const board = useLiveMapBoard();

  const filters = ref<LiveMapFilters>({ ...EMPTY_FILTERS });
  const selectedId = ref<string | null>(null);

  const vehicles = computed<LiveMapVehicle[]>(() => board.data.value?.vehicles ?? []);
  const filtered = computed(() => filterVehicles(vehicles.value, filters.value));
  const counts = computed(() => stateCounts(vehicles.value));
  const selected = computed(
    () => vehicles.value.find((v) => v.vehicleId === selectedId.value) ?? null,
  );

  /**
   * The state filter, with the census in the option labels.
   *
   * ⚠ The dispatcher and load-status filters LM8 first listed are NOT here. `tms_dispatchers` does
   * not exist in this database — it is downstream of the McLeod `VIEW CHANGE TRACKING` grant the
   * carrier has not given — and `loads` holds 0 rows until LM12. An empty dropdown does not read as
   * "not yet"; it reads as "this page is broken", and a dispatcher who concluded that would be right.
   */
  const stateOptions = computed(() =>
    MAP_STATES.map((state) => ({
      value: state as string,
      label: `${STATE_LABEL[state]} (${counts.value[state]})`,
    })),
  );

  const stateFilter = computed<string[]>({
    get: () => [...filters.value.states],
    set: (value) => {
      filters.value = { ...filters.value, states: value as VehicleMapState[] };
    },
  });

  /**
   * Two different empty boards, said differently.
   *
   * "No trucks match these filters" in front of a dispatcher who has set no filters sends them
   * looking for a filter to clear. An empty board before the collector has stored anything is a
   * waiting state, and naming the thing they are waiting for is the difference between the two.
   */
  const emptyText = computed(() =>
    vehicles.value.length === 0
      ? "No truck positions yet. Positions appear within a few minutes of a truck reporting to Samsara."
      : "No trucks match these filters.",
  );

  const errorMessage = computed(() =>
    board.isError.value
      ? (board.error.value as Error | null)?.message ?? "Could not read the live map"
      : "",
  );

  const setSearch = (value: string): void => {
    filters.value = { ...filters.value, search: value };
  };

  return {
    board,
    filters,
    selectedId,
    vehicles,
    filtered,
    counts,
    selected,
    stateOptions,
    stateFilter,
    emptyText,
    errorMessage,
    setSearch,
  };
}
