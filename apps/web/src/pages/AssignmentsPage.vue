<script setup lang="ts">
import { computed, watch } from "vue";
import type { DispatchBoardRow } from "@silvicom/shared";
import {
  AppCallout,
  AppTabs,
  AppButton as BaseButton,
  FilterBar,
  DataWorkspace,
  useQueryState,
  SORT_DIRECTIONS,
  useUrlSort,
  sortRows,
} from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import ColumnPicker from "@/components/ui/ColumnPicker.vue";
import SavedViewMenu from "@/components/ui/SavedViewMenu.vue";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useSavedViewMenu } from "@/composables/useSavedViewMenu";
import { useTableColumns } from "@/composables/useTableColumns";
import { formatDateTime } from "@/lib/format";
import AssignmentHistory from "@/features/dispatch/AssignmentHistory.vue";
import DispatchBoardTable from "@/features/dispatch/DispatchBoardTable.vue";
import DispatchTruckDrawer from "@/features/dispatch/DispatchTruckDrawer.vue";
import { censusSelectOptions, censusValue, pickOf, truckCensusItems } from "@/features/dispatch/censusItems";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { dispatcherOptions, useScopeChoice } from "@/features/dispatch/dispatchScope";
import { RADIUS_OPTIONS, WITHIN_OPTIONS, useAvailableFilter } from "@/features/dispatch/useAvailableFilter";
import { useDispatchBoardQuery } from "@/features/dispatch/useDispatchBoard";
import {
  BOARD_COLUMNS,
  BOARD_COLUMNS_ID,
  BOARD_DEFAULT_SORT,
  BOARD_LIVE_COLUMNS,
  BOARD_QUEUES,
  BOARD_SORT_KEYS,
  BOARD_TABLE,
  BOARD_TABS,
  boardSortValue,
  filterBoard,
  rowsBeforeScope,
  stateCounts,
  type BoardQueue,
} from "@/features/dispatch/dispatchBoardView";

/**
 * Dispatch → Dispatch board (DISPATCH-BOARD-PLAN.md, D-DB2). It was the Assignments page — one row per
 * DRIVER with a duty badge up to six hours old — and is now one row per TRUCK: who drives it and how
 * long they may, where it is, what it hauls, whether it will make its appointment, where and when it
 * empties, and what it hauls next. The path stays `/assignments` so bookmarks keep working (Q-DB5).
 *
 * ── TWO PAGES, ONE QUESTION EACH (D-DB5) ─────────────────────────────────────────────────────────
 * This page answers "what do my trucks need from me now"; the Loads page answers "what is the state of
 * this order". So there is no Uncovered list here — a load with no truck has no row on a truck board,
 * and the board LINKS to the Loads page's Uncovered queue rather than keeping a second list of it.
 *
 * ── MY FLEET IS A FILTER, NOT A PERMISSION (D-DB1, D-DB3) ────────────────────────────────────────
 * Every truck arrives; the server says which are the caller's (their McLeod fleets, plus any truck on a
 * load they dispatch). A caller no McLeod login is linked to opens on All, and the page says why rather
 * than showing an empty "My fleet" that reads as "nothing of mine needs me".
 *
 * ── ONE LIST PATTERN WITH THE LOADS PAGE (owner, 2026-10-10) ─────────────────────────────────────
 * The queues are tabs with their counts, as Loads' are, and History is the last tab, as Exceptions is
 * there: a different feed at the end of the strip, never a second strip above it. Search, scope, the
 * queue, the sort and the open truck all live in the URL (`useQueryState`), so back, refresh and a
 * pasted link reopen the same board. Fleet and Dispatched by are primary filters, so they show their
 * value in their own trigger and add no chip (contract §5.5 rules 3 and 5).
 *
 * The History tab is the L5 attribution trail, unchanged.
 *
 * ── V2: THE DISPATCHERS' OWN QUESTION FIRST (DISPATCH-BOARD-V2-PLAN, ruled 2026-10-16) ───────────
 * Tested with the dispatchers on 2026-10-15: "a lot of information, a little bit confusing". Their own
 * board answers one question — when and where each truck is free — so this one now opens on it: sorted
 * by Available, seven columns, two queues (Needs a load retired 2026-10-20, DISPATCH-LOADS-COUNTS-PLAN). Trucks per dispatcher are counted in the Dispatcher
 * select, which is also the scope control (D-DBV2; a strip of buttons until Q-DBV9), and the toolbar
 * filters by where and when a truck is free (D-DBV3). Dispatched by, the rarer question, is under More.
 *
 * ── EVERY COUNT IS THE ROWS IT WOULD SHOW (Q-DBV9, 2026-10-16) ───────────────────────────────────
 * A Dispatcher or State option's number is taken over the rows every OTHER filter admits, so choosing
 * it shows that many trucks. The first cut counted every row the board returned: AL said 8 and showed
 * none, because the table was on one fleet.
 *
 * ── THE DRAWER IS IN THE URL (DB6) ───────────────────────────────────────────────────────────────
 * A row opens its truck's drawer, and `?truck=773` opens it from anywhere — the Loads page's truck
 * links here that way (D-DB6 point 4), so a load's truck is one click from its board row. The query
 * holds the UNIT, which is what a person reads and a link can be written with; the drawer resolves it
 * against the polled board each minute, so it never shows a truck as it was when it opened.
 */
const { zone } = useOrgTimezone();
const qs = useQueryState();
const { data: board, isLoading, isError, refetch, isFetching } = useDispatchBoardQuery();

const HISTORY = "history";
const tab = computed({
  get: () => qs.one("queue") ?? "all",
  set: (v: string) => qs.set({ queue: v === "all" ? undefined : v }),
});
const queue = computed<BoardQueue>(() => (BOARD_QUEUES.find((q) => q.value === tab.value)?.value ?? "all"));

const scope = computed(() => board.value?.scope ?? { linked: false, fleetCodes: [], dispatcherIds: [] });
const { choice: scopeChoice } = useScopeChoice(computed(() => scope.value.linked), qs);

const search = qs.param("search");
const fleet = qs.param("fleet");
const dispatcher = qs.param("dispatcher");
const rows = computed(() => board.value?.rows ?? []);
// The State options count over `stateCountsNow`, defined below with the filter it leaves State out of.
const avail = useAvailableFilter(qs, rows, () => stateCountsNow.value);
/**
 * FilterBar's "Clear filters": where-and-when, Dispatched by and the search narrow the board. The census
 * choice (a fleet, Mine or All) and the queue tab choose WHICH board it is, and the sort and an open
 * truck are not filters, so clearing keeps them.
 */
const activeFilterCount = computed(() => [search.value.trim(), dispatcher.value].filter(Boolean).length + avail.activeCount.value);
const clearFilters = (): void => qs.set({ search: undefined, dispatcher: undefined, ...avail.clear });
const { sort, onSort } = useUrlSort(qs.param("sort", BOARD_SORT_KEYS, BOARD_DEFAULT_SORT), qs.param("dir", SORT_DIRECTIONS));

/**
 * Which columns show (`useTableColumns`): a hidden list in `?hide=`, with this browser's own choice as
 * the default, so a long-haul planner can drop Empties and a local one Next stop without either
 * losing the column for the other. The truck stays; it is the row's name.
 */
const boardColumns = useTableColumns(BOARD_COLUMNS_ID, () => BOARD_COLUMNS, { defaultHidden: BOARD_LIVE_COLUMNS });
/**
 * Saved views: a name and this page's URL — queue, scope, fleet, dispatcher, search, sort and hidden
 * columns — so "late trucks in VINNIEV, by appointment" is one click. Applying one is a navigation,
 * the same as following a link (`useSavedViewMenu`).
 */
const viewMenu = useSavedViewMenu(BOARD_TABLE, "board");

const fleets = computed(() => board.value?.fleets ?? []);
const fleetOwner = (code: string | null) => board.value?.fleets.find((f) => f.code === code)?.dispatcherId ?? null;

const now = computed(() => (board.value ? new Date(board.value.generatedAt) : new Date()));
const base = computed(() => ({
  mine: scopeChoice.value === "mine", fleet: fleet.value, dispatcher: dispatcher.value, search: search.value, available: avail.filter.value,
}));
const boardFilter = computed(() => ({ ...base.value, queue: queue.value }));
const filtered = computed(() => filterBoard(rows.value, scope.value, boardFilter.value, now.value));
const stateCountsNow = computed(() => stateCounts(rows.value, scope.value, boardFilter.value, now.value));
/** Mine's count is the table's under Mine, the same filter run, so the two cannot disagree. */
const mineCount = computed(() =>
  scope.value.linked ? filterBoard(rows.value, scope.value, { ...boardFilter.value, mine: true, fleet: "" }, now.value).length : null,
);
const census = computed(() =>
  truckCensusItems(rowsBeforeScope(rows.value, scope.value, boardFilter.value, now.value), mineCount.value, board.value, scopeChoice.value, fleet.value),
);
const whose = computed({
  get: () => censusValue(census.value),
  set: (key: string) => {
    const pick = pickOf(census.value, key);
    if (pick) qs.set({ scope: pick.scope, fleet: pick.fleet || undefined });
  },
});
const sorted = computed(() => sortRows(filtered.value, sort.value, boardSortValue));

/**
 * The board pages (D-US8): 197 active trucks in production were one table on 2026-10-13, and the owner
 * named this board as the list nobody could reach the bottom of. Twenty a page, like every client-paged
 * list, and the page is in the URL (`?page=`, D-US2) so Back from a load's page returns to page 3.
 *
 * A filter, the scope or the queue tab starts again at page 1 — watched, not derived from the rows, so
 * the board's minute poll never throws a pasted `?page=2` away. The sort keeps the page, as a sort does
 * everywhere else. And when a narrower set leaves the reader past its last page (a truck left the queue
 * between two polls), the page is pulled back to the last one rather than showing an empty table.
 */
const PAGE_SIZE = 20;
const page = qs.page();
// The where-and-when filter by value: it is rebuilt on every URL write, and its identity would loop.
watch([search, fleet, dispatcher, () => qs.one("scope"), queue, () => JSON.stringify(avail.filter.value)], () => (page.value = 1));
watch(
  () => filtered.value.length,
  (n) => {
    const last = Math.max(1, Math.ceil(n / PAGE_SIZE));
    if (board.value && page.value > last) page.value = last;
  },
);
const pageRows = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const tabItems = computed(() => [
  ...BOARD_QUEUES.filter((q) => BOARD_TABS.includes(q.value) || q.value === queue.value).map((q) => ({
    value: q.value,
    label: q.label,
    badge: board.value ? filterBoard(rows.value, scope.value, { ...base.value, queue: q.value }, now.value).length : undefined,
  })),
  { value: HISTORY, label: "History" },
]);

const openUnit = computed(() => qs.one("truck") ?? null);
const openRow = computed(() => (openUnit.value ? (rows.value.find((r) => r.unitNumber === openUnit.value) ?? null) : null));
const openTruck = (row: DispatchBoardRow) => qs.set({ truck: row.unitNumber });
const closeTruck = () => qs.set({ truck: undefined });

const at = (iso: string | null | undefined) => formatDateTime(iso, "—", zone.value);
const description = computed(() => {
  if (tab.value === HISTORY) return "Who held which truck and trailer, and when. The attribution trail behind every evidence panel.";
  const hos = board.value?.hosAsOf ? ` HOS as of ${at(board.value.hosAsOf)}.` : "";
  return `When and where every truck is next free, soonest first.${hos}`;
});
/** Chips mirror only the `#more` filters (contract §5.5 rule 6). */
const moreChips = computed(() => [
  ...(avail.near.value ? [{ key: "radius", label: "Within", value: `${avail.radius.value} mi` }] : []),
  ...(dispatcher.value ? [{ key: "dispatcher", label: "Dispatched by", value: dispatcherOptions(board.value).find((o) => o.value === dispatcher.value)?.label ?? dispatcher.value }] : []),
]);
const removeChip = (key: string) => qs.set(key === "radius" ? { radius: undefined } : { dispatcher: undefined });

const emptyText = computed(() =>
  rows.value.length === 0 ? "No trucks on the roster yet." : "No trucks match these filters.",
);
</script>

<template>
  <div class="space-y-6">
    <PageHeader :description="description" />

    <!-- Scrollable for the same reason as Loads' strip: eight tabs do not fit a phone. -->
    <AppTabs v-model="tab" :tabs="tabItems" label="Dispatch board queue" />

    <AssignmentHistory v-if="tab === HISTORY" />

    <template v-else>
      <AppCallout v-if="board && !scope.linked" tone="info">
        Showing every truck. Your account is not linked to a McLeod dispatcher yet. An admin links it
        in Settings → McLeod fleets, and the board then opens on your fleet.
      </AppCallout>

      <AppCallout v-if="avail.nearFellBack.value" tone="info">
        No truck is free in that city any more, so the board shows its whole state instead.
      </AppCallout>

      <DataWorkspace>
        <FilterBar
          v-model:search="search"
          embedded
          search-placeholder="Search truck, driver, trailer, load, city, ZIP…"
          :count="filtered.length"
          count-label="trucks"
          :active-count="activeFilterCount"
          :more-count="(dispatcher ? 1 : 0) + (avail.near.value ? 1 : 0)"
          :chips="moreChips"
          @remove="removeChip"
          @clear-all="clearFilters"
        >
          <template #filters>
            <FilterSelect v-model="whose" label="Dispatcher" :options="censusSelectOptions(census)" />
            <FilterSelect v-model="avail.states.value" label="State" :options="avail.stateOptions.value" multiple />
            <FilterSelect v-model="avail.near.value" label="Near" :options="avail.cityOptions.value" />
            <FilterSelect v-model="avail.within.value" label="Free" :options="WITHIN_OPTIONS" />
          </template>
          <!-- Secondaries (contract §5.5 rule 3): how far "near" reaches, and who is moving the load —
               the second axis of D-DB1, asked less often than whose fleet a truck is in. -->
          <template #more>
            <FilterSelect v-model="avail.radius.value" label="Within" :options="RADIUS_OPTIONS" block />
            <FilterSelect v-model="dispatcher" label="Dispatched by" :options="dispatcherOptions(board)" block />
          </template>
          <template #actions>
            <BaseButton
              v-if="board && board.uncoveredCount > 0"
              variant="link"
              :to="{ name: 'loads', query: { queue: 'uncovered', scope: 'all' } }"
              class="text-sm font-medium"
            >
              {{ board.uncoveredCount }} uncovered {{ board.uncoveredCount === 1 ? "load" : "loads" }} →
            </BaseButton>
            <SavedViewMenu
              :built-ins="viewMenu.builtIns"
              :views="viewMenu.views.value"
              :current-query="viewMenu.currentQuery.value"
              :active-name="viewMenu.activeName.value"
              :busy="viewMenu.busy.value"
              @apply="viewMenu.apply"
              @save="viewMenu.save"
              @remove="viewMenu.remove"
            />
            <ColumnPicker :columns="boardColumns" />
          </template>
        </FilterBar>

        <DispatchBoardTable
          :rows="pageRows"
          :columns="boardColumns.visible.value"
          :loading="isLoading"
          :error="isError ? 'Could not load the dispatch board.' : null"
          :retrying="isFetching"
          :empty-text="emptyText"
          :zone="zone"
          :fleets="fleets"
          :fleet-owner="fleetOwner"
          :sort="sort"
          :now="now"
          :page="page"
          :page-size="PAGE_SIZE"
          :total="filtered.length"
          @update:page="page = $event"
          @retry="refetch"
          @open="openTruck"
          @sort="onSort"
        />
      </DataWorkspace>

      <DispatchTruckDrawer :row="openRow" :zone="zone" :fleets="fleets" @close="closeTruck" />
    </template>
  </div>
</template>
