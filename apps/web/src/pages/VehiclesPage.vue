<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { PlusIcon, ArrowDownTrayIcon } from "@heroicons/vue/20/solid";
import { VEHICLE_STATUSES, type Vehicle, type VehicleInput } from "@fuelguard/shared";
import { useSessionStore } from "@/stores/session";
import { useVehiclesQuery, useCreateVehicle, useUpdateVehicle, useRetireVehicle, useSyncSamsaraVehicles, useBulkUpdateVehicles } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import SlideOver from "@/components/SlideOver.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
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

const columns: DataTableColumn[] = [
  { key: "unit_number", label: "Unit", sortable: true, headerClass: "min-w-[5rem]" },
  { key: "vehicle", label: "Vehicle", headerClass: "min-w-[10rem]", cellClass: "text-ink-secondary" },
  { key: "fuel_type", label: "Fuel", headerClass: "min-w-[5rem]", cellClass: "capitalize text-ink-secondary" },
  { key: "tank_capacity_gal", label: "Tank", sortable: true, numeric: true, headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "baseline_mpg", label: "Baseline MPG", sortable: true, numeric: true, headerClass: "min-w-[9rem]", cellClass: "text-ink-secondary" },
  { key: "samsara_fuel_percent", label: "Fuel level", sortable: true, numeric: true, headerClass: "min-w-[7rem]", cellClass: "text-ink-secondary" },
  { key: "current_odometer", label: "Odometer", sortable: true, numeric: true, headerClass: "min-w-[8rem]", cellClass: "text-ink-secondary" },
  { key: "assigned_driver_id", label: "Driver", headerClass: "min-w-[8rem]", cellClass: "text-ink-secondary" },
  { key: "has_apu", label: "APU", sortable: true, headerClass: "min-w-[5rem]" },
  { key: "has_optimized_idle", label: "Optimized idle", sortable: true, headerClass: "min-w-[8rem]" },
  { key: "status", label: "Status", sortable: true, headerClass: "min-w-[6rem]" },
];

const page = ref(1);
watch([search, statusFilter], () => (page.value = 1));
const pageRows = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const createVehicle = useCreateVehicle();
const updateVehicle = useUpdateVehicle();
const retireVehicle = useRetireVehicle();

const toast = useToastStore();
const drawerOpen = ref(false);
const editing = ref<Vehicle | null>(null);

// ── selection (bulk idle-reduction capability edit) ───────────────────────────
const selected = ref<Set<string>>(new Set());
const selectedCount = computed(() => selected.value.size);
const bulkUpdate = useBulkUpdateVehicles();
async function bulkSetCapability(
  patch: Partial<Pick<Vehicle, "has_apu" | "has_optimized_idle" | "apu_type">>,
  label: string,
) {
  try {
    const n = await bulkUpdate.mutateAsync({ ids: [...selected.value], patch });
    selected.value = new Set();
    toast.success(`${label} — ${n} truck${n === 1 ? "" : "s"} updated`);
  } catch (e) {
    toast.error("Bulk update failed", e instanceof Error ? e.message : undefined);
  }
}

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

    <FilterBar
      v-model:search="search"
      search-placeholder="Search unit, make, model, plate, VIN…"
      :count="filtered.length"
      count-label="vehicles"
    >
      <template #filters>
        <FilterSelect v-model="statusFilter" label="Status" :options="statusOptions" />
      </template>
    </FilterBar>

    <!-- Bulk idle-reduction capability: select trucks, then set APU / Optimized-Idle on all of them at once. -->
    <div v-if="session.canManage && selectedCount > 0" class="flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 px-4 py-2.5 ring-1 ring-brand-100">
      <span class="text-sm font-medium text-brand-800">{{ selectedCount }} selected</span>
      <span class="text-xs text-brand-700">Set idle-reduction capability:</span>
      <BaseButton size="sm" :disabled="bulkUpdate.isPending.value" @click="bulkSetCapability({ has_apu: true }, 'Marked as having an APU')">Has APU</BaseButton>
      <BaseButton size="sm" :disabled="bulkUpdate.isPending.value" @click="bulkSetCapability({ has_apu: false, apu_type: 'none' }, 'Marked as no APU')">No APU</BaseButton>
      <BaseButton size="sm" :disabled="bulkUpdate.isPending.value" @click="bulkSetCapability({ has_optimized_idle: true }, 'Marked as having Optimized-Idle')">Has Optimized-Idle</BaseButton>
      <BaseButton size="sm" :disabled="bulkUpdate.isPending.value" @click="bulkSetCapability({ has_optimized_idle: false }, 'Marked as no Optimized-Idle')">No Optimized-Idle</BaseButton>
      <BaseButton variant="ghost" size="sm" @click="selected = new Set()">Clear</BaseButton>
    </div>

    <DataTable
      :columns="columns"
      :rows="pageRows"
      row-key="id"
      :selectable="session.canManage"
      :selected="selected"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load vehicles') : null"
      :retrying="isFetching"
      :sort="sort"
      :empty-text="(vehicles ?? []).length === 0 ? 'No vehicles yet.' : 'No vehicles match these filters.'"
      @sort="onSort"
      @retry="refetch"
      @update:selected="selected = $event"
    >
      <template #cell-unit_number="{ row }">
        <RouterLink :to="`/vehicles/${row.id}`" class="font-medium text-brand-600 hover:text-brand-500">{{ row.unit_number }}</RouterLink>
      </template>
      <template #cell-vehicle="{ row }">{{ [row.year, row.make, row.model].filter(Boolean).join(" ") || "—" }}</template>
      <template #cell-tank_capacity_gal="{ row }">
        <span v-if="Number(row.tank_capacity_gal) > 0">{{ row.tank_capacity_gal }} gal</span>
        <span v-else-if="needsSetup(row)" :class="[BADGE_BASE, toneClass('warning')]">Set tank</span>
        <span v-else class="text-ink-subtle">—</span>
      </template>
      <template #cell-baseline_mpg="{ row }">
        <span v-if="row.baseline_mpg">{{ row.baseline_mpg }}</span>
        <span v-else-if="needsSetup(row)" :class="[BADGE_BASE, toneClass('warning')]">Set MPG</span>
        <span v-else class="text-ink-subtle">—</span>
      </template>
      <template #cell-samsara_fuel_percent="{ value }">
        <span v-if="value != null">{{ value }}%</span>
        <span v-else class="text-ink-subtle">—</span>
      </template>
      <template #cell-current_odometer="{ row }">
        <span v-if="Number(row.current_odometer) > 0">{{ Math.round(Number(row.current_odometer)).toLocaleString() }} mi</span>
        <span v-else class="text-ink-subtle">—</span>
      </template>
      <template #cell-assigned_driver_id="{ row }">{{ driverName(row.assigned_driver_id) }}</template>
      <template #cell-has_apu="{ value }">
        <span v-if="value === true" :class="[BADGE_BASE, toneClass('success')]">Yes</span>
        <span v-else-if="value === false" class="text-ink-subtle">No</span>
        <span v-else :class="[BADGE_BASE, toneClass('warning')]">Unset</span>
      </template>
      <template #cell-has_optimized_idle="{ value }">
        <span v-if="value === true" :class="[BADGE_BASE, toneClass('success')]">Yes</span>
        <span v-else-if="value === false" class="text-ink-subtle">No</span>
        <span v-else :class="[BADGE_BASE, toneClass('warning')]">Unset</span>
      </template>
      <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
      <template #actions="{ row }">
        <KebabMenu v-if="session.canManage">
          <button class="kebab-item" @click="openEdit(row)">Edit vehicle</button>
          <button v-if="row.status !== 'retired'" class="kebab-item kebab-item-danger" @click="onRetire(row)">Retire vehicle</button>
        </KebabMenu>
      </template>
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
