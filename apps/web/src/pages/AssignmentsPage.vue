<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import type { DispatchBoardRow } from "@silvicom/shared";
import { AppSegmentedControl, AppTabs } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar, { type FilterChip } from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { formatDateTime } from "@/lib/format";
import AssignmentHistory from "@/features/dispatch/AssignmentHistory.vue";
import DispatchBoardTable from "@/features/dispatch/DispatchBoardTable.vue";
import DispatchTruckDrawer from "@/features/dispatch/DispatchTruckDrawer.vue";
import { useDispatchBoardQuery } from "@/features/dispatch/useDispatchBoard";
import {
  BOARD_QUEUES,
  NO_FLEET_OPTION,
  POOL_FLEET,
  POOL_OPTION,
  dispatcherName,
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
 * The History tab is the L5 attribution trail, unchanged.
 *
 * ── THE DRAWER IS IN THE URL (DB6) ───────────────────────────────────────────────────────────────
 * A row opens its truck's drawer, and `?truck=773` opens it from anywhere — the Loads page's truck
 * links here that way (D-DB6 point 4), so a load's truck is one click from its board row. The query
 * holds the UNIT, which is what a person reads and a link can be written with; the drawer resolves it
 * against the polled board each minute, so it never shows a truck as it was when it opened.
 */
const { zone } = useOrgTimezone();
const route = useRoute();
const router = useRouter();
const { data: board, isLoading, isError, error, refetch, isFetching } = useDispatchBoardQuery();

const TABS = [
  { value: "board", label: "Board" },
  { value: "history", label: "History" },
];
const tab = ref("board");

const scope = computed(() => board.value?.scope ?? { linked: false, fleetCodes: [], dispatcherIds: [] });
const SCOPE_OPTIONS = [
  { value: "mine", label: "My fleet" },
  { value: "all", label: "All" },
];
const scopeChoice = ref<"mine" | "all">("all");
// Open on My fleet once the server says the caller has one; never force it back after they choose.
let scopeChosen = false;
watch(
  () => scope.value.linked,
  (linked) => {
    if (!scopeChosen) scopeChoice.value = linked ? "mine" : "all";
  },
  { immediate: true },
);
function setScope(v: string) {
  scopeChosen = true;
  scopeChoice.value = v === "mine" ? "mine" : "all";
}

const search = ref("");
const fleet = ref("");
const dispatcher = ref("");
const queue = ref<BoardQueue>("all");

const rows = computed(() => board.value?.rows ?? []);
const dispatchers = computed(() => board.value?.dispatchers ?? []);
const fleetOwner = (code: string | null) => board.value?.fleets.find((f) => f.code === code)?.dispatcherId ?? null;

const base = computed(() => ({ mine: scopeChoice.value === "mine", fleet: fleet.value, dispatcher: dispatcher.value, search: search.value }));
const filtered = computed(() => filterBoard(rows.value, scope.value, { ...base.value, queue: queue.value }));
const queueOptions = computed(() =>
  BOARD_QUEUES.map((q) => ({
    value: q.value,
    label: `${q.label} (${filterBoard(rows.value, scope.value, { ...base.value, queue: q.value }).length})`,
  })),
);

const fleetOptions = computed(() => [
  { value: "", label: "All fleets" },
  ...(board.value?.fleets ?? [])
    .filter((f) => f.code !== POOL_FLEET)
    .map((f) => ({ value: f.code, label: f.dispatcherId ? `${f.code} · ${dispatcherName(f.dispatcherId, dispatchers.value)}` : f.code })),
  { value: POOL_OPTION, label: "Unassigned pool" },
  { value: NO_FLEET_OPTION, label: "No fleet" },
]);
const dispatcherOptions = computed(() => [
  { value: "", label: "Anyone" },
  ...dispatchers.value.filter((d) => !d.isSystem).map((d) => ({ value: d.id, label: d.name || d.id })),
]);

const chips = computed<FilterChip[]>(() => {
  const out: FilterChip[] = [];
  if (fleet.value) out.push({ key: "fleet", label: "Fleet", value: fleetOptions.value.find((o) => o.value === fleet.value)?.label ?? fleet.value });
  if (dispatcher.value) out.push({ key: "dispatcher", label: "Dispatched by", value: dispatcherName(dispatcher.value, dispatchers.value) });
  return out;
});
function removeChip(key: string) {
  if (key === "fleet") fleet.value = "";
  if (key === "dispatcher") dispatcher.value = "";
}
function clearAll() {
  search.value = "";
  fleet.value = "";
  dispatcher.value = "";
  queue.value = "all";
}

const openUnit = computed(() => (typeof route.query.truck === "string" ? route.query.truck : null));
const openRow = computed(() => (openUnit.value ? (rows.value.find((r) => r.unitNumber === openUnit.value) ?? null) : null));
function openTruck(row: DispatchBoardRow) {
  void router.replace({ query: { ...route.query, truck: row.unitNumber } });
}
function closeTruck() {
  const { truck: _truck, ...rest } = route.query;
  void router.replace({ query: rest });
}

const at = (iso: string | null | undefined) => formatDateTime(iso, "—", zone.value);
const description = computed(() => {
  if (tab.value === "history") return "Who held which truck and trailer, and when. The attribution trail behind every evidence panel.";
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

    <AppTabs v-model="tab" :tabs="TABS" label="Dispatch board view" />

    <AssignmentHistory v-if="tab === 'history'" />

    <template v-else>
      <p v-if="board && !scope.linked" class="text-sm text-ink-muted">
        Showing every truck. Your account is not linked to a McLeod dispatcher yet. An admin links it
        in Settings → McLeod fleets, and the board then opens on your fleet.
      </p>

      <DataWorkspace>
        <FilterBar
          v-model:search="search"
          embedded
          search-placeholder="Search truck, driver, load, customer, city…"
          :count="filtered.length"
          count-label="trucks"
          :chips="chips"
          @remove="removeChip"
          @clear-all="clearAll"
        >
          <template #filters>
            <AppSegmentedControl
              :model-value="scopeChoice"
              :options="SCOPE_OPTIONS"
              label="Whose trucks"
              :disabled="!scope.linked"
              @update:model-value="setScope"
            />
            <FilterSelect v-model="queue" label="Show" :options="queueOptions" />
            <FilterSelect v-model="fleet" label="Fleet" :options="fleetOptions" />
            <FilterSelect v-model="dispatcher" label="Dispatched by" :options="dispatcherOptions" />
          </template>
          <template #actions>
            <RouterLink
              v-if="board && board.uncoveredCount > 0"
              :to="{ name: 'loads', query: { queue: 'uncovered' } }"
              class="text-sm font-medium text-brand-700 hover:underline"
            >
              {{ board.uncoveredCount }} uncovered {{ board.uncoveredCount === 1 ? "load" : "loads" }} →
            </RouterLink>
          </template>
        </FilterBar>

        <DispatchBoardTable
          :rows="filtered"
          :loading="isLoading"
          :error="isError ? (error instanceof Error ? error.message : 'Failed to load the dispatch board') : null"
          :retrying="isFetching"
          :empty-text="emptyText"
          :zone="zone"
          :dispatchers="dispatchers"
          :fleet-owner="fleetOwner"
          @retry="refetch"
          @open="openTruck"
        />
      </DataWorkspace>

      <DispatchTruckDrawer :row="openRow" :zone="zone" :dispatchers="dispatchers" @close="closeTruck" />
    </template>
  </div>
</template>
