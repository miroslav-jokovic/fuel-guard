<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { HomeTimePeriod } from "@silvicom/shared";
import { AppButton as BaseButton, AppSegmentedControl, DataTable, DataWorkspace, FilterBar, TablePagination, useQueryState, type DataTableColumn } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import { HOME_TIME_END_WORDS, HOME_TIME_STATE_BADGE, HOME_TIME_TRUCK_WORDS, spanWords } from "@/components/homeTime/homeTimeView";
import { useCanMarkHomeTime, useHomeTimeList } from "@/components/homeTime/useHomeTime";
import { HOME_TIME_NEW, useHomeTimeDrawer } from "@/components/homeTime/useHomeTimeDrawer";

/**
 * The board's Home time tab (HOME-TIME-PLAN D-HT8): everyone scheduled, home or overdue — overdue
 * first, then by return time, the server's order — and, one choice away, the periods that closed in the
 * last sixty days. It lists DRIVERS, not trucks: a driver who left his truck at the yard, or has none,
 * has no row on a truck board, and this is where he is found.
 *
 * A row opens that driver's home-time drawer; "Mark home time" opens it on a driver search. This is
 * where a dispatcher plans ahead when a driver calls about next week.
 *
 * Search and the choice live in the URL (D-US2), scoped `ht.` because this tab shares its route with
 * the board, as History's filters are scoped `history.`. It pages (D-US8) on the browser's side: the
 * list is bounded by the number of drivers and arrives whole.
 */
const props = defineProps<{ zone: string }>();

const drawer = useHomeTimeDrawer();
const canMark = useCanMarkHomeTime();
const list = useHomeTimeList();

const qs = useQueryState("ht");
const search = qs.param("search");
const showParam = qs.param("show", ["live", "recent"], "live");
const show = computed({ get: () => (showParam.value === "recent" ? "recent" : "live"), set: (v: string) => (showParam.value = v) });
/** Which list, not a filter over one: a segmented control above the table, as Loads' Activity has for Drivers / Trucks. */
const SHOW_OPTIONS = [
  { value: "live", label: "On or scheduled" },
  { value: "recent", label: "Ended, last 60 days" },
];

const at = (iso: string | null | undefined) => formatDateTime(iso, "—", props.zone);
const nowMs = computed(() => (list.data.value ? Date.parse(list.data.value.generatedAt) : Date.now()));

const all = computed<HomeTimePeriod[]>(() => (show.value === "recent" ? list.data.value?.recent : list.data.value?.live) ?? []);
const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return all.value;
  return all.value.filter((p) => [p.driverName, p.unitNumber, p.markedByName].some((v) => v?.toLowerCase().includes(term)));
});

const PAGE_SIZE = 20;
const page = ref(1);
watch([search, show], () => (page.value = 1));
watch(() => filtered.value.length, (n) => {
  const last = Math.max(1, Math.ceil(n / PAGE_SIZE));
  if (page.value > last) page.value = last;
});
const pageRows = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

/** "in 2 d 4 h" before the return, "1 d 4 h ago" after it — only while the period is open. */
function returnWords(p: HomeTimePeriod): string | null {
  const diff = Date.parse(p.expectedReturnAt) - nowMs.value;
  if (p.state === "overdue") return `${spanWords(diff)} ago`;
  return p.state === "active" ? `in ${spanWords(diff)}` : null;
}
const truckWords = (p: HomeTimePeriod): string =>
  p.disposition === "no_truck" ? HOME_TIME_TRUCK_WORDS.no_truck : `${p.unitNumber ?? "Truck"} · ${HOME_TIME_TRUCK_WORDS[p.disposition].toLowerCase()}`;

const columns = computed<DataTableColumn[]>(() => [
  { key: "driver", label: "Driver", width: "lg", cellClass: "font-medium text-ink" },
  { key: "status", label: "Status", width: "sm" },
  { key: "left", label: show.value === "recent" ? "Left" : "Leaves or left", width: "md", cellClass: "text-ink-secondary" },
  { key: "returns", label: show.value === "recent" ? "Was due back" : "Returns", width: "md" },
  ...(show.value === "recent" ? [{ key: "ended", label: "Ended", width: "md" as const, cellClass: "text-ink-secondary" }] : []),
  { key: "truck", label: "Truck", width: "md", cellClass: "text-ink-secondary" },
  { key: "markedBy", label: "Marked by", width: "md", cellClass: "text-ink-secondary" },
]);

const emptyText = computed(() => {
  if (search.value.trim()) return "No driver matches this search.";
  if (show.value === "recent") return "No home time ended in the last 60 days.";
  return canMark.value ? "Nobody is on home time. Mark a driver when he goes home, or ahead of time." : "Nobody is on home time.";
});
</script>

<template>
  <div class="space-y-3">
  <AppSegmentedControl v-model="show" :options="SHOW_OPTIONS" label="Show home time" />
  <DataWorkspace>
    <FilterBar
      v-model:search="search"
      embedded
      search-placeholder="Search driver or truck…"
      :count="filtered.length"
      count-label="drivers"
      :active-count="search.trim() ? 1 : 0"
      @clear-all="search = ''"
    >
      <template #actions>
        <BaseButton v-if="canMark" variant="primary" data-testid="home-time-mark" @click="drawer.open(HOME_TIME_NEW)">Mark home time</BaseButton>
      </template>
    </FilterBar>

    <DataTable
      embedded
      :columns="columns"
      :rows="pageRows"
      row-key="id"
      :loading="list.isLoading.value"
      :error="list.isError.value ? 'Could not load home time.' : null"
      :retrying="list.isFetching.value"
      :empty-text="emptyText"
      :nowrap="false"
      :row-class="() => 'cursor-pointer'"
      @row-click="drawer.open(($event as HomeTimePeriod).driverId)"
      @retry="list.refetch()"
    >
      <template #cell-driver="{ row }">
        <!-- The row opens the driver's home time on a click; the name is the same action as a real
             button, so a keyboard reaches it too (contract §5.7: the primary cell is focusable). -->
        <BaseButton variant="link" :aria-label="`Open ${row.driverName}'s home time`" @click.stop="drawer.open(row.driverId)">
          {{ row.driverName }}
        </BaseButton>
      </template>
      <template #cell-status="{ row }">
        <span :class="[BADGE_BASE, toneClass(HOME_TIME_STATE_BADGE[(row as HomeTimePeriod).state].tone)]">
          {{ HOME_TIME_STATE_BADGE[(row as HomeTimePeriod).state].label }}
        </span>
      </template>
      <template #cell-left="{ row }">{{ at(row.startAt) }}</template>
      <template #cell-returns="{ row }">
        <div :class="row.state === 'overdue' ? 'font-medium text-danger-700' : 'text-ink'">{{ at(row.expectedReturnAt) }}</div>
        <div v-if="returnWords(row as HomeTimePeriod)" class="text-xs" :class="row.state === 'overdue' ? 'text-danger-700' : 'text-ink-muted'">
          {{ returnWords(row as HomeTimePeriod) }}
        </div>
      </template>
      <template #cell-ended="{ row }">
        <template v-if="row.endAt">
          <div>{{ at(row.endAt) }}</div>
          <div v-if="row.endReason" class="text-xs text-ink-muted">{{ HOME_TIME_END_WORDS[(row as HomeTimePeriod).endReason!] }}</div>
        </template>
        <template v-else>Canceled {{ at(row.canceledAt) }}</template>
      </template>
      <template #cell-truck="{ row }">{{ truckWords(row as HomeTimePeriod) }}</template>
      <template #cell-markedBy="{ row }">{{ row.markedByName ?? "—" }}</template>

      <template #footer>
        <TablePagination :page="page" :page-size="PAGE_SIZE" :total="filtered.length" :loading="list.isFetching.value" @update:page="page = $event" />
      </template>
    </DataTable>
  </DataWorkspace>
  </div>
</template>
