<script setup lang="ts">
/**
 * Dispatch → Loads — McLeod's loads, read-only but for Dispatch (LOADS-MIRROR-PLAN.md LR6, LR7).
 *
 * LR6 took out the approval chain (New load, Approval readiness, bulk Approve / Send to driver, the
 * Needs approval default tab). LR7 rebuilt what was left on the owner's 2026-09-23 column list, each
 * column read from core (`loads` / `load_stops`), never from the raw McLeod tables:
 *
 *   Load # (dispatcher beneath) · Status · Driver (truck / trailer beneath) · Pickup ·
 *   Delivery (+ extra stops) · Type · Dispatch
 *
 * The order is not the list's. Walked at 1440 px, ten separate columns needed ~92 rem against the
 * ~69 the table gets beside the sidebar, and Status — the one column a dispatcher reads first — was
 * the one scrolled out of view. So Status comes second; "Truck / Trailer / Driver" is one cell, as
 * the owner's list wrote it; the extra-stops count rides under Delivery ("+1 more stop"); and the
 * dispatcher sits under the load number, with the Dispatcher filter beside it. Measured after the
 * first pass the row menu still ended 42 px past a 1440 px screen, and the menu is where Dispatch is.
 *
 * ⚠ Two columns on that list are NOT here, on purpose. **PU #** needs SELECT on McLeod's
 * `reference_number` (Q-LMR5, granted on the analytics copy first) and `loads.pickup_number` is null
 * on every row until then — a column of dashes is not a column. **BOL on hover** needs `blnum` in
 * core, and today it lives only in raw `mcleod_dispatch_movements`; reading it from here would be
 * exactly the raw access D-SEP1 forbids. Both are recorded in the plan's §8 entry for LR7.
 *
 * Status words come from `loadBoardState` (`@silvicom/shared`), McLeod's own code in the tooltip.
 * Every time is on the CARRIER's clock (`useOrgTimezone`), never the viewer's.
 *
 * ── THE ORDER RECORD BESIDE THE DISPATCH BOARD (DISPATCH-BOARD-PLAN §5.3, DB5b) ────────────────────
 * This page answers "what is the state of this order"; the board answers "what do my trucks need now".
 * They share one scope rule (`admitsScope`, `dispatchScope.ts`) and one on-time verdict, read off the
 * board rather than computed twice (`loadsOnBoard.ts`). A load's truck links to that truck on the board;
 * HOS and GPS are never re-drawn here. DBV7 (Q-DBV6): Dispatch starts hidden, and Delivery carries the
 * board's miles left.
 *
 * ── THE SAME CHOICE, COUNTING THIS LIST (DISPATCH-BOARD-V2-PLAN Q-DBV8, DBV8, Q-DBV9) ─────────────
 * Whose work is the board's Dispatcher select: Mine, All and an entry per fleet, each with its count,
 * and the entry IS the filter (a strip of buttons until Q-DBV9). Here it counts LOADS — the open tab's, under its type and search — never the
 * board's trucks, so a button's number is the rows it shows. A load with no truck yet is "No truck",
 * apart from a truck with no fleet. Dispatched by moved under Filters, as on the board.
 *
 * ── ONE LIST PATTERN WITH THE BOARD (owner, 2026-10-10) ─────────────────────────────────────────
 * One surface (`DataWorkspace`): the toolbar and the table are one card, and the toolbar stays when the
 * tab is Exceptions — same scope, same search, its own count — so switching tabs never moves the page.
 * Every filter, the queue and the sort live in the URL (`useQueryState`). Type and Dispatched by are
 * secondary filters under More, and each shows a chip (contract §5.5).
 *
 * ── DELIVERED, BY DRIVER AND TRUCK, AND WHO HAS NOT HAULED (LOADS-ACTIVITY-PLAN, 2026-10-19) ──────
 * The owner: "keep track if some driver has not picked up or delivered any loads multiple days … on
 * Delivered we need better filtering, per driver and truck." Delivered and All read a window of
 * DELIVERY time (`loadListFilters.ts`, D-LA6), so the browser no longer holds every load since the
 * mirror began. Driver and Truck are exact, and a driver matches either seat of a team (D-LA2).
 * "Delivered" is the last drop's McLeod departure (`loadDeliveredAt`, D-LA1), never the appointment.
 * Who has gone days without a load is the Activity view (`LoadActivityView.vue`, D-LA7, D-LA8): its rows
 * are drivers and trucks, not loads, so it is a view beside the queues, not one of them.
 */
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  type DispatchException,
  EXCEPTION_LABELS,
  boardStops,
  isDispatchable,
  loadBoardState,
  loadTypeOf,
} from "@silvicom/shared";
import { AppCallout, AppSegmentedControl, AppTabs, AppButton as BaseButton, DataTable, DataWorkspace, FilterBar } from "@silvicom/ui";
import { SORT_DIRECTIONS, TablePagination, sortRows, useQueryState, useUrlSort } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useTableColumns } from "@/composables/useTableColumns";
import ColumnPicker from "@/components/ui/ColumnPicker.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import {
  QUEUE_TABS,
  inQueue,
  useExceptionsQuery,
  useLoadsHistoryFrom,
  useLoadsQuery,
  type DispatchLoad,
  type QueueTab,
} from "@/features/dispatch/useDispatchLoads";
import DispatchLoadDrawer from "@/features/dispatch/DispatchLoadDrawer.vue";
import LoadExceptionsTable from "@/features/dispatch/LoadExceptionsTable.vue";
import LoadActivityView from "@/features/dispatch/LoadActivityView.vue";
import { deliveredCell, driverOptions, matchesUnits, truckOptions, useDeliveredWindow, windowWords } from "@/features/dispatch/loadListFilters";
import { DELIVERED_COLUMN, LOAD_COLUMNS, loadSortValue } from "@/features/dispatch/loadListColumns";
import { listSort } from "@/features/dispatch/loadListOrder";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import { dispatchHeadline } from "@/features/dispatch/useLoadDispatch";
import { useDispatchBoardQuery } from "@/features/dispatch/useDispatchBoard";
import { censusSelectOptions, censusValue, loadCensusItems, pickOf } from "@/features/dispatch/censusItems";
import { admitsScope, dispatcherOptions, useScopeChoice } from "@/features/dispatch/dispatchScope";
import { loadsOnBoard } from "@/features/dispatch/loadsOnBoard";
import { loadStopName } from "@/features/dispatch/dispatchBoardView";
import LoadStopCell from "@/features/dispatch/LoadStopCell.vue";
import { TYPE_OPTIONS, TYPE_VALUES, hazmatChipLabel, hazmatTone, matchesType } from "@/features/dispatch/loadType";
import { BADGE_BASE, onTimeBadge, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 20;

const session = useSessionStore();
const router = useRouter();
const qs = useQueryState();
const { zone } = useOrgTimezone();

// Loads or Activity (D-LA8): one page, so the Dispatcher / fleet choice carries across.
const view = qs.param("view", ["loads", "activity"], "loads");
const VIEWS = [{ value: "loads", label: "Loads" }, { value: "activity", label: "Activity" }];
const deliveredWindow = useDeliveredWindow(qs, zone);
const { data: loads, isLoading, isError, refetch, isFetching } = useLoadsQuery(deliveredWindow.instants);
const { data: historyFrom } = useLoadsHistoryFrom(deliveredWindow.instants);
const { data: exceptions, isLoading: exceptionsLoading, isError: exceptionsFailed, refetch: refetchExceptions, isFetching: exceptionsFetching } = useExceptionsQuery();
const { data: board } = useDispatchBoardQuery();

const dispatching = ref<DispatchLoad | null>(null); // LR-D3: the load whose Dispatch drawer is open

const search = qs.param("search");
// `?queue=uncovered` opens on that queue: the dispatch board links here for the loads that have no
// truck, and so no row of their own on a truck board (DISPATCH-BOARD-PLAN D-DB5). Unknown values fall
// back to the first queue, which is also what an absent parameter means.
const tab = computed<QueueTab>({
  get: () => QUEUE_TABS.find((q) => q.value === qs.one("queue"))?.value ?? QUEUE_TABS[0]!.value,
  set: (v) => qs.set({ queue: v === QUEUE_TABS[0]!.value ? undefined : v }),
});

// Whose loads (D-DB3): the board's scope, and the fleet of each load's truck, read off the board.
const scope = computed(() => board.value?.scope ?? { linked: false, fleetCodes: [], dispatcherIds: [] });
const onBoard = computed(() => loadsOnBoard(board.value));
const { choice: scopeChoice } = useScopeChoice(computed(() => scope.value.linked), qs);
const fleet = qs.param("fleet");
const dispatcher = qs.param("dispatcher");
const scopeFilter = computed(() => ({ mine: scopeChoice.value === "mine", fleet: fleet.value, dispatcher: dispatcher.value }));
/**
 * My fleet does not narrow Uncovered: McLeod names no dispatcher on an uncovered load (0 of 32 on
 * 2026-10-09) and it has no truck, so no load there could ever be "mine" — the queue would read empty
 * while the board's link says "32 uncovered". Keyed on the LOAD's queue, not the tab's, so All counts
 * the same uncovered loads the Uncovered tab does. The page says so above that list. Fleet and
 * Dispatched by still apply, and simply match nothing, which is the truth.
 */
const admits = (load: DispatchLoad | undefined, pick: { mine: boolean; fleet: string }): boolean =>
  load
    ? admitsScope(onBoard.value.scopeItem(load), scope.value, {
        fleet: pick.fleet,
        dispatcher: dispatcher.value,
        mine: pick.mine && loadBoardState(load).queue !== "uncovered",
      })
    : !pick.fleet && !dispatcher.value; // an exception with no load: see `scopedExceptions`
const inScope = (load: DispatchLoad): boolean => admits(load, scopeFilter.value);
// One `?page=` (D-US2) for both tables (D-US8): one shows at a time, and a tab change restarts at 1.
const page = qs.page();

/** A time on the carrier's clock. The board is read against McLeod's screen, which is the office's. */
const at = (iso: string | null | undefined): string => formatDateTime(iso, "—", zone.value);

/**
 * "McLeod as of" (plan §5, "Beyond this plan"): until the connector runs on a timer the mirror is only
 * as fresh as its last sync, and the page must say so rather than imply "live". The newest
 * `external_synced_at` the feed wrote is that moment — derived from the rows, not stored beside them.
 */
const syncedAt = computed(() => {
  let newest: string | null = null;
  for (const l of loads.value ?? []) if (l.external_synced_at && (!newest || l.external_synced_at > newest)) newest = l.external_synced_at;
  return newest;
});
// The window is said where the count is read (D-DLC7, D-DLC6): `windowWords`, on the two tabs that hold one.
const headerText = computed(() =>
  (syncedAt.value
    ? `Loads from McLeod as of ${at(syncedAt.value)}. A load reaches a driver only when you dispatch it.`
    : "Loads come from McLeod. A load reaches a driver only when you dispatch it.") +
  (windowed.value ? ` ${windowWords(deliveredWindow.from.value, deliveredWindow.to.value, historyFrom.value ?? null)}` : ""),
);

const typeFilter = qs.param("type", TYPE_VALUES);
const typed = (load: DispatchLoad) => matchesType(load, typeFilter.value);
const driverFilter = qs.param("driver");
const truckFilter = qs.param("truck");
const units = (load: DispatchLoad) => matchesUnits(load, driverFilter.value, truckFilter.value);
/** Delivered and All are the tabs a delivery window bounds (D-LA6). */
const windowed = computed(() => tab.value === "delivered" || tab.value === "all");

const counts = computed(() => {
  const result = Object.fromEntries(QUEUE_TABS.map((q) => [q.value, 0])) as Record<QueueTab, number>;
  for (const load of loads.value ?? []) {
    for (const q of QUEUE_TABS) if (q.value !== "exceptions" && inQueue(load, q.value) && inScope(load)) result[q.value] += 1;
  }
  // The exceptions come from the server feed, not from the loads list — most of its sources exist only
  // as events and are not visible in a load row at all (D-L2) — narrowed by the same scope as the rest.
  result.exceptions = scopedExceptions.value.length;
  return result;
});
// A tab counts only once the read it counts has answered (F13, US6b): on a failed read every tab said 0.
const answered = (q: QueueTab) => (q === "exceptions" ? exceptions.value : loads.value) !== undefined;
/**
 * Exceptions shows only once its feed has a row (D-DLC3): the driver app's declines and amendments
 * had been written 0 times by 2026-10-20, so the tab had read "0" since LR7 — a tab that has never
 * had a row is not shown, as the Dispatch column is not (Q-DBV6). The feed and its route stay; the
 * tab appears with its first exception, and stays while a link has it open.
 */
const tabItems = computed(() =>
  QUEUE_TABS.filter((q) => q.value !== "exceptions" || tab.value === "exceptions" || (exceptions.value?.length ?? 0) > 0)
    .map((q) => ({ value: q.value, label: q.label, badge: answered(q.value) ? counts.value[q.value] : undefined })),
);

/**
 * Exceptions under the page's scope and type, judged on the exception's LOAD. One with no load we hold
 * (a shift that auto-closed names a driver, not a load) belongs to no fleet, so My fleet cannot claim
 * it and All must not drop it: it stays until a Fleet, Dispatched by or Type is chosen, each of which
 * names a property it does not have.
 */
// The loads read is windowed (D-LA6): an exception on a load delivered outside the window finds no
// load here and is scoped as one with none, which is the rule just above. Exceptions are raised on
// open work, so that is the rare case, and a wider window brings the load back.
const loadById = computed(() => new Map((loads.value ?? []).map((l) => [l.id, l])));
const loadOf = (e: DispatchException) => (e.load_id ? loadById.value.get(e.load_id) : undefined);
const exceptionTyped = (e: DispatchException) => (loadOf(e) ? typed(loadOf(e)!) : !typeFilter.value);
const exceptionFound = (e: DispatchException) => {
  const term = search.value.trim().toLowerCase();
  return !term || [e.summary, e.driver_name, e.load_ref, EXCEPTION_LABELS[e.kind]].some((v) => v?.toLowerCase().includes(term));
};
const scopedExceptions = computed(() => (exceptions.value ?? []).filter((e) => exceptionTyped(e) && admits(loadOf(e), scopeFilter.value)));
const filteredExceptions = computed(() => scopedExceptions.value.filter(exceptionFound));

/** The open tab's loads under its type and search, before driver, truck and whose-work. */
const searched = computed(() => {
  const term = search.value.trim().toLowerCase();
  const queue = tab.value;
  if (queue === "exceptions") return [];
  return (loads.value ?? [])
    .filter((load) => inQueue(load, queue))
    .filter(typed)
    .filter((load) => {
      if (!term) return true;
      const { pickup, delivery } = boardStops(load.stops);
      return [load.ref, load.customer_name, load.driver_name, load.co_driver_name, load.vehicle_unit, load.trailer_unit, load.dispatcher_name, load.commodity, loadStopName(pickup), loadStopName(delivery)]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(term));
    });
});
/** ...and under driver and truck: what the census counts. */
const unscoped = computed(() => searched.value.filter(units));
const filtered = computed(() => unscoped.value.filter(inScope));
// Driver and Truck count over what every OTHER filter admits, so an entry's number is the rows it shows.
const unitBase = computed(() => searched.value.filter(inScope));
const driverChoices = computed(() => driverOptions(unitBase.value.filter((l) => matchesUnits(l, "", truckFilter.value))));
const truckChoices = computed(() => truckOptions(unitBase.value.filter((l) => matchesUnits(l, driverFilter.value, ""))));
/**
 * Loads per dispatcher (Q-DBV8): the board's Dispatcher choice, counting this list — on Exceptions, the exceptions,
 * each by its load. Picking one is the census choice; Dispatched by moved under More, as on the board.
 */
const census = computed(() =>
  loadCensusItems(
    tab.value === "exceptions" ? (exceptions.value ?? []).filter((e) => exceptionTyped(e) && exceptionFound(e)).map(loadOf) : unscoped.value,
    admits, scope.value.linked, board.value, scopeChoice.value, fleet.value,
  ),
);
const whose = computed({
  get: () => censusValue(census.value),
  set: (key: string) => {
    const pick = pickOf(census.value, key);
    if (pick) qs.set({ scope: pick.scope, fleet: pick.fleet || undefined });
  },
});
// Type joined Dispatched by under More when Driver, Truck and Delivered took the row (LOADS-ACTIVITY-PLAN
// D-LA6; the toolbar holds four, contract §5.5), so it now shows a chip as a secondary filter does.
const moreChips = computed(() => [
  ...(dispatcher.value ? [{ key: "dispatcher", label: "Dispatched by", value: dispatcherOptions(board.value).find((o) => o.value === dispatcher.value)?.label ?? dispatcher.value }] : []),
  ...(typeFilter.value ? [{ key: "type", label: "Type", value: TYPE_OPTIONS.find((o) => o.value === typeFilter.value)?.label ?? typeFilter.value }] : []),
]);

/**
 * Dispatch starts hidden (Q-DBV6, ruled 2026-10-16): it reports an action used 0 times ever
 * (`load_dispatches` = 0 rows), so it is a column nobody reads. The action stays in the row menu, and
 * the column stays one ColumnPicker click away until the driver app is used for it.
 */
const tableColumns = useTableColumns(
  "dispatch.loads",
  () => (windowed.value ? [...LOAD_COLUMNS.slice(0, 5), DELIVERED_COLUMN, ...LOAD_COLUMNS.slice(5)] : LOAD_COLUMNS),
  { defaultHidden: ["dispatch"] },
);
const nowMs = Date.now();
const sortValue = (load: DispatchLoad, key: string): unknown => loadSortValue(load, key, nowMs);

const { sort: urlSort, onSort } = useUrlSort(
  qs.param("sort", [...LOAD_COLUMNS, DELIVERED_COLUMN].filter((c) => c.sortable).map((c) => c.key)),
  qs.param("dir", SORT_DIRECTIONS),
);
// Each tab opens by its row's own event time until a header is clicked (D-DLC4, `loadListOrder.ts`).
const sort = computed(() => listSort(urlSort.value, tab.value));
const sorted = computed(() => sortRows(filtered.value, sort.value, sortValue));
const pageRows = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const emptyText = computed(() => {
  if ((loads.value ?? []).length === 0) return "No loads yet. They arrive from McLeod on its next sync.";
  return scopeFilter.value.mine ? "No loads in your fleet match. Switch to All to search every load." : "No loads match these filters.";
});


/**
 * FilterBar's "Clear filters": Dispatched by, Type and the search narrow the list in front of you. The
 * queue tab and the census choice (Mine, All or a fleet) do not — they choose WHICH list it is, as on
 * the board, so clearing keeps them.
 */
const activeFilterCount = computed(
  () => [search.value.trim(), dispatcher.value, typeFilter.value, driverFilter.value, truckFilter.value, windowed.value && deliveredWindow.moved.value].filter(Boolean).length,
);
const clearFilters = (): void =>
  qs.set({ search: undefined, dispatcher: undefined, type: undefined, driver: undefined, truck: undefined, ...deliveredWindow.reset() });

// The scope's PARAMETER, not `scopeChoice`, whose default flips when the board arrives and would
// reset a pasted `?page=2`. The clamp follows the table on screen and waits for its feed to arrive.
watch([search, tab, () => qs.one("scope"), fleet, dispatcher, typeFilter, driverFilter, truckFilter, deliveredWindow.instants, view], () => (page.value = 1));
const shownCount = computed(() => (tab.value === "exceptions" ? filteredExceptions.value.length : filtered.value.length));
const shownLoaded = computed(() => Boolean(loads.value && (tab.value !== "exceptions" || exceptions.value)));
watch([shownCount, shownLoaded], ([n, loaded]) => {
  const maxPage = Math.max(1, Math.ceil(n / PAGE_SIZE));
  if (loaded && page.value > maxPage) page.value = maxPage;
});
const exceptionPageRows = computed(() => filteredExceptions.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));


// Opening ONE load is `DispatchLoadDetailPage` — a real page, because a drawer over this list cache
// could not deep-link and went stale with it (LD2).
function openDetail(load: DispatchLoad) {
  void router.push({ name: "load-detail", params: { id: load.id } });
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader :description="headerText" />

    <AppSegmentedControl v-model="view" :options="VIEWS" label="Loads or activity" />

    <template v-if="view === 'activity'">
      <!-- D-LA8: drivers and trucks under the same Dispatcher / fleet choice as the loads. -->
      <DataWorkspace>
        <LoadActivityView :board="board" :admits="(item) => admits(item as DispatchLoad, scopeFilter)" :zone="zone" />
      </DataWorkspace>
    </template>
    <template v-else>
    <!-- The shared strip, scrollable: five queues do not fit a 390 px phone, and the strip scrolling
         inside itself is what keeps the PAGE from scrolling sideways (the LR-D3 walk measured 683 px). -->
    <AppTabs v-model="tab" :tabs="tabItems" label="Load queue" />

    <AppCallout v-if="tab === 'uncovered' && scopeFilter.mine" tone="info">
      Uncovered loads have no dispatcher in McLeod yet, so this queue shows all of them.
    </AppCallout>


    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        :search-placeholder="tab === 'exceptions' ? 'Search what happened, load #, driver…' : 'Search load #, driver, unit, place…'"
        :count="tab === 'exceptions' ? filteredExceptions.length : filtered.length"
        :count-label="tab === 'exceptions' ? 'exceptions' : 'loads'"
        :active-count="activeFilterCount"
        :more-count="moreChips.length"
        :chips="moreChips"
        @remove="(key: string) => qs.set({ [key]: undefined })"
        @clear-all="clearFilters"
      >
        <template #filters>
          <FilterSelect v-model="whose" label="Dispatcher" :options="censusSelectOptions(census)" />
          <!-- D-LA6: carrier days of DELIVERY, on the two tabs that hold delivered loads. -->
          <DateRangeFilter
            v-if="windowed"
            :from="deliveredWindow.from.value"
            :to="deliveredWindow.to.value"
            @update:from="(v) => v && (deliveredWindow.from.value = v)"
            @update:to="(v) => v && (deliveredWindow.to.value = v)"
          />
          <FilterSelect v-if="tab !== 'exceptions'" v-model="driverFilter" label="Driver" :options="driverChoices" />
          <FilterSelect v-if="tab !== 'exceptions'" v-model="truckFilter" label="Truck" :options="truckChoices" />
        </template>
        <template #more>
          <FilterSelect v-model="typeFilter" label="Type" :options="TYPE_OPTIONS" block />
          <FilterSelect v-model="dispatcher" label="Dispatched by" :options="dispatcherOptions(board)" block />
        </template>
        <!-- The loads table's columns; Exceptions is another table, with none to choose. -->
        <template v-if="tab !== 'exceptions'" #actions>
          <ColumnPicker :columns="tableColumns" />
        </template>
      </FilterBar>

      <!-- Exceptions is its own feed, not a filter over the loads list: most of its sources exist only
           as events and have no row on the board at all (D-L2). -->
      <LoadExceptionsTable
        v-if="tab === 'exceptions'"
        :rows="exceptionPageRows"
        :total="filteredExceptions.length"
        :page="page"
        :page-size="PAGE_SIZE"
        :loading="exceptionsLoading"
        :failed="exceptionsFailed"
        :fetching="exceptionsFetching"
        :empty-text="(exceptions ?? []).length ? 'No exceptions match these filters.' : 'Nothing needs attention right now.'"
        :at="at"
        @retry="refetchExceptions"
        @update:page="page = $event"
      />

      <DataTable
        v-else
        :columns="tableColumns.visible.value"
        :rows="pageRows"
        row-key="id"
        :loading="isLoading"
        :error="isError ? 'Could not load the loads.' : null"
        :retrying="isFetching"
        :sort="sort"
        :empty-text="emptyText"
        @sort="onSort"
        @retry="refetch"
        embedded
        @row-click="openDetail"
      >
        <template #cell-ref="{ row }">
          <BaseButton variant="link" :to="{ name: 'load-detail', params: { id: row.id } }" class="font-medium" @click.stop>
            {{ row.ref }}
          </BaseButton>
          <!-- Q-LMR5: under the load number, not a column of its own — LR7 left the row menu 56 px from the
               edge at 1440. Capped, because a table cell grows to its content and `truncate` alone clips
               nothing: uncapped, McLeod's longest name (40 characters) widened this column 119 → 298 px. -->
          <p v-if="row.customer_name" class="mt-1 max-w-32 truncate text-xs text-ink-secondary" :title="row.customer_name">{{ row.customer_name }}</p>
          <p class="truncate text-xs text-ink-muted" :class="row.customer_name ? '' : 'mt-1'" title="Dispatcher in McLeod">{{ row.dispatcher_name ?? "No dispatcher" }}</p>
        </template>
        <template #cell-driver_name="{ row }">
          <p :class="row.driver_name ? 'text-ink' : 'text-ink-tertiary'">{{ row.driver_name ?? "No driver" }}</p>
          <!-- D-LA2: a team's second seat, as McLeod names it. -->
          <p v-if="row.co_driver_name" class="text-xs text-ink-secondary" title="Team driver">+ {{ row.co_driver_name }}</p>
          <p class="text-xs tabular-nums text-ink-muted" title="Truck / trailer">
            <!-- D-DB6 point 4: the truck opens on the Dispatch board, its drawer open; HOS and GPS live there. -->
            <BaseButton
              v-if="row.vehicle_unit"
              variant="link"
              :to="{ name: 'assignments', query: { truck: row.vehicle_unit } }"
              @click.stop
            >{{ row.vehicle_unit }}</BaseButton><template v-else>No truck</template> / {{ row.trailer_unit ?? "no trailer" }}
          </p>
        </template>
        <template v-for="end in ['pickup', 'delivery'] as const" :key="end" #[`cell-${end}`]="{ row }">
          <LoadStopCell
            :stop="boardStops(row.stops)[end]"
            :end="end"
            :extra="boardStops(row.stops).extra"
            :total="row.stops.length"
            :miles-left="onBoard.milesLeftOf(row.id)"
            :zone="zone"
          />
        </template>
        <template #cell-type="{ row }">
          <div class="flex flex-wrap gap-1">
            <span :class="[BADGE_BASE, toneClass(loadTypeOf(row).base === 'Reefer' ? 'info' : 'neutral')]">{{ loadTypeOf(row).base }}</span>
            <!-- H-C1: the hazmat RECORD's state, not just the flag — "not started" is the loud one. -->
            <span v-if="row.hazmat" :class="[BADGE_BASE, toneClass(hazmatTone(row.hazmat_status))]">{{ hazmatChipLabel(row.hazmat_status) }}</span>
          </div>
        </template>
        <template #cell-status="{ row }">
          <div class="flex flex-wrap gap-1">
            <span :class="[BADGE_BASE, toneClass(loadBoardState(row).tone)]" :title="loadBoardState(row).mcleodWords ?? undefined">{{ loadBoardState(row).label }}</span>
            <!-- D-LA5: moved empty, so not a delivery anybody was paid for. -->
            <span v-if="row.loaded === false" :class="[BADGE_BASE, toneClass('neutral')]" title="McLeod has this movement as empty">Empty move</span>
            <!-- D-DB4: the board's verdict for the load a truck is hauling now, the same badge the board shows. -->
            <span v-if="onBoard.onTimeOf(row.id)" :class="[BADGE_BASE, toneClass(onTimeBadge(onBoard.onTimeOf(row.id)!).tone)]">
              {{ onTimeBadge(onBoard.onTimeOf(row.id)!).label }}
            </span>
          </div>
        </template>
        <template #cell-delivered="{ row }">
          <span :class="deliveredCell(row, nowMs).at ? 'tabular-nums' : 'text-ink-tertiary'">{{ at(deliveredCell(row, nowMs).at) }}</span>
          <p v-if="deliveredCell(row, nowMs).ahead" class="text-xs text-warning-700" title="McLeod has this time later than now: it was entered ahead.">Entered ahead in McLeod</p>
        </template>
        <template #cell-dispatch="{ row }">
          <span :class="row.last_dispatch ? 'text-ink-secondary' : 'text-ink-tertiary'">{{ dispatchHeadline(row.last_dispatch) }}</span>
        </template>
        <template #actions="{ row }">
          <KebabMenu>
            <BaseButton v-if="session.can('dispatch') && isDispatchable(row)" class="kebab-item" @click="dispatching = row">Dispatch…</BaseButton>
            <BaseButton class="kebab-item" @click="openDetail(row)">Open details</BaseButton>
          </KebabMenu>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="filtered.length" :loading="isFetching" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
    </template>

    <DispatchLoadDrawer :load="dispatching" @close="dispatching = null" />
  </div>
</template>
