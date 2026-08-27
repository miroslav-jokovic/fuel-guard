<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import { PlusIcon } from "@silvicom/ui/icons";
import { ref, computed, watch } from "vue";
import { TRAILER_TYPE_LABELS, VEHICLE_STATUSES, type Trailer, type TrailerInput } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import {
  useTrailersQuery,
  useCreateTrailer,
  useUpdateTrailer,
  useRetireTrailer,
  useBulkUpdateTrailers,
} from "@/composables/useTrailers";
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
import DataWorkspace from "@/components/ui/DataWorkspace.vue";
import { AppButton as BaseButton } from "@silvicom/ui";
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
const statusOptions = [
  { value: "", label: "All statuses" },
  ...VEHICLE_STATUSES.map((s) => ({ value: s, label: s })),
];
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
    return [t.unit_number, t.make, t.model, t.plate]
      .filter(Boolean)
      .some((f) => f!.toLowerCase().includes(term));
  });
});

const sort = ref<SortState>({ key: null, dir: "asc" });
function onSort(key: string) {
  sort.value = toggleSort(sort.value, key);
}
const getVal = (t: Trailer, key: string): unknown => (t as unknown as Record<string, unknown>)[key];
const sorted = computed(() => sortRows(filtered.value, sort.value, getVal));

const page = ref(1);
watch([search, statusFilter, reeferFilter], () => (page.value = 1));
const pageRows = computed(() =>
  sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
);

const vehUnit = (id: string | null) =>
  id ? (vehicles.value?.find((v) => v.id === id)?.unit_number ?? "—") : "—";

const columns: DataTableColumn[] = [
  { key: "unit_number", label: "Unit", sortable: true, cellClass: "font-medium text-ink" },
  { key: "trailer", label: "Make / Model", cellClass: "text-ink-secondary" },
  { key: "trailer_type", label: "Type", sortable: true },
  {
    key: "reefer_tank_capacity_gal",
    label: "Reefer tank",
    sortable: true,
    numeric: true,
    cellClass: "text-ink-secondary",
  },
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
const saving = computed(() => createTrailer.isPending.value || updateTrailer.isPending.value);

const drawerOpen = ref(false);
const editing = ref<Trailer | null>(null);
function openNew() {
  editing.value = null;
  drawerOpen.value = true;
}
function openEdit(t: Trailer) {
  editing.value = t;
  drawerOpen.value = true;
}

async function onSubmit(input: TrailerInput) {
  try {
    if (editing.value) await updateTrailer.mutateAsync({ id: editing.value.id, input });
    else await createTrailer.mutateAsync(input);
    drawerOpen.value = false;
    toast.success(editing.value ? "Trailer updated" : "Trailer created");
  } catch (e) {
    toast.error("Could not save trailer", e instanceof Error ? e.message : undefined);
  }
}

async function bulkSet(patch: { is_reefer?: boolean; status?: Trailer["status"] }) {
  try {
    const n = await bulkUpdate.mutateAsync({ ids: [...selected.value], patch });
    selected.value = new Set();
    toast.success(`Updated ${n} trailer${n === 1 ? "" : "s"}`);
  } catch (e) {
    toast.error("Bulk update failed", e instanceof Error ? e.message : undefined);
  }
}

async function toggleReefer(t: Trailer) {
  try {
    await bulkUpdate.mutateAsync({ ids: [t.id], patch: { is_reefer: !t.is_reefer } });
    toast.success(t.is_reefer ? "Unmarked as reefer" : "Marked as reefer");
  } catch (e) {
    toast.error("Update failed", e instanceof Error ? e.message : undefined);
  }
}

async function onRetire(t: Trailer) {
  if (confirm(`Retire trailer ${t.unit_number}? Its history is preserved.`)) {
    try {
      await retireTrailer.mutateAsync(t.id);
      toast.success(`Trailer ${t.unit_number} retired`);
    } catch (e) {
      toast.error("Could not retire trailer", e instanceof Error ? e.message : undefined);
    }
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      description="Trailers pulled from Samsara. Type (Reefer / Dry) is set by you with the buttons below — only reefers are checked against reefer (ULSR) fuel. Paired tractor is inferred from GPS co-location over the last 5 days; Status is the trailer's active/retired state."
    >
      <template #actions>
        <template v-if="session.canManage">
          <BaseButton variant="primary" @click="openNew">
            <AppIcon :icon="PlusIcon" class="-ml-0.5 size-5" aria-hidden="true" /> New trailer
          </BaseButton>
        </template>
      </template>
    </PageHeader>

    <DataWorkspace>
    <FilterBar
      v-model:search="search"
      embedded
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
    <div
      v-if="session.canManage && selectedCount > 0"
      class="flex flex-wrap items-center gap-2 rounded-surface bg-brand-50 px-4 py-2.5 ring-1 ring-brand-100"
    >
      <span class="text-sm font-medium text-brand-800">{{ selectedCount }} selected</span>
      <BaseButton
        :disabled="bulkUpdate.isPending.value"
        class="rounded-control bg-surface px-3 py-1.5 text-sm font-medium text-info-700 ring-1 ring-info-300 ring-inset hover:bg-info-50 disabled:opacity-50"
        @click="bulkSet({ is_reefer: true })"
      >
        Mark as reefer
      </BaseButton>
      <BaseButton
        size="sm"
        :disabled="bulkUpdate.isPending.value"
        @click="bulkSet({ is_reefer: false })"
        >Unmark reefer</BaseButton
      >
      <BaseButton
        size="sm"
        :disabled="bulkUpdate.isPending.value"
        @click="bulkSet({ status: 'retired' })"
        >Retire</BaseButton
      >
      <BaseButton variant="ghost" size="sm" @click="selected = new Set()">Clear</BaseButton>
    </div>

    <DataTable
      embedded
      :columns="columns"
      :rows="pageRows"
      row-key="id"
      :loading="isLoading"
      :error="isError ? (error instanceof Error ? error.message : 'Failed to load trailers') : null"
      :retrying="isFetching"
      :sort="sort"
      :selectable="session.canManage"
      :selected="selected"
      :empty-text="
        (trailers ?? []).length === 0
          ? 'No trailers yet. Add one, or sync from Samsara.'
          : 'No trailers match these filters.'
      "
      @update:selected="selected = $event"
      @sort="onSort"
      @retry="refetch"
    >
      <template #cell-trailer="{ row }">{{
        [row.year, row.make, row.model].filter(Boolean).join(" ") || "—"
      }}</template>
      <template #cell-trailer_type="{ row }">
        <span v-if="row.trailer_type === 'tanker'" :class="[BADGE_BASE, toneClass('caution')]">Tanker</span>
        <span v-else-if="row.trailer_type" :class="[BADGE_BASE, toneClass('neutral')]">
          {{ TRAILER_TYPE_LABELS[row.trailer_type] }}
        </span>
        <span v-else class="text-xs text-ink-tertiary">Not set</span>
      </template>
      <template #cell-reefer_tank_capacity_gal="{ row }">{{
        row.is_reefer ? row.reefer_tank_capacity_gal + " gal" : "N/A"
      }}</template>
      <template #cell-assigned_vehicle_id="{ row }">{{
        vehUnit(row.assigned_vehicle_id)
      }}</template>
      <template #cell-status="{ row }"><StatusBadge :status="row.status" /></template>
      <template #actions="{ row }">
        <KebabMenu v-if="session.canManage">
          <BaseButton class="kebab-item" @click="openEdit(row)">Edit</BaseButton>
          <BaseButton class="kebab-item" @click="toggleReefer(row)">
            {{ row.is_reefer ? "Unmark reefer" : "Mark as reefer" }}
          </BaseButton>
          <BaseButton
            v-if="row.status !== 'retired'"
            class="kebab-item kebab-item-danger"
            @click="onRetire(row)"
          >
            Retire
          </BaseButton>
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
    </DataWorkspace>

    <SlideOver
      :open="drawerOpen"
      :title="editing ? 'Edit trailer' : 'New trailer'"
      @close="drawerOpen = false"
    >
      <TrailerForm
        :trailer="editing"
        :vehicles="vehicles ?? []"
        :submitting="saving"
        @submit="onSubmit"
        @cancel="drawerOpen = false"
      />
    </SlideOver>
  </div>
</template>
