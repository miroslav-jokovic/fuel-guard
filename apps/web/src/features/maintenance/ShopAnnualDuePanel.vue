<script setup lang="ts">
import { computed, watch } from "vue";
import { useRouter } from "vue-router";
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
import { inspectionExpiry, todayInZone, type AnnualDueDto } from "@silvicom/shared";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import { useAnnualDueQuery } from "@/features/maintenance/useShopBacklog";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useOpens } from "@/composables/useOpens";
import { formatDate } from "@/lib/format";

/**
 * Annual inspections due within 30 days or overdue, by our record (Q-MX5 (a)) — the Shop page's
 * Annual due tab (MAINTENANCE-SECTION-REDESIGN-PROPOSAL §7a.3, M6).
 *
 * Until M6 these were the home's group of five rows with "All N" pointing at the whole register, which
 * is a different list (every report ever filed) — so the "All" never showed what the group counted.
 * This is the whole of what the group counted, searchable and paged like every other tab. A row opens
 * the register on that unit, where the inspection is started or found.
 *
 * The list arrives whole (`GET /api/maintenance/annual-due`), so it searches, sorts and pages itself,
 * as `ShopWorkOrdersPanel` does. "Days left" is counted in the org's day (D-DS18).
 */

const PAGE_SIZE = 20;
const KIND_OPTIONS = [
  { value: "", label: "Trucks and trailers" },
  { value: "tractor", label: "Trucks" },
  { value: "trailer", label: "Trailers" },
];

const router = useRouter();
const opens = useOpens();
const qs = useQueryState();
const search = qs.param("search");
const kind = qs.param("kind", KIND_OPTIONS.map((o) => o.value));
const activeFilterCount = computed(() => [search.value.trim(), kind.value].filter(Boolean).length);
const clearAll = () => qs.set({ search: undefined, kind: undefined });

const { zone } = useOrgTimezone();
const due = useAnnualDueQuery();

type Row = AnnualDueDto & { daysLeft: number };
const rows = computed<Row[]>(() => {
  const today = todayInZone(new Date(), zone.value);
  const term = search.value.trim().toLowerCase();
  const all = (due.data.value ?? [])
    .map((r) => ({ ...r, daysLeft: inspectionExpiry(r.expiresOn, today).daysRemaining ?? r.daysRemaining }))
    .filter((r) => !kind.value || r.subjectType === kind.value)
    .filter((r) => !term || r.unitNumber.toLowerCase().includes(term));
  return sortRows(all, sort.value);
});

const page = qs.page();
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const COLUMNS: DataTableColumn[] = [
  { key: "unitNumber", label: "Unit", card: "title", sortable: true, cellClass: "font-medium text-ink", width: "sm" },
  { key: "daysLeft", label: "Due", card: "sentence", sortable: true },
  { key: "expiresOn", label: "Expires", card: "meta", sortable: true, width: "md" },
  { key: "subjectType", label: "Kind", card: "none", width: "sm", cellClass: "text-ink-secondary" },
];
const { sort, onSort } = useUrlSort(
  qs.param("sort", COLUMNS.filter((c) => c.sortable).map((c) => c.key)),
  qs.param("dir", SORT_DIRECTIONS),
);
watch([search, kind, () => sort.value.key, () => sort.value.dir], () => (page.value = 1));

/** "12 days left" / "3 days overdue" / "today", and how loud it is. */
function dueText(days: number): { text: string; tone: string } {
  const n = Math.abs(days);
  const unit = n === 1 ? "day" : "days";
  if (days < 0) return { text: `${n} ${unit} overdue`, tone: "font-medium text-danger-700" };
  if (days === 0) return { text: "Expires today", tone: "font-medium text-warning-700" };
  return { text: `${n} ${unit} left`, tone: days <= 7 ? "font-medium text-warning-700" : "text-ink-secondary" };
}

const registerOpen = computed(() => opens("/shop/inspections"));
const openRow = (r: Row) => {
  if (!registerOpen.value) return;
  void router.push({ path: "/shop/inspections", query: { type: r.subjectType === "tractor" ? undefined : "trailer", search: r.unitNumber } });
};
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-ink-tertiary">Annual inspections that expire within 30 days or already have, by our record. Open one to start its inspection.</p>

    <DataWorkspace>
      <FilterBar
        v-model:search="search"
        embedded
        search-placeholder="Search unit…"
        :count="rows.length"
        count-label="annual inspections due"
        :active-count="activeFilterCount"
        @clear-all="clearAll"
      >
        <template #filters>
          <FilterSelect v-model="kind" label="Kind" :options="KIND_OPTIONS" />
        </template>
      </FilterBar>

      <DataTable
        embedded
        :columns="COLUMNS"
        :rows="pageRows"
        row-key="unitId"
        :loading="due.isLoading.value"
        :error="due.isError.value ? 'Could not load the annual inspections due.' : null"
        :sort="sort"
        :row-class="() => (registerOpen ? 'cursor-pointer' : '')"
        @sort="onSort"
        @row-click="(row) => openRow(row as Row)"
        @retry="() => due.refetch()"
      >
        <template #cell-daysLeft="{ value }">
          <span :class="dueText(value).tone" data-test="annual-due-when">{{ dueText(value).text }}</span>
        </template>
        <template #cell-expiresOn="{ value }">{{ formatDate(value) }}</template>
        <template #cell-subjectType="{ value }">{{ value === "tractor" ? "Truck" : "Trailer" }}</template>
        <template #empty>
          <p v-if="activeFilterCount">No annual inspection due matches that.</p>
          <p v-else>No annual inspection is due in the next 30 days, and none is overdue.</p>
        </template>
        <template #footer>
          <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" @update:page="page = $event" />
        </template>
      </DataTable>
    </DataWorkspace>
  </div>
</template>
