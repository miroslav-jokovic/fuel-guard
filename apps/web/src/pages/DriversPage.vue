<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import {
  PlusIcon,
} from "@fuelguard/ui/icons";
import { ref, computed, watch } from "vue";
import type { Driver, DriverInput } from "@fuelguard/shared";
import { useSessionStore } from "@/stores/session";
import { useDriversQuery, useCreateDriver, useUpdateDriver } from "@/composables/useDrivers";
import { useVehiclesQuery } from "@/composables/useVehicles";
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
import DriverForm from "@/features/fleet/DriverForm.vue";
import { useToastStore } from "@/stores/toast";
import { toggleSort, sortRows, type SortState } from "@/lib/sort";
import { formatPhone } from "@/lib/format";
import { useDriverReconcile } from "@/features/fleet/useDriverReconcile";

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

// ── Reconcile duplicate / name-only drivers with Samsara ──────────────────────────────────────────
const reconcile = useDriverReconcile();
const reconcileOpen = ref(false);
const linkTarget = ref<Record<string, string>>({}); // sourceId -> chosen canonical driver id
async function openReconcile() {
  reconcileOpen.value = true;
  linkTarget.value = {};
  await reconcile.preview();
}
// Samsara drivers to pick from when manually linking (those already carrying a Samsara id).
const samsaraCandidates = computed(() =>
  (drivers.value ?? []).filter((d) => d.samsara_driver_id).sort((a, b) => a.full_name.localeCompare(b.full_name)),
);
// Unmatched drivers the auto-plan did NOT cover (need a manual link).
const stillUnmatched = computed(() => {
  const autoIds = new Set((reconcile.report.value?.pairs ?? []).map((p) => p.sourceId));
  return (drivers.value ?? []).filter((d) => !d.samsara_driver_id && !autoIds.has(d.id));
});
async function applyReconcile() {
  const n = await reconcile.apply();
  if (reconcile.error.value) toast.error("Reconcile failed", reconcile.error.value);
  else toast.success(`Merged ${n} duplicate driver${n === 1 ? "" : "s"}`);
}
async function linkDriver(sourceId: string) {
  const canonicalId = linkTarget.value[sourceId];
  if (!canonicalId) return;
  const ok = await reconcile.linkOne(sourceId, canonicalId);
  if (ok) { toast.success("Driver linked & merged"); await reconcile.preview(); }
  else toast.error("Link failed", reconcile.error.value ?? undefined);
}

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
    return [d.full_name, d.employee_id, d.phone, d.samsara_username]
      .filter(Boolean)
      .some((f) => f!.toLowerCase().includes(term));
  });
});

const sort = ref<SortState>({ key: null, dir: "asc" });
function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
}
const sorted = computed(() => sortRows(filtered.value, sort.value));

const columns: DataTableColumn[] = [
  { key: "full_name", label: "Name", sortable: true, headerClass: "min-w-[12rem]", cellClass: "font-medium text-ink" },
  { key: "samsara_username", label: "Driver ID", sortable: true, headerClass: "min-w-[8rem]", cellClass: "text-ink-secondary" },
  { key: "employee_id", label: "Employee ID", sortable: true, headerClass: "min-w-[9rem]", cellClass: "text-ink-secondary" },
  { key: "phone", label: "Phone", headerClass: "min-w-[9rem]", cellClass: "text-ink-secondary tabular-nums" },
  { key: "vehicles", label: "Vehicles", headerClass: "min-w-[10rem]", cellClass: "text-ink-secondary" },
  { key: "status", label: "Status", sortable: true, headerClass: "min-w-[6rem]" },
];

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
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Drivers in your fleet. Assign drivers to vehicles from the Vehicles page.">
      <template #actions>
        <template v-if="session.canManage">
          <BaseButton title="Fold duplicate / name-only drivers into their Samsara record" @click="openReconcile">
            Reconcile with Samsara
          </BaseButton>
          <BaseButton variant="primary" @click="openNew">
            <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> New driver
          </BaseButton>
        </template>
      </template>
    </PageHeader>

    <FilterBar
      v-model:search="search"
      search-placeholder="Search name, driver ID, employee ID, phone…"
      :count="filtered.length"
      count-label="drivers"
    >
      <template #filters>
        <FilterSelect v-model="statusFilter" label="Status" :options="statusOptions" />
      </template>
    </FilterBar>

    <DataTable
      :columns="columns"
      :rows="pageRows"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load drivers') : null"
      :retrying="isFetching"
      :sort="sort"
      :empty-text="(drivers ?? []).length === 0 ? 'No drivers yet.' : 'No drivers match these filters.'"
      @sort="onSort"
      @retry="refetch"
    >
      <template #cell-samsara_username="{ row }">{{ row.samsara_username || "—" }}</template>
      <template #cell-phone="{ row }">{{ formatPhone(row.phone) }}</template>
      <template #cell-vehicles="{ row }">{{ assignedUnits(row.id) }}</template>
      <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
      <template #actions="{ row }">
        <KebabMenu v-if="session.canManage">
          <button class="kebab-item" @click="openEdit(row)">Edit driver</button>
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

    <SlideOver :open="reconcileOpen" title="Reconcile drivers with Samsara" @close="reconcileOpen = false">
      <div v-if="reconcile.loading.value" class="text-sm text-ink-muted">Analyzing…</div>
      <div v-else class="space-y-6">
        <p class="text-sm text-ink-muted">
          Drivers created from EFS fuel-card names are folded into their Samsara record, moving all fuel, idle
          and HOS history onto the one row. Only confident matches (phone, or an unambiguous full name) are
          auto-merged; the rest you can link by hand below.
        </p>

        <div>
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-semibold text-ink">Confident merges ({{ reconcile.report.value?.planned ?? 0 }})</h4>
            <BaseButton
              v-if="(reconcile.report.value?.planned ?? 0) > 0"
              variant="primary"
              size="sm"
              :disabled="reconcile.applying.value"
              @click="applyReconcile"
            >
              {{ reconcile.applying.value ? "Merging…" : `Apply ${reconcile.report.value?.planned} merge(s)` }}
            </BaseButton>
          </div>
          <ul class="mt-2 divide-y divide-border rounded-md border border-border">
            <li v-for="pr in reconcile.report.value?.pairs ?? []" :key="pr.sourceId" class="flex items-center justify-between px-3 py-2 text-sm">
              <span><span class="text-ink-secondary">{{ pr.sourceName }}</span> → <span class="font-medium text-ink">{{ pr.canonicalName }}</span></span>
              <span class="text-xs text-ink-subtle">by {{ pr.matchedBy }}</span>
            </li>
            <li v-if="!(reconcile.report.value?.pairs ?? []).length" class="px-3 py-2 text-sm text-ink-subtle">No confident merges found.</li>
          </ul>
        </div>

        <div>
          <h4 class="text-sm font-semibold text-ink">Link by hand ({{ stillUnmatched.length }})</h4>
          <p class="mt-1 text-xs text-ink-subtle">Drivers with no confident Samsara match — pick the right person to merge into.</p>
          <ul class="mt-2 space-y-2">
            <li v-for="u in stillUnmatched" :key="u.id" class="flex items-center gap-2 text-sm">
              <span class="min-w-0 flex-1 truncate">{{ u.full_name }}</span>
              <select v-model="linkTarget[u.id]" class="rounded border border-border bg-surface px-2 py-1 text-xs">
                <option value="">Select Samsara driver…</option>
                <option v-for="c in samsaraCandidates" :key="c.id" :value="c.id">{{ c.full_name }}</option>
              </select>
              <BaseButton size="sm" :disabled="!linkTarget[u.id]" @click="linkDriver(u.id)">Link</BaseButton>
            </li>
            <li v-if="!stillUnmatched.length" class="text-sm text-ink-subtle">Nothing left to link.</li>
          </ul>
        </div>
      </div>
    </SlideOver>

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
