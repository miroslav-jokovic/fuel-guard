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
import KebabMenu from "@/components/KebabMenu.vue";
import SortableTh from "@/components/SortableTh.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import VehicleForm from "@/features/fleet/VehicleForm.vue";
import VehicleSetupImport from "@/features/fleet/VehicleSetupImport.vue";
import { useToastStore } from "@/stores/toast";
import { apiFetch } from "@/lib/api";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { toggleSort, sortRows, type SortState } from "@/lib/sort";

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

const sort = ref<SortState>({ key: null, dir: "asc" });
function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
}
const getVal = (v: Vehicle, key: string): unknown => {
  const raw = (v as unknown as Record<string, unknown>)[key];
  return typeof raw === "string" && raw !== "" && !isNaN(Number(raw)) ? Number(raw) : raw;
};
const sorted = computed(() => sortRows(filtered.value, sort.value, getVal));

const page = ref(1);
watch([search, statusFilter], () => (page.value = 1));
const pageRows = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
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

const setupOpen = ref(false);

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
    <PageHeader description="Fleet vehicles and their fuel parameters.">
      <template #actions>
        <template v-if="session.canManage">
          <!-- Diagnostics button hidden; logic kept for future use. Re-enable by removing v-show="false". -->
          <BaseButton
            v-if="session.admin"
            v-show="false"
            :disabled="diagLoading"
            title="Check what Samsara returns for vehicles, stats, drivers and assignments"
            @click="runDiagnostics"
          >
            {{ diagLoading ? "Checking…" : "Diagnostics" }}
          </BaseButton>
          <BaseButton
            :disabled="syncSamsara.isPending.value"
            title="Import trucks from Samsara (trailers are excluded)"
            @click="onSyncSamsara"
          >
            <ArrowDownTrayIcon class="-ml-0.5 size-5" aria-hidden="true" />
            {{ syncSamsara.isPending.value ? "Syncing…" : "Sync from Samsara" }}
          </BaseButton>
          <BaseButton
            title="Import vehicles from CSV — download a blank template, fill it in, and upload"
            @click="setupOpen = true"
          >
            Import vehicles
          </BaseButton>
          <BaseButton variant="primary" @click="openNew">
            <PlusIcon class="-ml-0.5 size-5" aria-hidden="true" /> New vehicle
          </BaseButton>
        </template>
      </template>
    </PageHeader>

    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div class="sm:max-w-xs sm:flex-1">
        <SearchInput v-model="search" placeholder="Search unit, make, model, plate, VIN…" />
      </div>
      <AppSelect v-model="statusFilter" :options="statusOptions" class="sm:w-44" />
      <span class="text-sm text-ink-muted sm:ml-auto">{{ filtered.length }} total</span>
    </div>

    <DataTable
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load vehicles') : null"
      :retrying="isFetching"
      :empty="filtered.length === 0"
      :empty-text="(vehicles ?? []).length === 0 ? 'No vehicles yet.' : 'No vehicles match these filters.'"
      :skeleton-cols="10"
      @retry="refetch"
    >
      <template #head>
        <tr>
          <SortableTh label="Unit" sort-key="unit_number" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium min-w-[5rem]" @sort="onSort" />
          <th class="px-6 py-3 font-medium min-w-[10rem]">Vehicle</th>
          <th class="px-6 py-3 font-medium min-w-[5rem]">Fuel</th>
          <SortableTh label="Tank" sort-key="tank_capacity_gal" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium min-w-[6rem]" @sort="onSort" />
          <SortableTh label="Baseline MPG" sort-key="baseline_mpg" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium min-w-[9rem]" @sort="onSort" />
          <SortableTh label="Fuel level" sort-key="samsara_fuel_percent" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium min-w-[7rem]" @sort="onSort" />
          <SortableTh label="Odometer" sort-key="current_odometer" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium min-w-[8rem]" @sort="onSort" />
          <th class="px-6 py-3 font-medium min-w-[8rem]">Driver</th>
          <SortableTh label="Status" sort-key="status" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium min-w-[6rem]" @sort="onSort" />
          <th class="px-6 py-3 w-12"></th>
        </tr>
      </template>
      <tr v-for="v in pageRows" :key="v.id" class="hover:bg-surface-subtle">
        <td class="px-6 py-3 font-medium">
          <RouterLink :to="`/vehicles/${v.id}`" class="text-brand-600 hover:text-brand-500">{{ v.unit_number }}</RouterLink>
        </td>
        <td class="px-6 py-3 text-ink-secondary">{{ [v.year, v.make, v.model].filter(Boolean).join(" ") || "—" }}</td>
        <td class="px-6 py-3 capitalize text-ink-secondary">{{ v.fuel_type }}</td>
        <td class="px-6 py-3 text-ink-secondary">
          <span v-if="Number(v.tank_capacity_gal) > 0">{{ v.tank_capacity_gal }} gal</span>
          <span v-else-if="needsSetup(v)" :class="[BADGE_BASE, toneClass('warning')]">Set tank</span>
          <span v-else class="text-ink-subtle">—</span>
        </td>
        <td class="px-6 py-3 text-ink-secondary">
          <span v-if="v.baseline_mpg">{{ v.baseline_mpg }}</span>
          <span v-else-if="needsSetup(v)" :class="[BADGE_BASE, toneClass('warning')]">Set MPG</span>
          <span v-else class="text-ink-subtle">—</span>
        </td>
        <td class="px-6 py-3 text-ink-secondary">
          <span v-if="v.samsara_fuel_percent != null">{{ v.samsara_fuel_percent }}%</span>
          <span v-else class="text-ink-subtle">—</span>
        </td>
        <td class="px-6 py-3 text-ink-secondary">
          <span v-if="Number(v.current_odometer) > 0">{{ Math.round(Number(v.current_odometer)).toLocaleString() }} mi</span>
          <span v-else class="text-ink-subtle">—</span>
        </td>
        <td class="px-6 py-3 text-ink-secondary">{{ driverName(v.assigned_driver_id) }}</td>
        <td class="px-6 py-3"><StatusBadge :status="v.status" /></td>
        <td class="px-6 py-3 text-right" @click.stop>
          <KebabMenu v-if="session.canManage">
            <button class="kebab-item" @click="openEdit(v)">Edit vehicle</button>
            <button v-if="v.status !== 'retired'" class="kebab-item kebab-item-danger" @click="onRetire(v)">Retire vehicle</button>
          </KebabMenu>
        </td>
      </tr>
      <template #footer>
        <TablePagination
          :page="page"
          :page-size="PAGE_SIZE"
          :total="filtered.length"
          @update:page="page = $event"
        />
      </template>
    </DataTable>

    <SlideOver :open="diagOpen" title="Samsara diagnostics" @close="diagOpen = false">
      <p class="mb-3 text-sm text-ink-muted">
        What Samsara returns for each endpoint. Check <code>scopes</code> (403 = missing scope),
        <code>stats.withFuelPercents</code> (fuel level), and <code>assignments</code> (driver links).
      </p>
      <BaseButton variant="soft" size="sm" class="mb-3" @click="copyDiag">
        Copy report
      </BaseButton>
      <pre class="overflow-x-auto rounded-md bg-surface-inverse p-3 text-xs leading-relaxed text-neutral-100">{{ diagReport }}</pre>
    </SlideOver>

    <SlideOver :open="setupOpen" title="Import vehicles" @close="setupOpen = false">
      <VehicleSetupImport :vehicles="vehicles ?? []" @done="setupOpen = false" />
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
