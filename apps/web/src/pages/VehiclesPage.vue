<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { PlusIcon, ArrowDownTrayIcon } from "@heroicons/vue/20/solid";
import { VEHICLE_STATUSES, type Vehicle, type VehicleInput } from "@fuelguard/shared";
import { useSessionStore } from "@/stores/session";
import { useVehiclesQuery, useCreateVehicle, useUpdateVehicle, useRetireVehicle, useSyncSamsaraVehicles } from "@/features/fleet/useVehicles";
import { useDriversQuery } from "@/features/fleet/useDrivers";
import SlideOver from "@/components/SlideOver.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import AppSelect from "@/components/AppSelect.vue";
import SearchInput from "@/components/SearchInput.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import TablePagination from "@/components/TablePagination.vue";
import VehicleForm from "@/features/fleet/VehicleForm.vue";
import { useToastStore } from "@/stores/toast";
import { apiFetch } from "@/lib/api";

const PAGE_SIZE = 20;
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

const page = ref(1);
watch([search, statusFilter], () => (page.value = 1));
const pageRows = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const createVehicle = useCreateVehicle();
const updateVehicle = useUpdateVehicle();
const retireVehicle = useRetireVehicle();

const toast = useToastStore();
const drawerOpen = ref(false);
const editing = ref<Vehicle | null>(null);

const driverName = (id: string | null) =>
  id ? (drivers.value?.find((d) => d.id === id)?.full_name ?? "—") : "—";

// Fuel vehicles (diesel/gasoline) need a tank capacity + baseline MPG for the detection engine.
// Samsara can't provide these, so flag them as "setup needed" after a sync.
const needsSetup = (v: Vehicle) =>
  (v.fuel_type === "diesel" || v.fuel_type === "gasoline") &&
  (Number(v.tank_capacity_gal) <= 0 || !v.baseline_mpg);

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

// Samsara diagnostics — probe each endpoint and show the raw report.
const diagOpen = ref(false);
const diagLoading = ref(false);
const diagReport = ref("");
async function runDiagnostics() {
  diagLoading.value = true;
  try {
    const res = await apiFetch("/api/integrations/samsara/diagnostics", { method: "POST" });
    diagReport.value = JSON.stringify(res.ok ? res.data : res.error, null, 2);
    diagOpen.value = true;
  } catch (e) {
    toast.error("Diagnostics failed", e instanceof Error ? e.message : undefined);
  } finally {
    diagLoading.value = false;
  }
}
async function copyDiag() {
  try {
    await navigator.clipboard.writeText(diagReport.value);
    toast.success("Copied to clipboard");
  } catch {
    /* clipboard may be blocked */
  }
}

const syncSamsara = useSyncSamsaraVehicles();
async function onSyncSamsara() {
  try {
    const r = await syncSamsara.mutateAsync();
    const parts = [`${r.created} added`, `${r.updated} updated`, `${r.assigned} driver assignment(s)`];
    toast.success(
      `Synced ${r.total} vehicles from Samsara`,
      r.needsCompletion.length
        ? `${parts.join(", ")}. Set tank capacity + baseline MPG for ${r.needsCompletion.length} new truck(s).`
        : parts.join(", "),
    );
  } catch (e) {
    toast.error("Could not sync from Samsara", e instanceof Error ? e.message : undefined);
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
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p class="text-sm text-gray-500">Fleet vehicles and their fuel parameters.</p>
      <div v-if="session.canManage" class="flex flex-wrap items-center gap-2">
        <!-- Diagnostics button hidden; logic kept for future use. Re-enable by removing v-show="false". -->
        <button
          v-if="session.admin"
          v-show="false"
          class="inline-flex items-center gap-x-1.5 rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-600 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50"
          :disabled="diagLoading"
          title="Check what Samsara returns for vehicles, stats, drivers and assignments"
          @click="runDiagnostics"
        >
          {{ diagLoading ? "Checking…" : "Diagnostics" }}
        </button>
        <button
          class="inline-flex items-center gap-x-1.5 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50"
          :disabled="syncSamsara.isPending.value"
          title="Import trucks from Samsara (trailers are excluded)"
          @click="onSyncSamsara"
        >
          <ArrowDownTrayIcon class="-ml-0.5 size-5" aria-hidden="true" />
          {{ syncSamsara.isPending.value ? "Syncing…" : "Sync from Samsara" }}
        </button>
        <button
          class="inline-flex items-center gap-x-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
          @click="openNew"
        >
          <PlusIcon class="-ml-0.5 size-5" aria-hidden="true" /> New vehicle
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div class="sm:max-w-xs sm:flex-1">
        <SearchInput v-model="search" placeholder="Search unit, make, model, plate, VIN…" />
      </div>
      <AppSelect v-model="statusFilter" :options="statusOptions" class="sm:w-44" />
      <span class="text-sm text-gray-500 sm:ml-auto">{{ filtered.length }} total</span>
    </div>

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <TableSkeleton v-if="isLoading" :cols="10" />
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
      <div v-else class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-sm">
        <thead class="text-left text-gray-500">
          <tr>
            <th class="px-6 py-3 font-medium">Unit</th>
            <th class="px-6 py-3 font-medium">Vehicle</th>
            <th class="px-6 py-3 font-medium">Fuel</th>
            <th class="px-6 py-3 font-medium">Tank</th>
            <th class="px-6 py-3 font-medium">Baseline MPG</th>
            <th class="px-6 py-3 font-medium">Fuel level</th>
            <th class="px-6 py-3 font-medium">Odometer</th>
            <th class="px-6 py-3 font-medium">Driver</th>
            <th class="px-6 py-3 font-medium">Status</th>
            <th class="px-6 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="v in pageRows" :key="v.id">
            <td class="px-6 py-3 font-medium">
              <RouterLink :to="`/vehicles/${v.id}`" class="text-indigo-600 hover:text-indigo-500">{{ v.unit_number }}</RouterLink>
            </td>
            <td class="px-6 py-3 text-gray-700">{{ [v.year, v.make, v.model].filter(Boolean).join(" ") || "—" }}</td>
            <td class="px-6 py-3 capitalize text-gray-700">{{ v.fuel_type }}</td>
            <td class="px-6 py-3 text-gray-700">
              <span v-if="Number(v.tank_capacity_gal) > 0">{{ v.tank_capacity_gal }} gal</span>
              <span v-else-if="needsSetup(v)" class="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-600/20 ring-inset">Set tank</span>
              <span v-else class="text-gray-400">—</span>
            </td>
            <td class="px-6 py-3 text-gray-700">
              <span v-if="v.baseline_mpg">{{ v.baseline_mpg }}</span>
              <span v-else-if="needsSetup(v)" class="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-600/20 ring-inset">Set MPG</span>
              <span v-else class="text-gray-400">—</span>
            </td>
            <td class="px-6 py-3 text-gray-700">
              <span v-if="v.samsara_fuel_percent != null">{{ v.samsara_fuel_percent }}%</span>
              <span v-else class="text-gray-400">—</span>
            </td>
            <td class="px-6 py-3 text-gray-700">
              <span v-if="Number(v.current_odometer) > 0">{{ Math.round(Number(v.current_odometer)).toLocaleString() }} mi</span>
              <span v-else class="text-gray-400">—</span>
            </td>
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
      <TablePagination
        v-if="!isLoading && !isError && filtered.length > 0"
        :page="page"
        :page-size="PAGE_SIZE"
        :total="filtered.length"
        @update:page="page = $event"
      />
    </div>

    <SlideOver :open="diagOpen" title="Samsara diagnostics" @close="diagOpen = false">
      <p class="mb-3 text-sm text-gray-500">
        What Samsara returns for each endpoint. Check <code>scopes</code> (403 = missing scope),
        <code>stats.withFuelPercents</code> (fuel level), and <code>assignments</code> (driver links).
      </p>
      <button
        class="mb-3 rounded-md bg-gray-100 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
        @click="copyDiag"
      >
        Copy report
      </button>
      <pre class="overflow-x-auto rounded-md bg-gray-900 p-3 text-xs leading-relaxed text-gray-100">{{ diagReport }}</pre>
    </SlideOver>

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
