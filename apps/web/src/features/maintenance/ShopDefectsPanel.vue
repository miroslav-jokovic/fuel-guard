<script setup lang="ts">
import { computed, watch } from "vue";
import {
  useQueryState,
  SORT_DIRECTIONS,
  useUrlSort,
  DataWorkspace,
  FilterBar,
  DataTable,
  type DataTableColumn,
  TablePagination,
  sortRows,
} from "@silvicom/ui";
import { daysSince, shopDayOf, todayInZone, type ShopDefectDto } from "@silvicom/shared";
import { useUnresolvedDefectsQuery } from "@/features/maintenance/useShopBacklog";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { formatDate } from "@/lib/format";

/**
 * Open defects — what inspections found wrong and FleetPal has not marked resolved
 * (FLEET-MANAGER-HOME-PLAN Q-FM6 (a)). The list behind the Shop card's "Open defects" figure, so it
 * carries no resolved filter for the reason `WorkOrdersPage.vue` carries no status filter.
 *
 * ── NO SEVERITY COLUMN ────────────────────────────────────────────────────────────────────────
 * FleetPal sent `severity` null on every defect (52 of 52, 2026-10-13). A column of dashes would read
 * as "none of these is serious", which nobody has said.
 *
 * The driver's own words are a column because they are often the whole description: what was heard
 * or felt on the road, which is what a technician starts from.
 */

const PAGE_SIZE = 20;

const qs = useQueryState();
const search = qs.param("search");
const activeFilterCount = computed(() => (search.value.trim() ? 1 : 0));

const { zone } = useOrgTimezone();
const defects = useUnresolvedDefectsQuery();

type Row = ShopDefectDto & { detectedDay: string | null; openFor: number | null };
const rows = computed<Row[]>(() => {
  const today = todayInZone(new Date(), zone.value);
  const term = search.value.trim().toLowerCase();
  const all = (defects.data.value ?? []).map((d) => ({
    ...d,
    detectedDay: d.detectedAt ? shopDayOf(d.detectedAt, zone.value) : null,
    openFor: d.detectedAt ? daysSince(d.detectedAt, today, zone.value) : null,
  }));
  const found = term
    ? all.filter((d) => [d.unitNumber, d.name, d.description, d.driverComment].some((v) => v?.toLowerCase().includes(term)))
    : all;
  return sortRows(found, sort.value);
});

const page = qs.page();
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const COLUMNS: DataTableColumn[] = [
  { key: "unitNumber", label: "Unit", card: "title", sortable: true, cellClass: "font-medium text-ink", width: "sm" },
  { key: "name", label: "Defect", card: "sentence", sortable: true },
  { key: "driverComment", label: "Driver's note", card: "none" },
  { key: "detectedDay", label: "Found", card: "none", sortable: true, width: "sm" },
  { key: "openFor", label: "Open for", card: "meta", sortable: true, numeric: true, width: "sm" },
];
const { sort, onSort } = useUrlSort(
  qs.param("sort", COLUMNS.filter((c) => c.sortable).map((c) => c.key)),
  qs.param("dir", SORT_DIRECTIONS),
);
watch([search, () => sort.value.key, () => sort.value.dir], () => (page.value = 1));
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-ink-tertiary">Defects found on inspections that FleetPal has not marked resolved, oldest first.</p>

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search unit, defect or note…"
        :count="rows.length"
        count-label="open defects"
        :active-count="activeFilterCount"
        @clear-all="search = ''"
      />

      <DataTable
        embedded
        :columns="COLUMNS"
        :rows="pageRows"
        row-key="id"
        :loading="defects.isLoading.value"
        :error="defects.isError.value ? 'Could not load the open defects.' : null"
        :sort="sort"
        @sort="onSort"
        @retry="() => defects.refetch()"
      >
        <template #cell-unitNumber="{ value }">{{ value ?? "—" }}</template>
        <template #cell-name="{ row }">
          <span class="text-ink">{{ row.name ?? "—" }}</span>
          <span v-if="row.description" class="block text-xs text-ink-tertiary">{{ row.description }}</span>
        </template>
        <template #cell-driverComment="{ value }">
          <span v-if="value" class="line-clamp-2 text-ink-secondary">{{ value }}</span>
          <span v-else class="text-ink-tertiary">—</span>
        </template>
        <template #cell-detectedDay="{ value }">{{ value ? formatDate(value) : "—" }}</template>
        <template #cell-openFor="{ value }">
          <span v-if="value == null" class="text-ink-tertiary">—</span>
          <span v-else>{{ value === 1 ? "1 day" : `${value} days` }}</span>
        </template>
        <template #empty>
          <p v-if="search">No open defect matches that.</p>
          <p v-else>No open defects. Everything inspections found has been resolved.</p>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
