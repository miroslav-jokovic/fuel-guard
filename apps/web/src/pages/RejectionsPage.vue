<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useDeclinedTransactions, EFS_PAGE_SIZE, type EfsFilters } from "@/features/reports/useEfsData";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import AppSelect from "@/components/AppSelect.vue";
import SearchInput from "@/components/SearchInput.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import SortableTh from "@/components/SortableTh.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import TablePagination from "@/components/TablePagination.vue";
import { toggleSort, type SortState } from "@/lib/sort";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { BADGE_BASE, suspicionTone } from "@/lib/badges";

const session = useSessionStore();
const toast = useToastStore();
const filters = ref<EfsFilters>({});
const page = ref(1);
watch(filters, () => (page.value = 1), { deep: true });

const sort = ref<SortState>({ key: null, dir: "asc" });
function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
  filters.value = { ...filters.value, sortKey: sort.value.key ?? undefined, sortDir: sort.value.dir };
}

const { data, isLoading, isError, error, refetch, isFetching } = useDeclinedTransactions(filters, page);

const { data: vehicles } = useVehiclesQuery();
const unitOptions = computed(() => [
  { value: "", label: "All units" },
  ...[...new Set((vehicles.value ?? []).map((v) => v.unit_number))].sort().map((u) => ({ value: u, label: u })),
]);

const unit = computed({
  get: () => filters.value.unit ?? "",
  set: (v: string) => (filters.value = { ...filters.value, unit: v || undefined }),
});
const suspicion = computed({
  get: () => filters.value.suspicion ?? "",
  set: (v: string) => (filters.value = { ...filters.value, suspicion: v || undefined }),
});
const search = computed({
  get: () => filters.value.search ?? "",
  set: (v: string) => (filters.value = { ...filters.value, search: v || undefined }),
});
const setFrom = (v: string | undefined) => (filters.value = { ...filters.value, from: v });
const setTo = (v: string | undefined) => (filters.value = { ...filters.value, to: v });

const rows = computed(() => data.value?.rows ?? []);
const total = computed(() => data.value?.total ?? 0);
const fmt = (iso: string) => new Date(iso).toLocaleString();

const rescoring = ref(false);
async function rescore() {
  rescoring.value = true;
  const res = await apiFetch("/api/transactions/rescore-declined", { method: "POST" });
  rescoring.value = false;
  if (res.ok) toast.success("Rescoring started", "Checking each declined attempt against Samsara — refresh in a minute.");
  else toast.error("Could not start rescore", res.error?.message);
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-gray-500">
      Declined fuel-card attempts from your uploaded EFS Reject reports (a fraud/control signal).
    </p>

    <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div class="lg:max-w-xs lg:flex-1">
        <SearchInput v-model="search" placeholder="Search unit, driver, location…" />
      </div>
      <AppSelect
        v-model="suspicion"
        :options="[
          { value: '', label: 'All attempts' },
          { value: 'alert', label: 'Alert' },
          { value: 'review', label: 'Review' },
          { value: 'clear', label: 'Clear' },
        ]"
        class="lg:w-36"
      />
      <AppSelect v-model="unit" :options="unitOptions" class="lg:w-40" />
      <DateRangeFilter :from="filters.from" :to="filters.to" @update:from="setFrom" @update:to="setTo" />
      <div class="flex items-center gap-3 lg:ml-auto">
        <span class="text-sm text-gray-500">{{ total }} total</span>
        <button
          v-if="session.canManage"
          :disabled="rescoring"
          class="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50"
          title="Check each declined attempt against Samsara + card patterns"
          @click="rescore"
        >
          {{ rescoring ? "Rescoring…" : "Rescore" }}
        </button>
      </div>
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
          <thead class="bg-gray-50 text-left whitespace-nowrap text-gray-500">
            <tr>
              <SortableTh label="Unit" sort-key="unit" :active="sort.key" :dir="sort.dir" th-class="sticky left-0 z-20 bg-gray-50 px-4 py-3 font-medium min-w-[5rem] border-r border-gray-200" @sort="onSort" />
              <SortableTh label="Risk" sort-key="suspicion_level" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium min-w-[5rem]" @sort="onSort" />
              <SortableTh label="Date / Time" sort-key="declined_at" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium min-w-[10rem]" @sort="onSort" />
              <th class="px-4 py-3 font-medium min-w-[7rem]">Card #</th>
              <th class="px-4 py-3 font-medium min-w-[6rem]">Invoice</th>
              <SortableTh label="Driver" sort-key="driver_name" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium min-w-[9rem]" @sort="onSort" />
              <th class="px-4 py-3 font-medium min-w-[12rem]">Location</th>
              <th class="px-4 py-3 font-medium min-w-[8rem]">City</th>
              <SortableTh label="State" sort-key="state" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium min-w-[4rem]" @sort="onSort" />
              <SortableTh label="Error" sort-key="error_code" :active="sort.key" :dir="sort.dir" th-class="px-4 py-3 font-medium min-w-[5rem]" @sort="onSort" />
              <th class="px-4 py-3 font-medium min-w-[14rem]">Description</th>
              <th class="px-4 py-3 font-medium min-w-[8rem]">Policy</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 whitespace-nowrap">
            <tr v-for="d in rows" :key="d.id" class="group hover:bg-gray-50">
              <td class="sticky left-0 z-[1] border-r border-gray-200 bg-white px-4 py-2 font-medium text-gray-900 group-hover:bg-gray-50">{{ d.unit }}</td>
              <td class="px-4 py-2">
                <span
                  v-if="d.suspicion_level && d.suspicion_level !== 'clear'"
                  :class="[BADGE_BASE, suspicionTone(d.suspicion_level)]"
                  :title="(d.suspicion_reasons ?? []).map((r) => r.detail).join(' · ')"
                  >{{ d.suspicion_level }}</span
                >
                <span v-else-if="d.suspicion_level === 'clear'" class="text-xs text-gray-400">Clear</span>
                <span v-else class="text-xs text-gray-300">—</span>
              </td>
              <td class="px-4 py-2 text-gray-700">{{ fmt(d.declined_at) }}</td>
              <td class="px-4 py-2 text-gray-700">{{ d.card_ref }}</td>
              <td class="px-4 py-2 text-gray-700">{{ d.invoice }}</td>
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
