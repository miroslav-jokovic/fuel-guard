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
import { daysSince, shopDayOf, todayInZone, type ShopWorkOrderDto } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import { useOpenWorkOrdersQuery } from "@/features/maintenance/useShopBacklog";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { formatDate } from "@/lib/format";

/**
 * Open work orders — FleetPal's in-flight repairs (FLEET-MANAGER-HOME-PLAN Q-FM6 (a)).
 *
 * ── IT IS THE LIST BEHIND A NUMBER, SO IT HAS NO STATUS FILTER ────────────────────────────────
 * The Operations tab's Shop card says "Open work orders 24" and links here, and D-FM9 holds that the
 * page then shows exactly those 24. A status filter would make the page's resting answer something
 * other than the card's; history (5,400 settled orders) is FleetPal's to show, not this list's.
 *
 * ── READ-ONLY, BECAUSE THE REPAIR IS WORKED IN FLEETPAL (D-INV10) ─────────────────────────────
 * No row opens and no row has a verb. The reference number is what a technician types into FleetPal.
 *
 * ── THE LIST ARRIVES WHOLE, SO IT SEARCHES, SORTS AND PAGES ITSELF ───────────────────────────
 * Same footing as `UnitsPage.vue`: the count in the toolbar is the whole answer, never a page's.
 * "Opened" is the carrier's calendar day (`shopDayOf`), and "Open for" counts from it, the same
 * definition the card's oldest-order line uses.
 */

const PAGE_SIZE = 20;

const qs = useQueryState();
const search = qs.param("search");
const activeFilterCount = computed(() => (search.value.trim() ? 1 : 0));

const { zone } = useOrgTimezone();
const orders = useOpenWorkOrdersQuery();

type Row = ShopWorkOrderDto & { openedDay: string | null; openFor: number | null };
const rows = computed<Row[]>(() => {
  const today = todayInZone(new Date(), zone.value);
  const term = search.value.trim().toLowerCase();
  const all = (orders.data.value ?? []).map((o) => ({
    ...o,
    openedDay: o.openedAt ? shopDayOf(o.openedAt, zone.value) : null,
    openFor: o.openedAt ? daysSince(o.openedAt, today, zone.value) : null,
  }));
  const found = term
    ? all.filter((o) => [o.referenceNumber, o.unitNumber, o.description].some((v) => v?.toLowerCase().includes(term)))
    : all;
  return sortRows(found, sort.value);
});

const page = qs.page();
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const COLUMNS: DataTableColumn[] = [
  { key: "referenceNumber", label: "Work order", card: "none", sortable: true, cellClass: "font-medium text-ink", width: "md" },
  { key: "unitNumber", label: "Unit", card: "title", sortable: true, cellClass: "text-ink-secondary", width: "sm" },
  { key: "description", label: "Description", card: "sentence" },
  { key: "priority", label: "Priority", card: "none", sortable: true, cellClass: "text-ink-secondary", width: "sm" },
  { key: "openedDay", label: "Opened", card: "none", sortable: true, width: "sm" },
  { key: "openFor", label: "Open for", card: "meta", sortable: true, numeric: true, width: "sm" },
];
const { sort, onSort } = useUrlSort(
  qs.param("sort", COLUMNS.filter((c) => c.sortable).map((c) => c.key)),
  qs.param("dir", SORT_DIRECTIONS),
);
watch([search, () => sort.value.key, () => sort.value.dir], () => (page.value = 1));
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Repairs FleetPal has open, oldest first. They are worked and closed in FleetPal." />

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search work order or unit…"
        :count="rows.length"
        count-label="open work orders"
        :active-count="activeFilterCount"
        @clear-all="search = ''"
      />

      <DataTable
        embedded
        :columns="COLUMNS"
        :rows="pageRows"
        row-key="id"
        :loading="orders.isLoading.value"
        :error="orders.isError.value ? 'Could not load the open work orders.' : null"
        :sort="sort"
        @sort="onSort"
        @retry="() => orders.refetch()"
      >
        <template #cell-referenceNumber="{ value }">{{ value ?? "—" }}</template>
        <template #cell-unitNumber="{ value }">{{ value ?? "—" }}</template>
        <template #cell-description="{ value }">
          <span v-if="value" class="line-clamp-2">{{ value }}</span>
          <span v-else class="text-ink-tertiary">—</span>
        </template>
        <template #cell-priority="{ value }">{{ value ?? "—" }}</template>
        <template #cell-openedDay="{ value }">{{ value ? formatDate(value) : "—" }}</template>
        <template #cell-openFor="{ value }">
          <span v-if="value == null" class="text-ink-tertiary">—</span>
          <span v-else>{{ value === 1 ? "1 day" : `${value} days` }}</span>
        </template>
        <template #empty>
          <p v-if="search">No open work order matches that.</p>
          <p v-else>No open work orders. FleetPal has nothing in progress.</p>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
