<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { DQ_GROUP_LABELS, type DqGroup, type DqItemState } from "@fuelguard/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import TablePagination from "@/components/TablePagination.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
import { useComplianceOverviewQuery } from "@/composables/useCompliance";
import {
  classifyDqDateFilters,
  type DqDateFilters,
} from "./dqQueueFilters";

/**
 * The work queue (DQ redesign, D-DQ6).
 *
 * A safety manager's morning question is "which qualification items need attention across my fleet",
 * and until now nothing in the product answered it. One row per driver × requirement, worst first —
 * ranked by the same function the driver file uses, so the two surfaces cannot disagree.
 *
 * The queue supports exact expiration and evidence-date ranges. Rows with missing dates remain visible
 * in a clearly marked gap section so a filter never hides a data-quality problem.
 */
const PAGE_SIZE = 20;

const query = useComplianceOverviewQuery();

const search = ref("");
const goodUntilFrom = ref<string>();
const goodUntilTo = ref<string>();
const evidenceDateFrom = ref<string>();
const evidenceDateTo = ref<string>();
const groupFilter = ref("");
const page = ref(1);
const sort = ref<SortState>({ key: null, dir: "asc" });

interface QueueRow {
  id: string;
  driver_id: string;
  driver_name: string;
  label: string;
  group: DqGroup;
  state: DqItemState;
  goodUntil: string | null;
  evidenceDate: string | null;
  daysRemaining: number | null;
  dateFilterGap: string | null;
}

/** Flattened in the order the API ranked them; the table only re-sorts when a header is clicked. */
const all = computed<QueueRow[]>(() =>
  (query.data.value?.drivers ?? []).flatMap((d) =>
    d.attention.map((a) => ({
      id: `${d.driver_id}:${a.key}`,
      driver_id: d.driver_id,
      driver_name: d.driver_name,
      label: a.label,
      group: a.group,
      state: a.state,
      goodUntil: a.goodUntil,
      evidenceDate: a.evidenceDate,
      daysRemaining: a.daysRemaining,
      dateFilterGap: null,
    })),
  ),
);

const groupOptions = computed(() => [
  { value: "", label: "All groups" },
  ...Object.entries(DQ_GROUP_LABELS).map(([value, label]) => ({ value, label })),
]);

const dateFilters = computed<DqDateFilters>(() => ({
  goodUntil: { from: goodUntilFrom.value, to: goodUntilTo.value },
  evidenceDate: { from: evidenceDateFrom.value, to: evidenceDateTo.value },
}));
const dateFilterActive = computed(() =>
  Boolean(
    goodUntilFrom.value ||
      goodUntilTo.value ||
      evidenceDateFrom.value ||
      evidenceDateTo.value,
  ),
);

const filtered = computed(() =>
  all.value.filter((r) => {
    if (groupFilter.value && r.group !== groupFilter.value) return false;
    const t = search.value.trim().toLowerCase();
    if (t && ![r.driver_name, r.label].some((f) => f.toLowerCase().includes(t))) return false;
    return true;
  }),
);

const classified = computed(() =>
  filtered.value.flatMap((row) => {
    const result = classifyDqDateFilters(row, dateFilters.value);
    if (result.kind === "outside-range") return [];
    return [
      {
        ...row,
        dateFilterGap:
          result.kind === "missing-date"
            ? result.missing
                .map((key) => (key === "goodUntil" ? "Missing good until date" : "Missing evidence date"))
                .join(" · ")
            : null,
      },
    ];
  }),
);
const matchingRows = computed(() => classified.value.filter((row) => !row.dateFilterGap));
const dateGapRows = computed(() => classified.value.filter((row) => row.dateFilterGap));
const filteredRows = computed(() => [...matchingRows.value, ...dateGapRows.value]);
const sorted = computed(() => [
  ...sortRows(matchingRows.value, sort.value, (row, key) => row[key as keyof QueueRow]),
  ...sortRows(dateGapRows.value, sort.value, (row, key) => row[key as keyof QueueRow]),
]);
const pageRows = computed(() =>
  sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
);
watch(
  [search, goodUntilFrom, goodUntilTo, evidenceDateFrom, evidenceDateTo, groupFilter],
  () => (page.value = 1),
);

const STATE_TONE: Record<DqItemState, string> = {
  current: "success",
  expiring: "warning",
  expired: "danger",
  missing: "neutral",
};
const STATE_LABEL: Record<DqItemState, string> = {
  current: "on file",
  expiring: "due soon",
  expired: "expired",
  missing: "missing",
};

/** Plain English beats a signed integer: "14 days" reads, "-3" makes the reader do the arithmetic. */
function dueLabel(row: QueueRow): string {
  if (row.state === "missing") return "Never recorded";
  if (row.daysRemaining === null) return "—";
  if (row.daysRemaining < 0) return `${Math.abs(row.daysRemaining)} days overdue`;
  if (row.daysRemaining === 0) return "Today";
  return `${row.daysRemaining} days`;
}

const columns: DataTableColumn[] = [
  {
    key: "driver_name",
    label: "Driver",
    headerClass: "min-w-[11rem]",
    cellClass: "font-medium text-ink",
  },
  {
    key: "label",
    label: "Requirement",
    sortable: true,
    headerClass: "min-w-[16rem]",
    cellClass: "text-ink-secondary",
  },
  { key: "state", label: "Status", headerClass: "w-32" },
  {
    key: "goodUntil",
    label: "Good until",
    sortable: true,
    headerClass: "w-32",
    cellClass: "text-ink-secondary",
  },
  {
    key: "evidenceDate",
    label: "Evidence date",
    sortable: true,
    headerClass: "w-36",
    cellClass: "text-ink-secondary",
  },
  {
    key: "daysRemaining",
    label: "Due",
    sortable: true,
    numeric: true,
    headerClass: "w-36",
    cellClass: "text-ink-secondary",
  },
];
function onSort(key: string): void {
  sort.value = toggleSort(sort.value, key);
}
</script>

<template>
  <div class="space-y-6">
    <FilterBar
      v-model:search="search"
      search-placeholder="Search driver or requirement…"
      :count="filteredRows.length"
      count-label="items"
    >
      <template #filters>
        <DateRangeFilter
          :from="goodUntilFrom"
          :to="goodUntilTo"
          :presets="false"
          :max-date="null"
          label="Good until"
          @update:from="goodUntilFrom = $event"
          @update:to="goodUntilTo = $event"
        />
        <DateRangeFilter
          :from="evidenceDateFrom"
          :to="evidenceDateTo"
          :presets="false"
          :max-date="null"
          label="Evidence date"
          @update:from="evidenceDateFrom = $event"
          @update:to="evidenceDateTo = $event"
        />
        <FilterSelect v-model="groupFilter" label="Group" :options="groupOptions" />
      </template>
    </FilterBar>

    <p v-if="dateFilterActive && dateGapRows.length" class="text-sm text-warning-700">
      Matching dated requirements appear first. {{ dateGapRows.length }} outstanding
      {{ dateGapRows.length === 1 ? "requirement has" : "requirements have" }} a missing date and
      {{ dateGapRows.length === 1 ? "is" : "are" }} shown below with the missing field identified.
    </p>

    <p v-if="query.data.value?.truncated" class="text-sm text-warning-700">
      This picture is partial — the fleet has more qualification records than one read returns.
      Narrow by group, or tell us so we can page it.
    </p>

    <DataTable
      :columns="columns"
      :rows="pageRows"
      row-key="id"
      :loading="query.isLoading.value"
      :error="
        query.isError.value
          ? (query.error.value?.message ?? 'Could not load the qualification queue.')
          : null
      "
      :retrying="query.isFetching.value"
      :sort="sort"
      :row-class="(row) => (row.dateFilterGap ? 'bg-warning-50/40' : '')"
      :empty-text="dateFilterActive ? 'No requirements match these date ranges.' : 'Nothing needs attention.'"
      @sort="onSort"
      @retry="query.refetch()"
    >
      <template #cell-driver_name="{ row }">
        <RouterLink
          :to="`/compliance/${row.driver_id}`"
          class="font-medium text-link hover:text-link-hover"
        >
          {{ row.driver_name }}
        </RouterLink>
      </template>
      <template #cell-label="{ row }">
        <span class="text-ink">{{ row.label }}</span>
        <span
          v-if="row.dateFilterGap"
          :class="['mt-1', BADGE_BASE, toneClass('warning')]"
        >
          {{ row.dateFilterGap }}
        </span>
      </template>
      <template #cell-state="{ row }">
        <span :class="[BADGE_BASE, toneClass(STATE_TONE[row.state])]">{{
          STATE_LABEL[row.state]
        }}</span>
      </template>
      <template #cell-goodUntil="{ row }">
        <span v-if="row.goodUntil">{{ formatDate(row.goodUntil) }}</span>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #cell-evidenceDate="{ row }">
        <span v-if="row.evidenceDate">{{ formatDate(row.evidenceDate) }}</span>
        <span v-else class="text-ink-tertiary">—</span>
      </template>
      <template #cell-daysRemaining="{ row }">{{ dueLabel(row) }}</template>
      <template #footer>
        <TablePagination
          :page="page"
          :page-size="PAGE_SIZE"
          :total="filteredRows.length"
          :loading="query.isFetching.value"
          @update:page="page = $event"
        />
      </template>
    </DataTable>
  </div>
</template>
