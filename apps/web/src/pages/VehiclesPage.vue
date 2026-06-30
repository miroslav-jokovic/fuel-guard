<script setup lang="ts">
import { ref, computed } from "vue";
import { PlusIcon } from "@heroicons/vue/20/solid";
import { VEHICLE_STATUSES, type Vehicle, type VehicleInput } from "@fleetguard/shared";
import { useSessionStore } from "@/stores/session";
import { useVehiclesQuery, useCreateVehicle, useUpdateVehicle, useRetireVehicle } from "@/features/fleet/useVehicles";
import { useDriversQuery } from "@/features/fleet/useDrivers";
import SlideOver from "@/components/SlideOver.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import AppSelect from "@/components/AppSelect.vue";
import SearchInput from "@/components/SearchInput.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import VehicleForm from "@/features/fleet/VehicleForm.vue";
import { useToastStore } from "@/stores/toast";

const session = useSessionStore();
const { data: vehicles, isLoading, isError, error, refetch, isFetching } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();

const search = ref("");
const statusFilter = ref<string>("");
const statusOptions = [
  { value: "", label: "All statuses" },
  ...VEHICLE_STATUSES.map((s) => ({ value: s, label: s })),
];

const filtered = computed(() => {
  const term = search.value.toLowerCase();
  return (vehicles.value ?? []).filter((v) => {
    if (statusFilter.value && v.status !== statusFilter.value) return false;
    if (!term) return true;
    return [v.unit_number, v.make, v.model, v.plate, v.vin, String(v.year ?? "")]
      .filter(Boolean)
      .some((f) => f!.toLowerCase().includes(term));
  });
});
const createVehicle = useCreateVehicle();
const updateVehicle = useUpdateVehicle();
const retireVehicle = useRetireVehicle();

const toast = useToastStore();
const drawerOpen = ref(false);
const editing = ref<Vehicle | null>(null);

const driverName = (id: string | null) =>
  id ? (drivers.value?.find((d) => d.id === id)?.full_name ?? "—") : "—";

const saving = computed(() => createVehicle.isPending.value || updateVehicle.isPending.value);

function openNew() {
  editing.value = null;
  drawerOpen.value = true;
}
function openEdit(v: Vehicle) {
  editing.value = v;
  drawerOpen.value = true;
}

async function onSubmit(input: VehicleInput) {
  try {
    if (editing.value) await updateVehicle.mutateAsync({ id: editing.value.id, input });
    else await createVehicle.mutateAsync(input);
    drawerOpen.value = false;
    toast.success(editing.value ? "Vehicle updated" : "Vehicle created");
  } catch (e) {
    toast.error("Could not save vehicle", e instanceof Error ? e.message : undefined);
  }
}

async function onRetire(v: Vehicle) {
  if (confirm(`Retire vehicle ${v.unit_number}? Its history is preserved.`)) {
    try {
      await retireVehicle.mutateAsync(v.id);
      toast.success(`Vehicle ${v.unit_number} retired`);
    } catch (e) {
      toast.error("Could not retire vehicle", e instanceof Error ? e.message : undefined);
    }
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <p class="text-sm text-gray-500">Fleet vehicles and their fuel parameters.</p>
      <button
        v-if="session.canManage"
        class="inline-flex items-center gap-x-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
        @click="openNew"
      >
        <PlusIcon class="-ml-0.5 size-5" aria-hidden="true" /> New vehicle
      </button>
    </div>

    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div class="sm:max-w-xs sm:flex-1">
        <SearchInput v-model="search" placeholder="Search unit, make, model, plate, VIN…" />
      </div>
      <AppSelect v-model="statusFilter" :options="statusOptions" class="sm:w-44" />
      <span class="text-sm text-gray-500 sm:ml-auto">{{ filtered.length }} shown</span>
    </div>

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <TableSkeleton v-if="isLoading" :cols="8" />
      <ErrorState
        v-else-if="isError"
        :message="error instanceof Error ? error.message : 'Failed to load vehicles'"
        :retrying="isFetching"
        @retry="refetch"
      />
      <div v-else-if="!vehicles || vehicles.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        No vehicles yet.
      </div>
      <div v-else-if="filtered.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        No vehicles match these filters.
      </div>
      <table v-else class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="text-left text-gray-500">
          <tr>
            <th class="px-6 py-3 font-medium">Unit</th>
            <th class="px-6 py-3 font-medium">Vehicle</th>
            <th class="px-6 py-3 font-medium">Fuel</th>
            <th class="px-6 py-3 font-medium">Tank</th>
            <th class="px-6 py-3 font-medium">Baseline MPG</th>
            <th class="px-6 py-3 font-medium">Driver</th>
            <th class="px-6 py-3 font-medium">Status</th>
            <th class="px-6 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="v in filtered" :key="v.id">
            <td class="px-6 py-3 font-medium">
              <RouterLink :to="`/vehicles/${v.id}`" class="text-indigo-600 hover:text-indigo-500">{{ v.unit_number }}</RouterLink>
            </td>
            <td class="px-6 py-3 text-gray-700">{{ [v.year, v.make, v.model].filter(Boolean).join(" ") || "—" }}</td>
            <td class="px-6 py-3 capitalize text-gray-700">{{ v.fuel_type }}</td>
            <td class="px-6 py-3 text-gray-700">{{ v.tank_capacity_gal }} gal</td>
            <td class="px-6 py-3 text-gray-700">{{ v.baseline_mpg ?? "—" }}</td>
            <td class="px-6 py-3 text-gray-700">{{ driverName(v.assigned_driver_id) }}</td>
            <td class="px-6 py-3"><StatusBadge :status="v.status" /></td>
            <td class="px-6 py-3 text-right whitespace-nowrap">
              <template v-if="session.canManage">
                <button class="text-sm font-medium text-indigo-600 hover:text-indigo-500" @click="openEdit(v)">
                  Edit
                </button>
                <button
                  v-if="v.status !== 'retired'"
                  class="ml-4 text-sm font-medium text-red-600 hover:text-red-500"
                  @click="onRetire(v)"
                >
                  Retire
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <SlideOver :open="drawerOpen" :title="editing ? 'Edit vehicle' : 'New vehicle'" @close="drawerOpen = false">
      <VehicleForm
        :vehicle="editing"
        :drivers="drivers ?? []"
        :submitting="saving"
        @submit="onSubmit"
        @cancel="drawerOpen = false"
      />
    </SlideOver>
  </div>
</template>
