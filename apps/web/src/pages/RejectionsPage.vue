<script setup lang="ts">
import { ref, computed } from "vue";
import { useDeclinedTransactions, type EfsFilters } from "@/features/reports/useEfsData";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import AppSelect from "@/components/AppSelect.vue";
import SearchInput from "@/components/SearchInput.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";

const filters = ref<EfsFilters>({});
const { data, isLoading, isError, error, refetch, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage } =
  useDeclinedTransactions(filters);

const { data: vehicles } = useVehiclesQuery();
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

const rows = computed(() => data.value?.pages.flat() ?? []);
const fmt = (iso: string) => new Date(iso).toLocaleString();
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-gray-500">
      Declined fuel-card attempts from your uploaded EFS Reject reports (a fraud/control signal).
    </p>

    <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div class="lg:max-w-xs lg:flex-1">
        <SearchInput v-model="search" placeholder="Search driver, location, error…" />
      </div>
      <AppSelect v-model="unit" :options="unitOptions" class="lg:w-40" />
      <DateRangeFilter :from="filters.from" :to="filters.to" @update:from="setFrom" @update:to="setTo" />
      <span class="text-sm text-gray-500 lg:ml-auto">{{ rows.length }} loaded</span>
    </div>

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <TableSkeleton v-if="isLoading" :cols="6" />
      <ErrorState
        v-else-if="isError"
        :message="error instanceof Error ? error.message : 'Failed to load rejections'"
        :retrying="isFetching"
        @retry="refetch"
      />
      <div v-else-if="rows.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        No declined transactions match — upload an EFS Reject report from the Import page, or adjust filters.
      </div>
      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="text-left whitespace-nowrap text-gray-500">
            <tr>
              <th class="px-4 py-3 font-medium">Date / Time</th>
              <th class="px-4 py-3 font-medium">Card #</th>
              <th class="px-4 py-3 font-medium">Invoice</th>
              <th class="px-4 py-3 font-medium">Unit</th>
              <th class="px-4 py-3 font-medium">Driver</th>
              <th class="px-4 py-3 font-medium">Location</th>
              <th class="px-4 py-3 font-medium">City</th>
              <th class="px-4 py-3 font-medium">State</th>
              <th class="px-4 py-3 font-medium">Error</th>
              <th class="px-4 py-3 font-medium">Description</th>
              <th class="px-4 py-3 font-medium">Policy</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 whitespace-nowrap">
            <tr v-for="d in rows" :key="d.id">
              <td class="px-4 py-2 text-gray-700">{{ fmt(d.declined_at) }}</td>
              <td class="px-4 py-2 text-gray-700">{{ d.card_ref }}</td>
              <td class="px-4 py-2 text-gray-700">{{ d.invoice }}</td>
              <td class="px-4 py-2 font-medium text-gray-900">{{ d.unit }}</td>
              <td class="px-4 py-2 text-gray-700">{{ d.driver_name }}</td>
              <td class="px-4 py-2 text-gray-700">{{ d.location_text }}</td>
              <td class="px-4 py-2 text-gray-700">{{ d.city }}</td>
              <td class="px-4 py-2 text-gray-700">{{ d.state }}</td>
              <td class="px-4 py-2">
                <span class="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">{{ d.error_code }}</span>
              </td>
              <td class="max-w-md truncate px-4 py-2 text-gray-700" :title="d.error_description ?? ''">{{ d.error_description }}</td>
              <td class="px-4 py-2 text-gray-700">{{ d.policy_name?.trim() }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="hasNextPage" class="border-t border-gray-100 px-6 py-3 text-center">
        <button
          class="text-sm font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-50"
          :disabled="isFetchingNextPage"
          @click="fetchNextPage()"
        >
          {{ isFetchingNextPage ? "Loading…" : "Load more" }}
        </button>
      </div>
    </div>
  </div>
</template>
