<script setup lang="ts">
import { computed, watch } from "vue";
import { RouterLink } from "vue-router";
import {
  AppPageHeader,
  DataTable,
  DataWorkspace,
  FilterBar,
  SORT_DIRECTIONS,
  TablePagination,
  sortRows,
  useQueryState,
  useUrlSort,
  type DataTableColumn,
} from "@silvicom/ui";
import AppShell from "@/layouts/AppShell.vue";
import { useOrgsQuery } from "@/lib/queries";
import { fmtDate } from "@/lib/format";

/**
 * Every customer on the platform, on the web app's list kit (US7, D-US11).
 *
 * Until US7 this was a hand-headed `AppTable` with no search, no sort, no paging and a red
 * `e.message` for a failure. It is the console list that grows with every customer signed, so it gets
 * what every web list has: search, sort and page in the URL (D-US2), a page of 20 (D-US8), and the
 * read's own sentence when it fails (D-US9). The list arrives whole, so it searches, sorts and pages
 * itself, as `WorkOrdersPage.vue` does in the web app.
 */
const PAGE_SIZE = 20;

const qs = useQueryState();
const search = qs.param("search");
const activeFilterCount = computed(() => (search.value.trim() ? 1 : 0));

const orgs = useOrgsQuery();

const COLUMNS: DataTableColumn[] = [
  { key: "name", label: "Organization", sortable: true, cellClass: "font-medium text-ink" },
  { key: "memberCount", label: "Members", sortable: true, numeric: true, width: "sm" },
  { key: "activeVehicleCount", label: "Vehicles", sortable: true, numeric: true, width: "sm" },
  { key: "driverCount", label: "Drivers", sortable: true, numeric: true, width: "sm" },
  { key: "openAnomalyCount", label: "Open alerts", sortable: true, numeric: true, width: "sm" },
  { key: "lastTxnAt", label: "Last activity", sortable: true, width: "md" },
];
const { sort, onSort } = useUrlSort(
  qs.param("sort", COLUMNS.filter((c) => c.sortable).map((c) => c.key)),
  qs.param("dir", SORT_DIRECTIONS),
);

const rows = computed(() => {
  const term = search.value.trim().toLowerCase();
  const all = orgs.data.value ?? [];
  return sortRows(term ? all.filter((o) => o.name.toLowerCase().includes(term)) : all, sort.value);
});
const page = qs.page();
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
watch([search, () => sort.value.key, () => sort.value.dir], () => (page.value = 1));
</script>

<template>
  <AppShell>
    <AppPageHeader title="Customers" description="Every organization on the platform." />

    <DataWorkspace class="mt-5">
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search organizations…"
        :count="rows.length"
        count-label="organizations"
        :active-count="activeFilterCount"
        @clear-all="search = ''"
      />

      <DataTable
        embedded
        :columns="COLUMNS"
        :rows="pageRows"
        row-key="orgId"
        :loading="orgs.isPending.value"
        :error="orgs.isError.value ? 'Could not load the customers.' : null"
        :retrying="orgs.isFetching.value"
        :sort="sort"
        @sort="onSort"
        @retry="() => orgs.refetch()"
      >
        <template #cell-name="{ row }">
          <RouterLink :to="{ name: 'customer', params: { id: row.orgId } }" class="hover:underline">{{ row.name }}</RouterLink>
        </template>
        <template #cell-activeVehicleCount="{ row }">{{ row.activeVehicleCount }}/{{ row.vehicleCount }}</template>
        <template #cell-openAnomalyCount="{ value }">
          <span :class="value > 0 ? 'font-semibold text-danger-600' : 'text-ink-muted'">{{ value }}</span>
        </template>
        <template #cell-lastTxnAt="{ value }">
          <span v-if="value">{{ fmtDate(value) }}</span>
          <span v-else class="text-ink-tertiary">—</span>
        </template>
        <template #empty>
          <p v-if="search">No organization matches that.</p>
          <p v-else>No organizations yet.</p>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </AppShell>
</template>
