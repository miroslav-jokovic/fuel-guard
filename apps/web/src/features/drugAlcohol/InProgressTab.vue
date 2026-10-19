<script setup lang="ts">
import { computed } from "vue";
import type { InProgressRow } from "@silvicom/shared";
import { DataTable, type DataTableColumn, DataWorkspace, FilterBar, TablePagination, useQueryState } from "@silvicom/ui";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import ListIntro from "@/features/drugAlcohol/ListIntro.vue";
import PersonCell from "@/features/drugAlcohol/PersonCell.vue";
import { KIND_OPTIONS, KINDS, kindText, useProgramList } from "@/features/drugAlcohol/useProgramList";
import { formatDate } from "@/lib/format";

/**
 * In progress (MEDSTOP-PLAN.md §7A.3): every order Med-Stop has not collected and every test whose
 * result is not final, any reason, longest-waiting first. No result is shown here — a test with a
 * final result has left this list. A random order is in the data only for the DER (§382.305(l)).
 */
const props = defineProps<{ rows: InProgressRow[] }>();

const columns: DataTableColumn[] = [
  { key: "name", label: "Person", sortable: true, cellClass: "font-medium text-ink" },
  { key: "test", label: "Test" },
  { key: "stage", label: "Stage" },
  { key: "since", label: "Ordered / collected" },
  { key: "expectedOn", label: "Result expected by", sortable: true },
  { key: "daysWaiting", label: "Waiting", sortable: true, numeric: true },
];

const qs = useQueryState("progress");
const kind = qs.param("test", KINDS);
// Reasons are Med-Stop's own words (PRE-EMPLOYMENT, RANDOM, …), so the choices are the ones on the list.
const reason = qs.param("reason");
const reasonOptions = computed(() =>
  [...new Set(props.rows.map((r) => r.reason).filter((r): r is string => Boolean(r)))].sort().map((r) => ({ value: r, label: r.toLowerCase() })),
);
const stage = qs.param("stage");
const stageOptions = computed(() => [...new Set(props.rows.map((r) => r.stage))].sort().map((s) => ({ value: s, label: s })));

const tableRows = computed(() => props.rows.map((r) => ({ ...r, name: r.person.name })));
const { search, page, sort, onSort, filtered, pageRows, activeCount, clearAll, pageSize } = useProgramList({
  scope: "progress",
  qs,
  rows: tableRows,
  columns,
  text: (r) => [r.name, r.stage, r.reason],
  narrow: (r) => (!kind.value || r.kind === kind.value) && (!reason.value || r.reason === reason.value) && (!stage.value || r.stage === stage.value),
  filters: () => ({ test: kind.value, reason: reason.value, stage: stage.value }),
});
</script>

<template>
  <DataWorkspace>
    <ListIntro
      title="Tests in progress"
      why="Ordered and not collected yet, or collected and waiting on the lab or the medical review officer. A drug result usually closes within four days of collection."
    />
    <FilterBar
      v-model:search="search"
      embedded
      search-placeholder="Search person, stage or reason…"
      :count="filtered.length"
      count-label="tests in progress"
      :active-count="activeCount"
      @clear-all="clearAll"
    >
      <template #filters>
        <FilterSelect v-model="kind" label="Test" :options="[...KIND_OPTIONS]" />
        <FilterSelect v-model="reason" label="Reason" :options="reasonOptions" />
        <FilterSelect v-model="stage" label="Stage" :options="stageOptions" />
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
      :empty-text="activeCount ? 'No test in progress matches that.' : 'No tests are in progress.'"
      @sort="onSort"
    >
      <template #cell-name="{ row }"><PersonCell :person="row.person" /></template>
      <template #cell-test="{ row }">{{ kindText(row.kind) }}{{ row.reason ? ` · ${row.reason.toLowerCase()}` : "" }}</template>
      <template #cell-since="{ row }">{{ row.collectedOn ? `Collected ${formatDate(row.collectedOn)}` : row.orderedOn ? `Ordered ${formatDate(row.orderedOn)}` : "—" }}</template>
      <template #cell-expectedOn="{ row }">{{ row.expectedOn ? formatDate(row.expectedOn) : "—" }}</template>
      <template #cell-daysWaiting="{ row }">{{ row.daysWaiting === 0 ? "today" : `${row.daysWaiting} d` }}</template>
      <template #footer>
        <TablePagination :page="page" :page-size="pageSize" :total="filtered.length" @update:page="page = $event" />
      </template>
    </DataTable>
  </DataWorkspace>
</template>
