<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { PlusIcon, ArrowDownTrayIcon } from "@heroicons/vue/20/solid";
import { VEHICLE_STATUSES, type Trailer, type TrailerInput } from "@fuelguard/shared";
import { useSessionStore } from "@/stores/session";
import {
  useTrailersQuery, useCreateTrailer, useUpdateTrailer, useRetireTrailer,
  useBulkUpdateTrailers, useSyncSamsaraTrailers,
} from "@/features/fleet/useTrailers";
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
import TrailerForm from "@/features/fleet/TrailerForm.vue";
import { useToastStore } from "@/stores/toast";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { toggleSort, sortRows, type SortState } from "@/lib/sort";

const PAGE_SIZE = 20;
const session = useSessionStore();
const { data: trailers, isLoading, isError, error, refetch, isFetching } = useTrailersQuery();
const { data: vehicles } = useVehiclesQuery();
const toast = useToastStore();

// ── filters ─────────────────────────────────────────────────────────────────────
const search = ref("");
const statusFilter = ref("");
const reeferFilter = ref(""); // "" | "reefer" | "non"
const statusOptions = [{ value: "", label: "All statuses" }, ...VEHICLE_STATUSES.map((s) => ({ value: s, label: s }))];
const reeferOptions = [
  { value: "", label: "All trailers" },
  { value: "reefer", label: "Reefers only" },
  { value: "non", label: "Non-reefers" },
];

const filtered = computed(() => {
  const term = search.value.toLowerCase();
  return (trailers.value ?? []).filter((t) => {
    if (statusFilter.value && t.status !== statusFilter.value) return false;
    if (reeferFilter.value === "reefer" && !t.is_reefer) return false;
    if (reeferFilter.value === "non" && t.is_reefer) return false;
    if (!term) return true;
    return [t.unit_number, t.make, t.model, t.plate].filter(Boolean).some((f) => f!.toLowerCase().includes(term));
  });
});

const sort = ref<SortState>({ key: null, dir: "asc" });
function onSort(key: string) { sort.value = toggleSort(sort.value, key); }
const getVal = (t: Trailer, key: string): unknown => (t as unknown as Record<string, unknown>)[key];
const sorted = computed(() => sortRows(filtered.value, sort.value, getVal));

const page = ref(1);
watch([search, statusFilter, reeferFilter], () => (page.value = 1));
const pageRows = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const vehUnit = (id: string | null) => (id ? (vehicles.value?.find((v) => v.id === id)?.unit_number ?? "—") : "—");

const columns: DataTableColumn[] = [
  { key: "unit_number", label: "Unit", sortable: true, cellClass: "font-medium text-ink" },
  { key: "trailer", label: "Trailer", cellClass: "text-ink-secondary" },
  { key: "is_reefer", label: "Type", sortable: true },
  { key: "reefer_tank_capacity_gal", label: "Reefer tank", sortable: true, numeric: true, cellClass: "text-ink-secondary" },
  { key: "assigned_vehicle_id", label: "Paired tractor", cellClass: "text-ink-secondary" },
  { key: "status", label: "Status", sortable: true },
];

// ── selection (bulk edit) ─────────────────────────────────────────────────────────
const selected = ref<Set<string>>(new Set());
const selectedCount = computed(() => selected.value.size);

// ── mutations ─────────────────────────────────────────────────────────────────────
const createTrailer = useCreateTrailer();
const updateTrailer = useUpdateTrailer();
const retireTrailer = useRetireTrailer();
const bulkUpdate = useBulkUpdateTrailers();
const syncTrailers = useSyncSamsaraTrailers();
const saving = computed(() => createTrailer.isPending.value || updateTrailer.isPending.value);

const drawerOpen = ref(false);
const editing = ref<Trailer | null>(null);
function openNew() { editing.value = null; drawerOpen.value = true; }
function openEdit(t: Trailer) { editing.value = t; drawerOpen.value = true; }

async function onSubmit(input: TrailerInput) {
  try {
    if (editing.value) await updateTrailer.mutateAsync({ id: editing.value.id, input });
    else await createTrailer.mutateAsync(input);
    drawerOpen.value = false;
    toast.success(editing.value ? "Trailer updated" : "Trailer created");
  } catch (e) { toast.error("Could not save trailer", e instanceof Error ? e.message : undefined); }
}

async function bulkSet(patch: { is_reefer?: boolean; status?: Trailer["status"] }) {
  try {
    const n = await bulkUpdate.mutateAsync({ ids: [...selected.value], patch });
    selected.value = new Set();
    toast.success(`Updated ${n} trailer${n === 1 ? "" : "s"}`);
  } catch (e) { toast.error("Bulk update failed", e instanceof Error ? e.message : undefined); }
}

async function onSync() {
  try {
    const r = await syncTrailers.mutateAsync();
    toast.success(`Synced ${r.total} trailers`, `${r.created} added, ${r.updated} updated, ${r.paired} paired. Mark which ones are reefers.`);
  } catch (e) { toast.error("Could not sync trailers", e instanceof Error ? e.message : undefined); }
}

async function toggleReefer(t: Trailer) {
  try {
    await bulkUpdate.mutateAsync({ ids: [t.id], patch: { is_reefer: !t.is_reefer } });
    toast.success(t.is_reefer ? "Unmarked as reefer" : "Marked as reefer");
  } catch (e) { toast.error("Update failed", e instanceof Error ? e.message : undefined); }
}

async function onRetire(t: Trailer) {
  if (confirm(`Retire trailer ${t.unit_number}? Its history is preserved.`)) {
    try { await retireTrailer.mutateAsync(t.id); toast.success(`Trailer ${t.unit_number} retired`); }
    catch (e) { toast.error("Could not retire trailer", e instanceof Error ? e.message : undefined); }
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Trailers and reefer tanks. Mark which trailers are reefers — only those are checked against reefer (ULSR) fuel.">
      <template #actions>
        <template v-if="session.canManage">
          <BaseButton
            v-if="session.admin"
            :disabled="syncTrailers.isPending.value"
            title="Import trailers from Samsara"
            @click="onSync"
          >
            <ArrowDownTrayIcon class="-ml-0.5 size-5" aria-hidden="true" />
            {{ syncTrailers.isPending.value ? "Syncing…" : "Sync from Samsara" }}
          </BaseButton>
          <BaseButton variant="primary" @click="openNew">
            <PlusIcon class="-ml-0.5 size-5" aria-hidden="true" /> New trailer
          </BaseButton>
        </template>
      </template>
    </PageHeader>

    <FilterBar
      v-model:search="search"
      search-placeholder="Search unit, make, model, plate…"
      :count="filtered.length"
      count-label="trailers"
    >
      <template #filters>
        <FilterSelect v-model="reeferFilter" label="Type" :options="reeferOptions" />
        <FilterSelect v-model="statusFilter" label="Status" :options="statusOptions" />
      </template>
    </FilterBar>

    <!-- Bulk action bar -->
    <div v-if="session.canManage && selectedCount > 0" class="flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 px-4 py-2.5 ring-1 ring-brand-100">
      <span class="text-sm font-medium text-brand-800">{{ selectedCount }} selected</span>
      <button :disabled="bulkUpdate.isPending.value" class="rounded-md bg-surface px-3 py-1.5 text-sm font-medium text-info-700 ring-1 ring-info-300 ring-inset hover:bg-info-50 disabled:opacity-50" @click="bulkSet({ is_reefer: true })">Mark as reefer</button>
      <BaseButton size="sm" :disabled="bulkUpdate.isPending.value" @click="bulkSet({ is_reefer: false })">Unmark reefer</BaseButton>
      <BaseButton size="sm" :disabled="bulkUpdate.isPending.value" @click="bulkSet({ status: 'retired' })">Retire</BaseButton>
      <BaseButton variant="ghost" size="sm" @click="selected = new Set()">Clear</BaseButton>
    </div>

    <DataTable
      :columns="columns"
      :rows="pageRows"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load trailers') : null"
      :retrying="isFetching"
      :sort="sort"
      :selectable="session.canManage"
      :selected="selected"
      :empty-text="(trailers ?? []).length === 0 ? 'No trailers yet. Add one, or sync from Samsara.' : 'No trailers match these filters.'"
      @update:selected="selected = $event"
      @sort="onSort"
      @retry="refetch"
    >
      <template #cell-trailer="{ row }">{{ [row.year, row.make, row.model].filter(Boolean).join(" ") || "—" }}</template>
      <template #cell-is_reefer="{ row }">
        <span v-if="row.is_reefer" :class="[BADGE_BASE, toneClass('info')]">Reefer</span>
        <span v-else class="text-xs text-ink-subtle">Dry / other</span>
      </template>
      <template #cell-reefer_tank_capacity_gal="{ row }">{{ row.is_reefer ? row.reefer_tank_capacity_gal + " gal" : "—" }}</template>
      <template #cell-assigned_vehicle_id="{ row }">{{ vehUnit(row.assigned_vehicle_id) }}</template>
      <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
      <template #actions="{ row }">
        <KebabMenu v-if="session.canManage">
          <button class="kebab-item" @click="openEdit(row)">Edit</button>
          <button class="kebab-item" @click="toggleReefer(row)">{{ row.is_reefer ? 'Unmark reefer' : 'Mark as reefer' }}</button>
          <button v-if="row.status !== 'retired'" class="kebab-item kebab-item-danger" @click="onRetire(row)">Retire</button>
        </KebabMenu>
      </template>
      <template #footer>
        <TablePagination :page="page" :page-size="PAGE_SIZE" :total="filtered.length" @update:page="page = $event" />
      </template>
    </DataTable>

    <SlideOver :open="drawerOpen" :title="editing ? 'Edit trailer' : 'New trailer'" @close="drawerOpen = false">
      <TrailerForm :trailer="editing" :vehicles="vehicles ?? []" :submitting="saving" @submit="onSubmit" @cancel="drawerOpen = false" />
    </SlideOver>
  </div>
</template>
