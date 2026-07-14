<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useEfsTransactions, useEfsFacets, EFS_PAGE_SIZE, type EfsFilters } from "@/features/reports/useEfsData";
import AppSelect from "@/components/AppSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FilterBar, { type FilterChip } from "@/components/ui/FilterBar.vue";
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

const { data: facets } = useEfsFacets();

/** Two-way proxy into the filters object for one key ("" ⇄ undefined). */
const bind = (key: "unit" | "search" | "item" | "state" | "driver") =>
  computed({
    get: () => filters.value[key] ?? "",
    set: (v: string) => (filters.value = { ...filters.value, [key]: v || undefined }),
  });
const unit = bind("unit");
const search = bind("search");
const item = bind("item");
const state = bind("state");
const driver = bind("driver");
const setFrom = (v: string | undefined) => (filters.value = { ...filters.value, from: v });
const setTo = (v: string | undefined) => (filters.value = { ...filters.value, to: v });

const withAll = (label: string, vals: string[] = []) => [
  { value: "", label },
  ...vals.map((v) => ({ value: v, label: v })),
];
const itemOptions = computed(() => withAll("All items", facets.value?.txnItems));
const stateOptions = computed(() => withAll("All states", facets.value?.txnStates));
const driverOptions = computed(() => withAll("All drivers", facets.value?.txnDrivers));

/* Applied-filter chips (search shows live in the input, so no chip for it). */
const fmtChipDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const chips = computed<FilterChip[]>(() => {
  const f = filters.value;
  const out: FilterChip[] = [];
  if (f.unit) out.push({ key: "unit", label: "Unit", value: f.unit });
  if (f.item) out.push({ key: "item", label: "Item", value: f.item });
  if (f.from || f.to)
    out.push({
      key: "dates",
      label: "Dates",
      value: f.from && f.to ? `${fmtChipDay(f.from)} – ${fmtChipDay(f.to)}` : fmtChipDay((f.from ?? f.to)!),
    });
  if (f.state) out.push({ key: "state", label: "State", value: f.state });
  if (f.driver) out.push({ key: "driver", label: "Driver", value: f.driver });
  return out;
});
const moreCount = computed(() => (filters.value.state ? 1 : 0) + (filters.value.driver ? 1 : 0));
function removeChip(key: string) {
  if (key === "dates") filters.value = { ...filters.value, from: undefined, to: undefined };
  else filters.value = { ...filters.value, [key]: undefined };
}
function clearAll() {
  filters.value = { sortKey: filters.value.sortKey, sortDir: filters.value.sortDir };
}

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

    <FilterBar
      v-model:search="search"
      search-placeholder="Search driver, location, card, invoice…"
      :count="total"
      count-label="transactions"
      :chips="chips"
      :more-count="moreCount"
      @remove="removeChip"
      @clear-all="clearAll"
    >
      <template #filters>
        <AppSelect v-model="unit" :options="unitOptions" class="w-36" />
        <AppSelect v-model="item" :options="itemOptions" class="w-36" />
        <DateRangeFilter :from="filters.from" :to="filters.to" @update:from="setFrom" @update:to="setTo" />
      </template>
      <template #more>
        <div>
          <label class="mb-1 block text-xs font-medium text-ink-muted">State</label>
          <AppSelect v-model="state" :options="stateOptions" class="w-full" />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-ink-muted">Driver</label>
          <AppSelect v-model="driver" :options="driverOptions" class="w-full" />
        </div>
      </template>
    </FilterBar>

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
