<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { PlusIcon, ArrowDownTrayIcon } from "@heroicons/vue/20/solid";
import { VEHICLE_STATUSES, type Trailer, type TrailerInput } from "@fuelguard/shared";
import { useSessionStore } from "@/stores/session";
import {
  useTrailersQuery, useCreateTrailer, useUpdateTrailer, useRetireTrailer,
  useBulkUpdateTrailers, useSyncSamsaraTrailers,
} from "@/features/fleet/useTrailers";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import SlideOver from "@/components/SlideOver.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import AppSelect from "@/components/AppSelect.vue";
import SearchInput from "@/components/SearchInput.vue";
import KebabMenu from "@/components/KebabMenu.vue";
import SortableTh from "@/components/SortableTh.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import TablePagination from "@/components/TablePagination.vue";
import TrailerForm from "@/features/fleet/TrailerForm.vue";
import { useToastStore } from "@/stores/toast";
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

// ── selection (bulk edit) ─────────────────────────────────────────────────────────
const selected = ref<Set<string>>(new Set());
const pageIds = computed(() => pageRows.value.map((t) => t.id));
const allOnPageSelected = computed(() => pageIds.value.length > 0 && pageIds.value.every((id) => selected.value.has(id)));
function toggleAll() {
  const next = new Set(selected.value);
  if (allOnPageSelected.value) pageIds.value.forEach((id) => next.delete(id));
  else pageIds.value.forEach((id) => next.add(id));
  selected.value = next;
}
function toggleOne(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}
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
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p class="text-sm text-gray-500">Trailers and reefer tanks. Mark which trailers are reefers — only those are checked against reefer (ULSR) fuel.</p>
      <div v-if="session.canManage" class="flex flex-wrap items-center gap-2">
        <button
          v-if="session.admin"
          class="inline-flex items-center gap-x-1.5 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50"
          :disabled="syncTrailers.isPending.value"
          title="Import trailers from Samsara"
          @click="onSync"
        >
          <ArrowDownTrayIcon class="-ml-0.5 size-5" aria-hidden="true" />
          {{ syncTrailers.isPending.value ? "Syncing…" : "Sync from Samsara" }}
        </button>
        <button class="inline-flex items-center gap-x-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500" @click="openNew">
          <PlusIcon class="-ml-0.5 size-5" aria-hidden="true" /> New trailer
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div class="sm:max-w-xs sm:flex-1"><SearchInput v-model="search" placeholder="Search unit, make, model, plate…" /></div>
      <AppSelect v-model="reeferFilter" :options="reeferOptions" class="sm:w-44" />
      <AppSelect v-model="statusFilter" :options="statusOptions" class="sm:w-40" />
      <span class="text-sm text-gray-500 sm:ml-auto">{{ filtered.length }} total</span>
    </div>

    <!-- Bulk action bar -->
    <div v-if="session.canManage && selectedCount > 0" class="flex flex-wrap items-center gap-2 rounded-lg bg-indigo-50 px-4 py-2.5 ring-1 ring-indigo-100">
      <span class="text-sm font-medium text-indigo-800">{{ selectedCount }} selected</span>
      <button :disabled="bulkUpdate.isPending.value" class="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-cyan-700 ring-1 ring-cyan-300 ring-inset hover:bg-cyan-50 disabled:opacity-50" @click="bulkSet({ is_reefer: true })">Mark as reefer</button>
      <button :disabled="bulkUpdate.isPending.value" class="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50" @click="bulkSet({ is_reefer: false })">Unmark reefer</button>
      <button :disabled="bulkUpdate.isPending.value" class="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50" @click="bulkSet({ status: 'retired' })">Retire</button>
      <button class="text-sm font-medium text-gray-500 hover:text-gray-700" @click="selected = new Set()">Clear</button>
    </div>

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <TableSkeleton v-if="isLoading" :cols="7" />
      <ErrorState v-else-if="isError" :message="error instanceof Error ? error.message : 'Failed to load trailers'" :retrying="isFetching" @retry="refetch" />
      <div v-else-if="!trailers || trailers.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">No trailers yet. Add one, or sync from Samsara.</div>
      <div v-else-if="filtered.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">No trailers match these filters.</div>
      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-sm">
          <thead class="text-left text-gray-500">
            <tr>
              <th v-if="session.canManage" class="px-4 py-3">
                <input type="checkbox" class="size-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" :checked="allOnPageSelected" @change="toggleAll" />
              </th>
              <SortableTh label="Unit" sort-key="unit_number" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium" @sort="onSort" />
              <th class="px-6 py-3 font-medium">Trailer</th>
              <SortableTh label="Type" sort-key="is_reefer" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium" @sort="onSort" />
              <SortableTh label="Reefer tank" sort-key="reefer_tank_capacity_gal" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium" @sort="onSort" />
              <th class="px-6 py-3 font-medium">Paired tractor</th>
              <SortableTh label="Status" sort-key="status" :active="sort.key" :dir="sort.dir" th-class="px-6 py-3 font-medium" @sort="onSort" />
              <th class="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="t in pageRows" :key="t.id" :class="selected.has(t.id) ? 'bg-indigo-50/40' : ''">
              <td v-if="session.canManage" class="px-4 py-3">
                <input type="checkbox" class="size-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" :checked="selected.has(t.id)" @change="toggleOne(t.id)" />
              </td>
              <td class="px-6 py-3 font-medium text-gray-900">{{ t.unit_number }}</td>
              <td class="px-6 py-3 text-gray-700">{{ [t.year, t.make, t.model].filter(Boolean).join(" ") || "—" }}</td>
              <td class="px-6 py-3">
                <span v-if="t.is_reefer" class="inline-flex items-center rounded bg-cyan-100 px-1.5 py-0.5 text-xs font-medium text-cyan-700">Reefer</span>
                <span v-else class="text-xs text-gray-400">Dry / other</span>
              </td>
              <td class="px-6 py-3 text-gray-700">{{ t.is_reefer ? t.reefer_tank_capacity_gal + " gal" : "—" }}</td>
              <td class="px-6 py-3 text-gray-700">{{ vehUnit(t.assigned_vehicle_id) }}</td>
              <td class="px-6 py-3"><StatusBadge :status="t.status" /></td>
              <td class="px-6 py-3 text-right">
                <KebabMenu v-if="session.canManage">
                  <button class="kebab-item" @click="openEdit(t)">Edit</button>
                  <button class="kebab-item" @click="toggleReefer(t)">{{ t.is_reefer ? 'Unmark reefer' : 'Mark as reefer' }}</button>
                  <button v-if="t.status !== 'retired'" class="kebab-item kebab-item-danger" @click="onRetire(t)">Retire</button>
                </KebabMenu>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <TablePagination v-if="!isLoading && !isError && filtered.length > 0" :page="page" :page-size="PAGE_SIZE" :total="filtered.length" @update:page="page = $event" />
    </div>

    <SlideOver :open="drawerOpen" :title="editing ? 'Edit trailer' : 'New trailer'" @close="drawerOpen = false">
      <TrailerForm :trailer="editing" :vehicles="vehicles ?? []" :submitting="saving" @submit="onSubmit" @cancel="drawerOpen = false" />
    </SlideOver>
  </div>
</template>
