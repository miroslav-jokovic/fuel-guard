<script setup lang="ts">
import { computed } from "vue";
import type { ProgramPerson } from "@silvicom/shared";
import { DataTable, type DataTableColumn, DataWorkspace, FilterBar, TablePagination, useQueryState } from "@silvicom/ui";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import ListIntro from "@/features/drugAlcohol/ListIntro.vue";
import { useProgramList } from "@/features/drugAlcohol/useProgramList";

/**
 * Roster check — the two roster violations on Safety › Drug & Alcohol (MEDSTOP-PLAN.md §7A.3): an
 * active DOT driver missing from Med-Stop's random pool, and a pool member who no longer drives here.
 * One workspace, Show choosing the list (Results' pattern), so "Clear filters" keeps it. Each person
 * links to the driver page when we hold the driver.
 */
const props = defineProps<{ notInPool: ProgramPerson[]; leftButInPool: ProgramPerson[] }>();

const LISTS = {
  missing: {
    label: "Not in the pool",
    title: "Driving here, not in Med-Stop's random pool",
    why: "Every active DOT driver must be in the random pool (49 CFR 382.305). Add each one in Med-Stop, or end their employment here if they no longer drive.",
    empty: "Every active driver is in Med-Stop's pool.",
  },
  left: {
    label: "No longer driving",
    title: "In Med-Stop's pool, no longer driving here",
    why: "Med-Stop can still select these people. Terminate them in Med-Stop. A name with no link is someone Med-Stop lists that no driver here matches.",
    empty: "Med-Stop's pool holds no one who has left.",
  },
} as const;

const qs = useQueryState("roster");
const show = qs.param("show", ["missing", "left"], "missing");
const list = computed(() => LISTS[show.value as keyof typeof LISTS]);
const showOptions = computed(() => [
  { value: "missing", label: `${LISTS.missing.label} (${props.notInPool.length})` },
  { value: "left", label: `${LISTS.left.label} (${props.leftButInPool.length})` },
]);
// "A name with no link" (above) is the question this answers: is there a driver here to act on?
const MATCH = { matched: "Matched to a driver", unmatched: "No driver here" } as const;
const match = qs.param("match", Object.keys(MATCH));
const matchOptions = Object.entries(MATCH).map(([value, label]) => ({ value, label }));

const columns: DataTableColumn[] = [{ key: "name", label: "Driver", sortable: true, cellClass: "font-medium text-ink" }];
const tableRows = computed(() =>
  (show.value === "left" ? props.leftButInPool : props.notInPool).map((p) => ({ ...p, key: p.driverId ?? p.medstopId ?? p.name })),
);
const { search, page, sort, onSort, filtered, pageRows, activeCount, clearAll, pageSize } = useProgramList({
  scope: "roster",
  qs,
  rows: tableRows,
  columns,
  text: (r) => [r.name],
  narrow: (r) => !match.value || (match.value === "matched") === Boolean(r.driverId),
  filters: () => ({ match: match.value }),
});
</script>

<template>
  <DataWorkspace>
    <ListIntro :title="list.title" :why="list.why" />
    <FilterBar
      v-model:search="search"
      embedded
      search-placeholder="Search name…"
      :count="filtered.length"
      count-label="people"
      :active-count="activeCount"
      @clear-all="clearAll"
    >
      <template #filters>
        <FilterSelect v-model="show" label="Show" :options="showOptions" />
        <FilterSelect v-model="match" label="Driver record" :options="matchOptions" />
      </template>
    </FilterBar>
    <DataTable
      embedded
      dense
      :sticky-header="false"
      :columns="columns"
      :rows="pageRows"
      row-key="key"
      :sort="sort"
      :empty-text="activeCount ? 'No one matches that.' : list.empty"
      @sort="onSort"
    >
      <template #cell-name="{ row }">
        <RouterLink v-if="row.driverId" :to="{ name: 'driver-detail', params: { id: row.driverId } }" class="text-brand-700 hover:underline">
          {{ row.name }}
        </RouterLink>
        <span v-else>{{ row.name }}</span>
      </template>
      <template #footer>
        <TablePagination :page="page" :page-size="pageSize" :total="filtered.length" @update:page="page = $event" />
      </template>
    </DataTable>
  </DataWorkspace>
</template>
