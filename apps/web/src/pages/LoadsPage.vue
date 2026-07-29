<script setup lang="ts">
import { ref, computed } from "vue";
import { PlusIcon } from "@heroicons/vue/20/solid";
import {
  LOAD_STATUSES,
  LOAD_STATUS_LABELS,
  type AssignLoadRequest,
  type CreateLoadRequest,
  type UpdateLoadRequest,
} from "@fuelguard/shared";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useDriversQuery } from "@/composables/useDrivers";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useTrailersQuery } from "@/features/fleet/useTrailers";
import PageHeader from "@/components/ui/PageHeader.vue";
import FilterBar from "@/components/ui/FilterBar.vue";
import FilterSelect from "@/components/ui/FilterSelect.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import DataTable from "@/components/ui/DataTable.vue";
import type { DataTableColumn } from "@/components/ui/DataTable.vue";
import SlideOver from "@/components/SlideOver.vue";
import LoadForm, { type LoadFormPayload } from "@/features/dispatch/LoadForm.vue";
import LoadDetailPanel from "@/features/dispatch/LoadDetailPanel.vue";
import {
  useLoadsQuery,
  useCreateLoad,
  useUpdateLoad,
  useAssignLoad,
  useTransitionLoad,
  useBulkTransition,
  type DispatchLoad,
  type LoadAction,
} from "@/features/dispatch/useDispatchLoads";

/**
 * Dispatch → Loads (Phase 3D). The load workspace: create/assign loads and walk them through the
 * approval → release lifecycle so an assigned load reaches the driver app. TMS-fed loads land here
 * too (via the McLeod ingest) — this screen is the manual on-ramp for carriers without a TMS.
 */

const session = useSessionStore();
const toast = useToastStore();

const { data: loads, isLoading, isError, error, refetch, isFetching } = useLoadsQuery();
const { data: drivers } = useDriversQuery();
const { data: vehicles } = useVehiclesQuery();
const { data: trailers } = useTrailersQuery();

const createLoad = useCreateLoad();
const updateLoad = useUpdateLoad();
const assignLoad = useAssignLoad();
const transitionLoad = useTransitionLoad();
const bulk = useBulkTransition();

const search = ref("");
const statusFilter = ref("");
const statusOptions = [
  { value: "", label: "All statuses" },
  ...LOAD_STATUSES.map((s) => ({ value: s, label: LOAD_STATUS_LABELS[s] })),
];

const filtered = computed(() =>
  (loads.value ?? []).filter((l) => {
    if (statusFilter.value && l.status !== statusFilter.value) return false;
    const term = search.value.trim().toLowerCase();
    if (!term) return true;
    return [l.ref, l.driver_name, l.commodity, l.vehicle_unit]
      .filter((f): f is string => Boolean(f))
      .some((f) => f.toLowerCase().includes(term));
  }),
);

const columns: DataTableColumn[] = [
  { key: "ref", label: "Load #", headerClass: "min-w-[7rem]" },
  { key: "status", label: "Status", headerClass: "min-w-[8rem]" },
  { key: "driver_name", label: "Driver", headerClass: "min-w-[9rem]", cellClass: "text-ink-secondary" },
  { key: "vehicle_unit", label: "Truck", headerClass: "min-w-[6rem]", cellClass: "text-ink-secondary" },
  { key: "stops", label: "Stops", numeric: true, headerClass: "min-w-[5rem]", cellClass: "text-ink-secondary" },
  { key: "hazmat", label: "Hazmat", headerClass: "min-w-[5rem]" },
  { key: "created_at", label: "Created", headerClass: "min-w-[7rem]", cellClass: "text-ink-secondary" },
];

const driverList = computed(() => (drivers.value ?? []).map((d) => ({ id: d.id, full_name: d.full_name })));
const vehicleList = computed(() => (vehicles.value ?? []).map((v) => ({ id: v.id, unit_number: v.unit_number })));
const trailerList = computed(() => (trailers.value ?? []).map((t) => ({ id: t.id, unit_number: t.unit_number })));

// Drawers.
const formOpen = ref(false);
const editing = ref<DispatchLoad | null>(null);
const selectedId = ref<string | null>(null);
const selectedLoad = computed(() => (loads.value ?? []).find((l) => l.id === selectedId.value) ?? null);

const saving = computed(() => createLoad.isPending.value || updateLoad.isPending.value);
const busy = computed(() => transitionLoad.isPending.value || assignLoad.isPending.value);

// Bulk approve / release over the selection (each still goes through the audited per-load gate).
const selected = ref<Set<string>>(new Set());
const selectedLoads = computed(() => (loads.value ?? []).filter((l) => selected.value.has(l.id)));
const approvableIds = computed(() =>
  selectedLoads.value.filter((l) => l.status === "pending_approval").map((l) => l.id),
);
const releasableIds = computed(() =>
  selectedLoads.value.filter((l) => l.status === "approved").map((l) => l.id),
);

async function bulkDo(action: "approve" | "release", ids: string[]) {
  if (!ids.length) return;
  try {
    const r = await bulk.mutateAsync({ ids, action });
    const verb = action === "approve" ? "approved" : "released";
    toast.success(`${r.ok} ${verb}${r.failed ? `, ${r.failed} couldn't (not ready)` : ""}`);
    selected.value = new Set();
  } catch (e) {
    toast.error("Bulk action failed", e instanceof Error ? e.message : undefined);
  }
}

function openNew() {
  editing.value = null;
  formOpen.value = true;
}
function openEditFromDetail() {
  editing.value = selectedLoad.value;
  selectedId.value = null;
  formOpen.value = true;
}

async function onFormSubmit(payload: LoadFormPayload) {
  try {
    if (editing.value) {
      await updateLoad.mutateAsync({ id: editing.value.id, body: payload as UpdateLoadRequest });
      toast.success(`Load ${payload.ref} saved`);
    } else {
      const created = await createLoad.mutateAsync(payload as CreateLoadRequest);
      toast.success(`Load ${payload.ref} created`);
      selectedId.value = created.id; // open the new load so dispatch can submit → approve → release
    }
    formOpen.value = false;
  } catch (e) {
    toast.error("Could not save the load", e instanceof Error ? e.message : undefined);
  }
}

async function onTransition(action: LoadAction, reason?: string) {
  const load = selectedLoad.value;
  if (!load) return;
  try {
    await transitionLoad.mutateAsync({ id: load.id, action, reason });
    toast.success("Load updated");
  } catch (e) {
    toast.error("That step is not available", e instanceof Error ? e.message : undefined);
  }
}

async function onAssign(body: AssignLoadRequest) {
  const load = selectedLoad.value;
  if (!load) return;
  try {
    await assignLoad.mutateAsync({ id: load.id, body });
    toast.success("Load reassigned");
  } catch (e) {
    toast.error("Could not reassign the load", e instanceof Error ? e.message : undefined);
  }
}

const fmtDate = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Create, assign and release loads to drivers. TMS-fed loads appear here too.">
      <template #actions>
        <BaseButton v-if="session.canManage" variant="primary" @click="openNew">
          <PlusIcon class="-ml-0.5 size-5" aria-hidden="true" /> New load
        </BaseButton>
      </template>
    </PageHeader>

    <FilterBar v-model:search="search" search-placeholder="Search load #, driver, commodity…" :count="filtered.length" count-label="loads">
      <template #filters>
        <FilterSelect v-model="statusFilter" label="Status" :options="statusOptions" />
      </template>
    </FilterBar>

    <div
      v-if="session.canManage && selected.size > 0"
      class="flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 px-4 py-2.5 ring-1 ring-brand-100"
    >
      <span class="text-sm font-medium text-brand-800">{{ selected.size }} selected</span>
      <BaseButton size="sm" :disabled="bulk.isPending.value || approvableIds.length === 0" @click="bulkDo('approve', approvableIds)">
        Approve<span v-if="approvableIds.length"> ({{ approvableIds.length }})</span>
      </BaseButton>
      <BaseButton size="sm" :disabled="bulk.isPending.value || releasableIds.length === 0" @click="bulkDo('release', releasableIds)">
        Send to driver<span v-if="releasableIds.length"> ({{ releasableIds.length }})</span>
      </BaseButton>
      <BaseButton variant="ghost" size="sm" @click="selected = new Set()">Clear</BaseButton>
    </div>

    <DataTable
      :columns="columns"
      :rows="filtered"
      row-key="id"
      :selectable="session.canManage"
      :selected="selected"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load the board') : null"
      :retrying="isFetching"
      :empty-text="(loads ?? []).length === 0 ? 'No loads yet — create one or wait for a TMS feed.' : 'No loads match these filters.'"
      @retry="refetch"
      @update:selected="selected = $event"
      @row-click="(row: DispatchLoad) => (selectedId = row.id)"
    >
      <template #cell-ref="{ row }">
        <span class="font-medium text-brand-600">{{ row.ref }}</span>
      </template>
      <template #cell-status="{ row }">
        <span class="inline-flex items-center rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink-secondary">
          {{ LOAD_STATUS_LABELS[row.status as keyof typeof LOAD_STATUS_LABELS] }}
        </span>
      </template>
      <template #cell-driver_name="{ row }">{{ row.driver_name ?? "Unassigned" }}</template>
      <template #cell-stops="{ row }">{{ (row.stops ?? []).length }}</template>
      <template #cell-hazmat="{ row }">
        <span v-if="row.hazmat" class="inline-flex items-center rounded-full bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-700">Yes</span>
        <span v-else class="text-ink-subtle">—</span>
      </template>
      <template #cell-created_at="{ row }">{{ fmtDate(row.created_at) }}</template>
    </DataTable>

    <!-- Create / edit -->
    <SlideOver :open="formOpen" :title="editing ? 'Edit load' : 'New load'" @close="formOpen = false">
      <LoadForm
        v-if="formOpen"
        :load="editing"
        :drivers="driverList"
        :vehicles="vehicleList"
        :trailers="trailerList"
        :saving="saving"
        @submit="onFormSubmit"
        @cancel="formOpen = false"
      />
    </SlideOver>

    <!-- Detail + lifecycle -->
    <SlideOver :open="selectedId != null && selectedLoad != null" :title="selectedLoad?.ref ?? 'Load'" @close="selectedId = null">
      <LoadDetailPanel
        v-if="selectedLoad"
        :load="selectedLoad"
        :drivers="driverList"
        :vehicles="vehicleList"
        :trailers="trailerList"
        :busy="busy"
        :can-manage="session.canManage"
        @transition="onTransition"
        @assign="onAssign"
        @edit="openEditFromDetail"
      />
    </SlideOver>
  </div>
</template>
