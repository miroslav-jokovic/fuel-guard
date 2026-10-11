<script setup lang="ts">
import { computed } from "vue";
import type { DispatchBoardRow } from "@silvicom/shared";
import { AppCallout, AppTabs, AppButton as BaseButton } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import ColumnPicker from "@/components/ui/ColumnPicker.vue";
import SavedViewMenu from "@/components/ui/SavedViewMenu.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useQueryState } from "@/composables/useQueryState";
import { useSavedViewMenu } from "@/composables/useSavedViewMenu";
import { useTableColumns } from "@/composables/useTableColumns";
import { SORT_DIRECTIONS, useUrlSort } from "@/composables/useUrlSort";
import { formatDateTime } from "@/lib/format";
import { sortRows } from "@/lib/sort";
import AssignmentHistory from "@/features/dispatch/AssignmentHistory.vue";
import DispatchBoardTable from "@/features/dispatch/DispatchBoardTable.vue";
import DispatchTruckDrawer from "@/features/dispatch/DispatchTruckDrawer.vue";
import DispatchScopeControls from "@/features/dispatch/DispatchScopeControls.vue";
import { useScopeChoice } from "@/features/dispatch/dispatchScope";
import { useDispatchBoardQuery } from "@/features/dispatch/useDispatchBoard";
import {
  BOARD_COLUMNS,
  BOARD_QUEUES,
  BOARD_SORT_KEYS,
  BOARD_TABLE,
  boardSortValue,
  filterBoard,
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
 * ── THE DRAWER IS IN THE URL (DB6) ───────────────────────────────────────────────────────────────
 * A row opens its truck's drawer, and `?truck=773` opens it from anywhere — the Loads page's truck
 * links here that way (D-DB6 point 4), so a load's truck is one click from its board row. The query
 * holds the UNIT, which is what a person reads and a link can be written with; the drawer resolves it
 * against the polled board each minute, so it never shows a truck as it was when it opened.
 */
const { zone } = useOrgTimezone();
const qs = useQueryState();
const { data: board, isLoading, isError, error, refetch, isFetching } = useDispatchBoardQuery();

const HISTORY = "history";
const tab = computed({
  get: () => qs.one("queue") ?? "all",
  set: (v: string) => qs.set({ queue: v === "all" ? undefined : v }),
});
const queue = computed<BoardQueue>(() => (BOARD_QUEUES.find((q) => q.value === tab.value)?.value ?? "all"));

const scope = computed(() => board.value?.scope ?? { linked: false, fleetCodes: [], dispatcherIds: [] });
const { choice: scopeChoice, choose: setScope } = useScopeChoice(computed(() => scope.value.linked), qs);

const search = qs.param("search");
const fleet = qs.param("fleet");
const dispatcher = qs.param("dispatcher");
const { sort, onSort } = useUrlSort(qs.param("sort", BOARD_SORT_KEYS), qs.param("dir", SORT_DIRECTIONS));

/**
 * Which columns show (`useTableColumns`): a hidden list in `?hide=`, with this browser's own choice as
 * the default, so a long-haul planner can drop Empties and a local one Next stop without either
 * losing the column for the other. The truck stays; it is the row's name.
 */
const boardColumns = useTableColumns(BOARD_TABLE, () => BOARD_COLUMNS);
/**
 * Saved views: a name and this page's URL — queue, scope, fleet, dispatcher, search, sort and hidden
 * columns — so "late trucks in VINNIEV, by appointment" is one click. Applying one is a navigation,
 * the same as following a link (`useSavedViewMenu`).
 */
const viewMenu = useSavedViewMenu(BOARD_TABLE, "board");

const rows = computed(() => board.value?.rows ?? []);
const dispatchers = computed(() => board.value?.dispatchers ?? []);
const fleetOwner = (code: string | null) => board.value?.fleets.find((f) => f.code === code)?.dispatcherId ?? null;

const base = computed(() => ({ mine: scopeChoice.value === "mine", fleet: fleet.value, dispatcher: dispatcher.value, search: search.value }));
const filtered = computed(() => filterBoard(rows.value, scope.value, { ...base.value, queue: queue.value }));
const sorted = computed(() => sortRows(filtered.value, sort.value, boardSortValue));
const tabItems = computed(() => [
  ...BOARD_QUEUES.map((q) => ({
    value: q.value,
    label: q.label,
    badge: board.value ? filterBoard(rows.value, scope.value, { ...base.value, queue: q.value }).length : undefined,
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
  return `Every truck, what it is hauling, and whether it will make its appointment.${hos}`;
});
const emptyText = computed(() =>
  rows.value.length === 0 ? "No trucks on the roster yet." : "No trucks match these filters.",
);
</script>

<template>
  <div class="space-y-6">
    <PageHeader :description="description" />

    <!-- Scrollable for the same reason as Loads' strip: eight tabs do not fit a phone. -->
    <AppTabs v-model="tab" :tabs="tabItems" label="Dispatch board queue" scrollable />

    <AssignmentHistory v-if="tab === HISTORY" />

    <template v-else>
      <AppCallout v-if="board && !scope.linked" tone="info">
        Showing every truck. Your account is not linked to a McLeod dispatcher yet. An admin links it
        in Settings → McLeod fleets, and the board then opens on your fleet.
      </AppCallout>

      <DataWorkspace>
        <FilterBar
          v-model:search="search"
          embedded
          search-placeholder="Search truck, driver, load, customer, city…"
          :count="filtered.length"
          count-label="trucks"
        >
          <template #filters>
            <DispatchScopeControls
              v-model:fleet="fleet"
              v-model:dispatcher="dispatcher"
              :board="board"
              :linked="scope.linked"
              :choice="scopeChoice"
              @choose="setScope"
            />
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
          :rows="sorted"
          :columns="boardColumns.visible.value"
          :loading="isLoading"
          :error="isError ? (error instanceof Error ? error.message : 'Could not load the dispatch board') : null"
          :retrying="isFetching"
          :empty-text="emptyText"
          :zone="zone"
          :dispatchers="dispatchers"
          :fleet-owner="fleetOwner"
          :sort="sort"
          @retry="refetch"
          @open="openTruck"
          @sort="onSort"
        />
      </DataWorkspace>

      <DispatchTruckDrawer :row="openRow" :zone="zone" :dispatchers="dispatchers" @close="closeTruck" />
    </template>
  </div>
</template>
