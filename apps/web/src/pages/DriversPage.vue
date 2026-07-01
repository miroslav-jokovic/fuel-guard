<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { PlusIcon, ArrowDownTrayIcon } from "@heroicons/vue/20/solid";
import type { Driver, DriverInput } from "@fuelguard/shared";
import { useSessionStore } from "@/stores/session";
import { useDriversQuery, useCreateDriver, useUpdateDriver, useSyncSamsaraDrivers } from "@/features/fleet/useDrivers";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import SlideOver from "@/components/SlideOver.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import AppSelect from "@/components/AppSelect.vue";
import SearchInput from "@/components/SearchInput.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import TablePagination from "@/components/TablePagination.vue";
import DriverForm from "@/features/fleet/DriverForm.vue";
import { useToastStore } from "@/stores/toast";

const PAGE_SIZE = 20;

const session = useSessionStore();
const { data: drivers, isLoading, isError, error, refetch, isFetching } = useDriversQuery();
const { data: vehicles } = useVehiclesQuery();
const createDriver = useCreateDriver();
const updateDriver = useUpdateDriver();

const toast = useToastStore();
const drawerOpen = ref(false);
const editing = ref<Driver | null>(null);

const saving = computed(() => createDriver.isPending.value || updateDriver.isPending.value);

const search = ref("");
const statusFilter = ref<string>("");
const statusOptions = computed(() => [
  { value: "", label: "All statuses" },
  ...[...new Set((drivers.value ?? []).map((d) => d.status))].map((s) => ({ value: s, label: s })),
]);

const filtered = computed(() => {
  const term = search.value.toLowerCase();
  return (drivers.value ?? []).filter((d) => {
    if (statusFilter.value && d.status !== statusFilter.value) return false;
    if (!term) return true;
    return [d.full_name, d.employee_id, d.phone]
      .filter(Boolean)
      .some((f) => f!.toLowerCase().includes(term));
  });
});

const page = ref(1);
watch([search, statusFilter], () => (page.value = 1));
const pageRows = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

// Vehicles assigned to a driver (assignment is set from the Vehicles page).
const assignedUnits = (driverId: string) =>
  (vehicles.value ?? [])
    .filter((v) => v.assigned_driver_id === driverId)
    .map((v) => v.unit_number)
    .join(", ") || "—";

function openNew() {
  editing.value = null;
  drawerOpen.value = true;
}
function openEdit(d: Driver) {
  editing.value = d;
  drawerOpen.value = true;
}

async function onSubmit(input: DriverInput) {
  try {
    if (editing.value) await updateDriver.mutateAsync({ id: editing.value.id, input });
    else await createDriver.mutateAsync(input);
    drawerOpen.value = false;
    toast.success(editing.value ? "Driver updated" : "Driver created");
  } catch (e) {
    toast.error("Could not save driver", e instanceof Error ? e.message : undefined);
  }
}

const syncSamsara = useSyncSamsaraDrivers();
async function onSyncSamsara() {
  try {
    const r = await syncSamsara.mutateAsync();
    toast.success(`Synced ${r.total} drivers from Samsara`, `${r.created} added, ${r.updated} updated`);
  } catch (e) {
    toast.error("Could not sync from Samsara", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p class="text-sm text-gray-500">
        Drivers in your fleet. Assign drivers to vehicles from the Vehicles page.
      </p>
      <div v-if="session.canManage" class="flex flex-wrap items-center gap-2">
        <button
          class="inline-flex items-center gap-x-1.5 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50"
          :disabled="syncSamsara.isPending.value"
          title="Import drivers from Samsara"
          @click="onSyncSamsara"
        >
          <ArrowDownTrayIcon class="-ml-0.5 size-5" aria-hidden="true" />
          {{ syncSamsara.isPending.value ? "Syncing…" : "Sync from Samsara" }}
        </button>
        <button
          class="inline-flex items-center gap-x-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
          @click="openNew"
        >
          <PlusIcon class="-ml-0.5 size-5" aria-hidden="true" /> New driver
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div class="sm:max-w-xs sm:flex-1">
        <SearchInput v-model="search" placeholder="Search name, employee ID, phone…" />
      </div>
      <AppSelect v-model="statusFilter" :options="statusOptions" class="sm:w-44" />
      <span class="text-sm text-gray-500 sm:ml-auto">{{ filtered.length }} total</span>
    </div>

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <TableSkeleton v-if="isLoading" :cols="6" />
      <ErrorState
        v-else-if="isError"
        :message="error instanceof Error ? error.message : 'Failed to load drivers'"
        :retrying="isFetching"
        @retry="refetch"
      />
      <div v-else-if="!drivers || drivers.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        No drivers yet.
      </div>
      <div v-else-if="filtered.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        No drivers match these filters.
      </div>
      <div v-else class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-sm">
        <thead class="text-left text-gray-500">
          <tr>
            <th class="px-6 py-3 font-medium">Name</th>
            <th class="px-6 py-3 font-medium">Employee ID</th>
            <th class="px-6 py-3 font-medium">Phone</th>
            <th class="px-6 py-3 font-medium">Vehicles</th>
            <th class="px-6 py-3 font-medium">Status</th>
            <th class="px-6 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="d in pageRows" :key="d.id">
            <td class="px-6 py-3 font-medium text-gray-900">{{ d.full_name }}</td>
            <td class="px-6 py-3 text-gray-700">{{ d.employee_id ?? "—" }}</td>
            <td class="px-6 py-3 text-gray-700">{{ d.phone ?? "—" }}</td>
            <td class="px-6 py-3 text-gray-700">{{ assignedUnits(d.id) }}</td>
            <td class="px-6 py-3"><StatusBadge :status="d.status" /></td>
            <td class="px-6 py-3 text-right">
              <button
                v-if="session.canManage"
                class="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                @click="openEdit(d)"
              >
                Edit
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
      <TablePagination
        v-if="!isLoading && !isError && filtered.length > 0"
        :page="page"
        :page-size="PAGE_SIZE"
        :total="filtered.length"
        @update:page="page = $event"
      />
    </div>

    <SlideOver :open="drawerOpen" :title="editing ? 'Edit driver' : 'New driver'" @close="drawerOpen = false">
      <DriverForm
        :driver="editing"
        :submitting="saving"
        @submit="onSubmit"
        @cancel="drawerOpen = false"
      />
    </SlideOver>
  </div>
</template>
