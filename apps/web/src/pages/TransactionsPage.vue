<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useEfsTransactions, EFS_PAGE_SIZE, type EfsFilters } from "@/features/reports/useEfsData";
import AppSelect from "@/components/AppSelect.vue";
import SearchInput from "@/components/SearchInput.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import SortableTh from "@/components/SortableTh.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import TablePagination from "@/components/TablePagination.vue";
import { toggleSort, type SortState } from "@/lib/sort";

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

const search = computed({
  get: () => filters.value.search ?? "",
  set: (v: string) => (filters.value = { ...filters.value, search: v || undefined }),
});
const setFrom = (v: string | undefined) => (filters.value = { ...filters.value, from: v });
const setTo = (v: string | undefined) => (filters.value = { ...filters.value, to: v });

const rows = computed(() => data.value?.rows ?? []);
const total = computed(() => data.value?.total ?? 0);
const num = (v: number | null) => (v == null ? "" : v);
// Show the fueling time (UTC, as reported) — "—" when the report had date only.
const fmtTime = (iso: string | null) => {
  if (!iso) return "—";
  const hm = iso.slice(11, 16);
  return hm === "12:00" ? "—" : hm; // noon = our date-only sentinel
};
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-gray-500">
      Every line from your uploaded EFS Transaction reports, exactly as received.
    </p>

    <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div class="lg:max-w-xs lg:flex-1">
        <SearchInput v-model="search" placeholder="Search driver, location, item…" />
      </div>
      <AppSelect
        v-model="filters.unit"
        class="lg:w-40"
        :options="[
          { value: undefined, label: 'All units' },
          ...(vehicles ?? []).map((v) => ({ value: v.unit_number, label: v.unit_number })),
        ]"
      />
      <DateRangeFilter :from="filters.from" :to="filters.to" @update:from="setFrom" @update:to="setTo" />
      <span class="text-sm text-gray-500 lg:ml-auto">{{ total }} total</span>
    </div>

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <TableSkeleton v-if="isLoading" :cols="8" />
      <ErrorState
        v-else-if="isError"
        :message="error instanceof Error ? error.message : 'Failed to load transactions'"
        :retrying="isFetching"
        @retry="refetch"
      />
      <div v-else-if="rows.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        No transactions match — upload an EFS Transaction report from the Import page, or adjust filters.
      </div>
      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="text-left whitespace-nowrap text-gray-500">
            <tr>
              <SortableTh label="Tran Date" sort-key="tran_date" :active="sort.key" :dir="sort.dir" @sort="onSort" />
              <th class="px-4 py-3 font-medium">Time</th>
              <th class="px-4 py-3 font-medium">Card #</th>
              <th class="px-4 py-3 font-medium">Invoice</th>
              <SortableTh label="Unit" sort-key="unit" :active="sort.key" :dir="sort.dir" @sort="onSort" />
              <SortableTh label="Driver" sort-key="driver_name" :active="sort.key" :dir="sort.dir" @sort="onSort" />
              <SortableTh label="Odometer" sort-key="odometer" :active="sort.key" :dir="sort.dir" @sort="onSort" />
              <th class="px-4 py-3 font-medium">Location</th>
              <th class="px-4 py-3 font-medium">City</th>
              <th class="px-4 py-3 font-medium">State</th>
              <th class="px-4 py-3 font-medium">Item</th>
              <th class="px-4 py-3 font-medium">Unit Price</th>
              <SortableTh label="Qty" sort-key="qty" :active="sort.key" :dir="sort.dir" @sort="onSort" />
              <SortableTh label="Amt" sort-key="amt" :active="sort.key" :dir="sort.dir" @sort="onSort" />
              <th class="px-4 py-3 font-medium">Fees</th>
              <th class="px-4 py-3 font-medium">DB</th>
              <th class="px-4 py-3 font-medium">Currency</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 whitespace-nowrap">
            <tr v-for="t in rows" :key="t.id">
              <td class="px-4 py-2 text-gray-700">{{ t.tran_date }}</td>
              <td class="px-4 py-2 text-gray-700">{{ fmtTime(t.fueled_at) }}</td>
              <td class="px-4 py-2 text-gray-700">{{ t.card_num }}</td>
              <td class="px-4 py-2 text-gray-700">{{ t.invoice }}</td>
              <td class="px-4 py-2 font-medium text-gray-900">{{ t.unit }}</td>
              <td class="px-4 py-2 text-gray-700">{{ t.driver_name }}</td>
              <td class="px-4 py-2 text-gray-700">{{ num(t.odometer) }}</td>
              <td class="px-4 py-2 text-gray-700">{{ t.location_name }}</td>
              <td class="px-4 py-2 text-gray-700">{{ t.city }}</td>
              <td class="px-4 py-2 text-gray-700">{{ t.state }}</td>
              <td class="px-4 py-2 text-gray-700">{{ t.item }}</td>
              <td class="px-4 py-2 text-gray-700">{{ num(t.unit_price) }}</td>
              <td class="px-4 py-2 text-gray-700">{{ num(t.qty) }}</td>
              <td class="px-4 py-2 text-gray-700">{{ num(t.amt) }}</td>
              <td class="px-4 py-2 text-gray-700">{{ num(t.fees) }}</td>
              <td class="px-4 py-2 text-gray-700">{{ t.db }}</td>
              <td class="px-4 py-2 text-gray-700">{{ t.currency }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <TablePagination
        v-if="!isLoading && !isError && total > 0"
        :page="page"
        :page-size="EFS_PAGE_SIZE"
        :total="total"
        :loading="isFetching"
        @update:page="page = $event"
      />
    </div>
  </div>
</template>
