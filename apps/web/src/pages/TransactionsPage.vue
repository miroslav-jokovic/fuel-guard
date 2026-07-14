<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useEfsTransactions, EFS_PAGE_SIZE, type EfsFilters } from "@/features/reports/useEfsData";
import AppSelect from "@/components/AppSelect.vue";
import SearchInput from "@/components/SearchInput.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import TablePagination from "@/components/TablePagination.vue";
import { toggleSort, type SortState } from "@/lib/sort";
import { stationTime } from "@/lib/stationTime";

const { data: vehicles } = useVehiclesQuery();
const filters = ref<EfsFilters>({});
const page = ref(1);
watch(filters, () => (page.value = 1), { deep: true });

const sort = ref<SortState>({ key: null, dir: "asc" });
function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
  filters.value = { ...filters.value, sortKey: sort.value.key ?? undefined, sortDir: sort.value.dir };
}

const { data, isLoading, isError, error, refetch, isFetching } = useEfsTransactions(filters, page);

const unitOptions = computed(() => [
  { value: "", label: "All units" },
  ...[...new Set((vehicles.value ?? []).map((v) => v.unit_number))].sort().map((u) => ({ value: u, label: u })),
]);

const unit = computed({
  get: () => filters.value.unit ?? "",
  set: (v: string) => (filters.value = { ...filters.value, unit: v || undefined }),
});
const search = computed({
  get: () => filters.value.search ?? "",
  set: (v: string) => (filters.value = { ...filters.value, search: v || undefined }),
});
const setFrom = (v: string | undefined) => (filters.value = { ...filters.value, from: v });
const setTo = (v: string | undefined) => (filters.value = { ...filters.value, to: v });

const rows = computed(() => data.value?.rows ?? []);
const total = computed(() => data.value?.total ?? 0);
// Consistent numeric formatting: thousands separators, "—" for null. Money shows 2 decimals.
const fmtNum = (v: number | null) => (v == null ? "—" : v.toLocaleString());
const fmtMoney = (v: number | null) => (v == null ? "—" : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const columns: DataTableColumn[] = [
  {
    key: "unit",
    label: "Unit",
    sortable: true,
    headerClass: "sticky left-0 z-20 bg-surface-subtle min-w-[5rem] border-r border-edge",
    cellClass: "sticky left-0 z-[1] border-r border-edge bg-surface font-medium text-ink group-hover:bg-surface-subtle",
  },
  { key: "tran_date", label: "Tran Date", sortable: true, headerClass: "min-w-[7rem]", cellClass: "text-ink-secondary" },
  { key: "tran_time", label: "Time", headerClass: "min-w-[5rem]", cellClass: "text-ink-secondary" },
  { key: "card_num", label: "Card #", headerClass: "min-w-[7rem]", cellClass: "text-ink-secondary" },
  { key: "invoice", label: "Invoice", headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "driver_name", label: "Driver", sortable: true, headerClass: "min-w-[9rem]", cellClass: "text-ink-secondary" },
  { key: "odometer", label: "Odometer", sortable: true, numeric: true, headerClass: "min-w-[8rem]", cellClass: "text-ink-secondary" },
  { key: "location_name", label: "Location", headerClass: "min-w-[12rem]", cellClass: "text-ink-secondary" },
  { key: "city", label: "City", headerClass: "min-w-[8rem]", cellClass: "text-ink-secondary" },
  { key: "state", label: "State", headerClass: "min-w-[4rem]", cellClass: "text-ink-secondary" },
  { key: "item", label: "Item", headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "unit_price", label: "Unit Price", numeric: true, headerClass: "min-w-[7rem]", cellClass: "text-ink-secondary" },
  { key: "qty", label: "Qty", sortable: true, numeric: true, headerClass: "min-w-[4rem]", cellClass: "text-ink-secondary" },
  { key: "amt", label: "Amt", sortable: true, numeric: true, headerClass: "min-w-[5rem]", cellClass: "text-ink-secondary" },
  { key: "fees", label: "Fees", numeric: true, headerClass: "min-w-[4rem]", cellClass: "text-ink-secondary" },
  { key: "db", label: "DB", headerClass: "min-w-[4rem]", cellClass: "text-ink-secondary" },
  { key: "currency", label: "Currency", headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Every line from your uploaded EFS Transaction reports, exactly as received." />

    <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div class="lg:max-w-xs lg:flex-1">
        <SearchInput v-model="search" placeholder="Search driver, location, item…" />
      </div>
      <AppSelect v-model="unit" :options="unitOptions" class="lg:w-40" />
      <DateRangeFilter :from="filters.from" :to="filters.to" @update:from="setFrom" @update:to="setTo" />
      <span class="text-sm text-ink-muted lg:ml-auto">{{ total }} total</span>
    </div>

    <DataTable
      :columns="columns"
      :rows="rows"
      row-key="id"
      dense
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load transactions') : null"
      :retrying="isFetching"
      :sort="sort"
      :row-class="() => 'group'"
      empty-text="No transactions match — upload an EFS Transaction report from the Import page, or adjust filters."
      @sort="onSort"
      @retry="refetch"
    >
      <template #cell-tran_time="{ row }">{{ row.tran_time || stationTime(row.fueled_at, row.state) }}</template>
      <template #cell-odometer="{ row }">{{ fmtNum(row.odometer) }}</template>
      <template #cell-unit_price="{ row }">{{ fmtMoney(row.unit_price) }}</template>
      <template #cell-qty="{ row }">{{ fmtNum(row.qty) }}</template>
      <template #cell-amt="{ row }">{{ fmtMoney(row.amt) }}</template>
      <template #cell-fees="{ row }">{{ fmtMoney(row.fees) }}</template>
      <template #footer>
        <TablePagination
          :page="page"
          :page-size="EFS_PAGE_SIZE"
          :total="total"
          :loading="isFetching"
          @update:page="page = $event"
        />
      </template>
    </DataTable>
  </div>
</template>
