<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useEfsTransactions, EFS_PAGE_SIZE, type EfsFilters } from "@/features/reports/useEfsData";
import AppSelect from "@/components/AppSelect.vue";
import SearchInput from "@/components/SearchInput.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import SortableTh from "@/components/SortableTh.vue";
import DataTable from "@/components/ui/DataTable.vue";
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
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load transactions') : null"
      :retrying="isFetching"
      :empty="rows.length === 0"
      empty-text="No transactions match — upload an EFS Transaction report from the Import page, or adjust filters."
      :skeleton-cols="17"
      @retry="refetch"
    >
      <template #head>
        <tr>
          <SortableTh label="Unit" sort-key="unit" :active="sort.key" :dir="sort.dir" th-class="sticky left-0 z-20 bg-surface-subtle px-4 py-3 font-medium min-w-[5rem] border-r border-edge" @sort="onSort" />
          <SortableTh label="Tran Date" sort-key="tran_date" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium min-w-[7rem]" @sort="onSort" />
          <th class="px-4 py-3 font-medium min-w-[5rem]">Time</th>
          <th class="px-4 py-3 font-medium min-w-[7rem]">Card #</th>
          <th class="px-4 py-3 font-medium min-w-[6rem]">Invoice</th>
          <SortableTh label="Driver" sort-key="driver_name" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium min-w-[9rem]" @sort="onSort" />
          <SortableTh label="Odometer" sort-key="odometer" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium min-w-[8rem] text-right" @sort="onSort" />
          <th class="px-4 py-3 font-medium min-w-[12rem]">Location</th>
          <th class="px-4 py-3 font-medium min-w-[8rem]">City</th>
          <th class="px-4 py-3 font-medium min-w-[4rem]">State</th>
          <th class="px-4 py-3 font-medium min-w-[6rem]">Item</th>
          <th class="px-4 py-3 font-medium min-w-[7rem] text-right">Unit Price</th>
          <SortableTh label="Qty" sort-key="qty" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium min-w-[4rem] text-right" @sort="onSort" />
          <SortableTh label="Amt" sort-key="amt" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium min-w-[5rem] text-right" @sort="onSort" />
          <th class="px-4 py-3 font-medium min-w-[4rem] text-right">Fees</th>
          <th class="px-4 py-3 font-medium min-w-[4rem]">DB</th>
          <th class="px-4 py-3 font-medium min-w-[6rem]">Currency</th>
        </tr>
      </template>
      <tr v-for="t in rows" :key="t.id" class="group hover:bg-surface-subtle">
        <td class="sticky left-0 z-[1] border-r border-edge bg-surface px-4 py-2 font-medium text-ink group-hover:bg-surface-subtle">{{ t.unit }}</td>
        <td class="px-4 py-2 text-ink-secondary">{{ t.tran_date }}</td>
        <td class="px-4 py-2 text-ink-secondary">{{ t.tran_time || stationTime(t.fueled_at, t.state) }}</td>
        <td class="px-4 py-2 text-ink-secondary">{{ t.card_num }}</td>
        <td class="px-4 py-2 text-ink-secondary">{{ t.invoice }}</td>
        <td class="px-4 py-2 text-ink-secondary">{{ t.driver_name }}</td>
        <td class="px-4 py-2 text-right text-ink-secondary tabular-nums">{{ fmtNum(t.odometer) }}</td>
        <td class="px-4 py-2 text-ink-secondary">{{ t.location_name }}</td>
        <td class="px-4 py-2 text-ink-secondary">{{ t.city }}</td>
        <td class="px-4 py-2 text-ink-secondary">{{ t.state }}</td>
        <td class="px-4 py-2 text-ink-secondary">{{ t.item }}</td>
        <td class="px-4 py-2 text-right text-ink-secondary tabular-nums">{{ fmtMoney(t.unit_price) }}</td>
        <td class="px-4 py-2 text-right text-ink-secondary tabular-nums">{{ fmtNum(t.qty) }}</td>
        <td class="px-4 py-2 text-right text-ink-secondary tabular-nums">{{ fmtMoney(t.amt) }}</td>
        <td class="px-4 py-2 text-right text-ink-secondary tabular-nums">{{ fmtMoney(t.fees) }}</td>
        <td class="px-4 py-2 text-ink-secondary">{{ t.db }}</td>
        <td class="px-4 py-2 text-ink-secondary">{{ t.currency }}</td>
      </tr>
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
