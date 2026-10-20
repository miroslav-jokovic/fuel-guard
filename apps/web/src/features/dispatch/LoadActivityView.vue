<script setup lang="ts">
/**
 * Loads → Activity: who has gone how long without a load (LOADS-ACTIVITY-PLAN D-LA7, D-LA8).
 *
 * One row per active driver, or per truck. "Without a load" means days since the last delivery while
 * nothing is on the truck. It is 0 while a load is, however long ago the last stop was: on 2026-10-19,
 * 42 of the 52 drivers at "2–4 days since a stop" were mid-haul. Every figure is the server's
 * (`summarizeActivity`). This view filters, orders and words them.
 *
 * Trucks are the Dispatch board's (`board.rows`), so this list and the board name one fleet (its census,
 * D-DB11), and the page's Dispatcher / fleet choice narrows both alike. Drivers are the active roster.
 *
 * ⚠ It cannot tell home time from idle: `driver_time_off` exists and nothing feeds it (Q-LA1). Current HOS
 * sits beside the days for that reason, and a long off-duty run is a question, not a verdict.
 */
import { computed } from "vue";
import type { ActivitySummary, DispatchBoardResponse } from "@silvicom/shared";
import { AppButton as BaseButton, AppSegmentedControl, DataTable, FilterBar, TablePagination, useQueryState, type DataTableColumn } from "@silvicom/ui";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { useLoadActivityQuery } from "./useDispatchLoads";
import { IDLE_OPTIONS, IDLE_VALUES, compareIdle, idleTone, passesIdle } from "./activityRows";
import { BADGE_BASE, hosStatusBadge, toneClass } from "@/lib/badges";
import { formatDate, formatDateTime } from "@/lib/format";

const props = defineProps<{
  board: DispatchBoardResponse | null | undefined;
  /** The page's Dispatcher / fleet choice, asked of a subject's latest truck and dispatcher. */
  admits: (item: { vehicle_id: string | null; dispatcher_external_id: string | null }) => boolean;
  zone: string;
}>();

const PAGE_SIZE = 20;
const qs = useQueryState();
const who = qs.param("who", ["drivers", "trucks"], "drivers");
const idle = qs.param("idle", IDLE_VALUES);
const search = qs.param("search");
const page = qs.page();

const { data, isLoading, isError, refetch, isFetching } = useLoadActivityQuery(computed(() => true));

/** A driver's or a truck's row, as one shape: the subject's name, and HOS for a driver only. */
type Row = ActivitySummary & { label: string; hosStatus: string | null };
const boardTrucks = computed(() => new Set((props.board?.rows ?? []).map((r) => r.vehicleId)));
const rows = computed<Row[]>(() => {
  const d = data.value;
  if (!d) return [];
  return who.value === "trucks"
    ? d.trucks.filter((t) => !props.board || boardTrucks.value.has(t.subjectId)).map((t) => ({ ...t, label: t.unit ?? "Unknown unit", hosStatus: null }))
    : d.drivers.map((r) => ({ ...r, label: r.name ?? "Unnamed driver" }));
});
const shown = computed(() => {
  const term = search.value.trim().toLowerCase();
  return rows.value
    .filter((r) => props.admits({ vehicle_id: r.vehicleId, dispatcher_external_id: r.dispatcherId }))
    .filter((r) => passesIdle(r, idle.value))
    .filter((r) => !term || r.label.toLowerCase().includes(term))
    .sort(compareIdle<Row>((r) => r.label));
});
const pageRows = computed(() => shown.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const columns = computed<DataTableColumn[]>(() => [
  { key: "label", label: who.value === "trucks" ? "Truck" : "Driver", width: "lg", cellClass: "font-medium text-ink" },
  { key: "idle", label: "Without a load", width: "md" },
  { key: "now", label: "Load now", width: "md" },
  { key: "planned", label: "Next planned", width: "md" },
  { key: "lastPickupAt", label: "Last pickup", width: "lg" },
  { key: "lastDeliveryAt", label: "Last delivery", width: "lg" },
  ...(who.value === "drivers" ? [{ key: "hos", label: "HOS now", width: "sm" as const }] : []),
]);

const since = computed(() => formatDate(data.value?.historyFrom ?? data.value?.windowFrom ?? null));
const idleWords = (r: Row): string =>
  r.currentLoad ? "On a load" : r.daysWithoutLoad === null ? `None since ${since.value}` : r.daysWithoutLoad === 1 ? "1 day" : `${r.daysWithoutLoad} days`;
const at = (iso: string | null) => formatDateTime(iso, "—", props.zone);
const isAhead = (iso: string | null) => Boolean(iso && data.value && Date.parse(iso) > Date.parse(data.value.asOf));

const activeCount = computed(() => [idle.value, search.value.trim()].filter(Boolean).length);
const clear = () => qs.set({ idle: undefined, search: undefined });
</script>

<template>
  <div class="space-y-3">
    <AppSegmentedControl v-model="who" :options="[{ value: 'drivers', label: 'Drivers' }, { value: 'trucks', label: 'Trucks' }]" label="Show activity for" />
    <FilterBar
      v-model:search="search"
      embedded
      :search-placeholder="who === 'trucks' ? 'Search unit…' : 'Search driver…'"
      :count="shown.length"
      :count-label="who === 'trucks' ? 'trucks' : 'drivers'"
      :active-count="activeCount"
      @clear-all="clear"
    >
      <template #filters>
        <FilterSelect v-model="idle" label="Without a load" :options="IDLE_OPTIONS" />
      </template>
    </FilterBar>
    <DataTable
      :columns="columns"
      :rows="pageRows"
      row-key="subjectId"
      :loading="isLoading"
      :error="isError ? 'Could not load the activity.' : null"
      :retrying="isFetching"
      :empty-text="rows.length ? 'Nobody matches these filters.' : 'No activity yet. It comes from McLeod\'s loads.'"
      embedded
      @retry="refetch"
    >
      <template #cell-idle="{ row }">
        <span :class="[BADGE_BASE, toneClass(idleTone(row.daysWithoutLoad, Boolean(row.currentLoad)))]">{{ idleWords(row) }}</span>
      </template>
      <template #cell-now="{ row }">
        <BaseButton v-if="row.currentLoad" variant="link" :to="{ name: 'load-detail', params: { id: row.currentLoad.id } }">{{ row.currentLoad.ref }}</BaseButton>
        <span v-else class="text-ink-tertiary">—</span>
        <p v-if="row.currentLoad?.empty" class="text-xs text-ink-muted">Empty move</p>
      </template>
      <template #cell-planned="{ row }">
        <BaseButton v-if="row.plannedLoad" variant="link" :to="{ name: 'load-detail', params: { id: row.plannedLoad.id } }">{{ row.plannedLoad.ref }}</BaseButton>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template v-for="col in ['lastPickupAt', 'lastDeliveryAt'] as const" :key="col" #[`cell-${col}`]="{ row }">
        <span :class="row[col] ? 'tabular-nums' : 'text-ink-tertiary'">{{ at(row[col]) }}</span>
        <p v-if="isAhead(row[col])" class="text-xs text-warning-700" title="McLeod has this time later than now: it was entered ahead.">Entered ahead in McLeod</p>
      </template>
      <template #cell-hos="{ row }">
        <span v-if="row.hosStatus" :class="[BADGE_BASE, toneClass(hosStatusBadge(row.hosStatus).tone)]">{{ hosStatusBadge(row.hosStatus).label }}</span>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #footer>
        <TablePagination :page="page" :page-size="PAGE_SIZE" :total="shown.length" :loading="isFetching" @update:page="page = $event" />
      </template>
    </DataTable>
  </div>
</template>
