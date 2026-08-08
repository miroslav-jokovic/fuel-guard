<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { DQ_GROUP_LABELS, type DqGroup, type DqItemState } from "@fuelguard/shared";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import TablePagination from "@/components/TablePagination.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { sortRows, toggleSort, type SortState } from "@/lib/sort";
import { useComplianceOverviewQuery } from "@/composables/useCompliance";

/**
 * The work queue (DQ redesign, D-DQ6).
 *
 * A safety manager's morning question is "what expires in the next thirty days across my fleet", and
 * until now nothing in the product answered it. One row per driver × requirement, worst first —
 * ranked by the same function the driver file uses, so the two surfaces cannot disagree.
 *
 * Banded 90 / 60 / 30 because that is what every DQF product converges on, and therefore what a
 * safety manager already expects to read.
 */
const PAGE_SIZE = 20;
const BANDS = [
  { value: "30", label: "Due within 30 days" },
  { value: "60", label: "Due within 60 days" },
  { value: "90", label: "Due within 90 days" },
  { value: "", label: "Everything outstanding" },
] as const;

const query = useComplianceOverviewQuery();

const search = ref("");
const band = ref<string>("30");
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
  daysRemaining: number | null;
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
      daysRemaining: a.daysRemaining,
    })),
  ),
);

const groupOptions = computed(() => [
  { value: "", label: "All groups" },
  ...Object.entries(DQ_GROUP_LABELS).map(([value, label]) => ({ value, label })),
]);

const filtered = computed(() =>
  all.value.filter((r) => {
    // A band is a *deadline* filter, so it never hides something already overdue or absent —
    // "due within 30 days" that silently drops an expired medical card would be worse than no filter.
    if (band.value) {
      const within = Number(band.value);
      const overdue = r.state === "expired" || r.state === "missing";
      if (!overdue && (r.daysRemaining === null || r.daysRemaining > within)) return false;
    }
    if (groupFilter.value && r.group !== groupFilter.value) return false;
    const t = search.value.trim().toLowerCase();
    if (!t) return true;
    return [r.driver_name, r.label].some((f) => f.toLowerCase().includes(t));
  }),
);

const sorted = computed(() =>
  sortRows(filtered.value, sort.value, (row, key) => row[key as keyof QueueRow]),
);
const pageRows = computed(() =>
  sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
);
watch([search, band, groupFilter], () => (page.value = 1));

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
      :count="filtered.length"
      count-label="items"
    >
      <template #filters>
        <FilterSelect v-model="band" label="Deadline" :options="[...BANDS]" />
        <FilterSelect v-model="groupFilter" label="Group" :options="groupOptions" />
      </template>
    </FilterBar>

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
      empty-text="Nothing needs attention in this window."
      @sort="onSort"
      @retry="query.refetch()"
    >
      <template #cell-driver_name="{ row }">
        <RouterLink
          :to="`/compliance/${row.driver_id}`"
          class="font-medium text-brand-600 hover:text-brand-500"
        >
          {{ row.driver_name }}
        </RouterLink>
      </template>
      <template #cell-state="{ row }">
        <span :class="[BADGE_BASE, toneClass(STATE_TONE[row.state])]">{{
          STATE_LABEL[row.state]
        }}</span>
      </template>
      <template #cell-goodUntil="{ row }">
        <span v-if="row.goodUntil">{{ row.goodUntil }}</span>
        <span v-else class="text-ink-subtle">—</span>
      </template>
      <template #cell-daysRemaining="{ row }">{{ dueLabel(row) }}</template>
      <template #footer>
        <TablePagination
          :page="page"
          :page-size="PAGE_SIZE"
          :total="filtered.length"
          :loading="query.isFetching.value"
          @update:page="page = $event"
        />
      </template>
    </DataTable>
  </div>
</template>
