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
import KebabMenu from "@/components/KebabMenu.vue";
import SortableTh from "@/components/SortableTh.vue";
import TablePagination from "@/components/TablePagination.vue";
import DataTable from "@/components/ui/DataTable.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import DriverForm from "@/features/fleet/DriverForm.vue";
import { useToastStore } from "@/stores/toast";
import { toggleSort, sortRows, type SortState } from "@/lib/sort";

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

const sort = ref<SortState>({ key: null, dir: "asc" });
function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
}
const sorted = computed(() => sortRows(filtered.value, sort.value));

const page = ref(1);
watch([search, statusFilter], () => (page.value = 1));
const pageRows = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

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
    <PageHeader description="Drivers in your fleet. Assign drivers to vehicles from the Vehicles page.">
      <template #actions>
        <template v-if="session.canManage">
          <BaseButton
            :disabled="syncSamsara.isPending.value"
            title="Import drivers from Samsara"
            @click="onSyncSamsara"
          >
            <ArrowDownTrayIcon class="-ml-0.5 size-5" aria-hidden="true" />
            {{ syncSamsara.isPending.value ? "Syncing…" : "Sync from Samsara" }}
          </BaseButton>
          <BaseButton variant="primary" @click="openNew">
            <PlusIcon class="-ml-0.5 size-5" aria-hidden="true" /> New driver
          </BaseButton>
        </template>
      </template>
    </PageHeader>

    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div class="sm:max-w-xs sm:flex-1">
        <SearchInput v-model="search" placeholder="Search name, employee ID, phone…" />
      </div>
      <AppSelect v-model="statusFilter" :options="statusOptions" class="sm:w-44" />
      <span class="text-sm text-ink-muted sm:ml-auto">{{ filtered.length }} total</span>
    </div>

    <DataTable
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load drivers') : null"
      :retrying="isFetching"
      :empty="filtered.length === 0"
      :empty-text="(drivers ?? []).length === 0 ? 'No drivers yet.' : 'No drivers match these filters.'"
      :skeleton-cols="6"
      @retry="refetch"
    >
      <template #head>
        <tr>
          <SortableTh label="Name" sort-key="full_name" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium min-w-[12rem]" @sort="onSort" />
          <SortableTh label="Employee ID" sort-key="employee_id" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium min-w-[9rem]" @sort="onSort" />
          <th class="px-6 py-3 font-medium min-w-[9rem]">Phone</th>
          <th class="px-6 py-3 font-medium min-w-[10rem]">Vehicles</th>
          <SortableTh label="Status" sort-key="status" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium min-w-[6rem]" @sort="onSort" />
          <th class="px-6 py-3 w-12"></th>
        </tr>
      </template>
      <tr v-for="d in pageRows" :key="d.id" class="hover:bg-surface-subtle">
        <td class="px-6 py-3 font-medium text-ink">{{ d.full_name }}</td>
        <td class="px-6 py-3 text-ink-secondary">{{ d.employee_id ?? "—" }}</td>
        <td class="px-6 py-3 text-ink-secondary">{{ d.phone ?? "—" }}</td>
        <td class="px-6 py-3 text-ink-secondary">{{ assignedUnits(d.id) }}</td>
        <td class="px-6 py-3"><StatusBadge :status="d.status" /></td>
        <td class="px-6 py-3 text-right" @click.stop>
          <KebabMenu v-if="session.canManage">
            <button class="kebab-item" @click="openEdit(d)">Edit driver</button>
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
