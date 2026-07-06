<script setup lang="ts">
import { ref, computed } from "vue";
import { PlusIcon, ArrowDownTrayIcon } from "@heroicons/vue/20/solid";
import type { Trailer, TrailerInput } from "@fuelguard/shared";
import { useSessionStore } from "@/stores/session";
import { useTrailersQuery, useCreateTrailer, useUpdateTrailer, useRetireTrailer, useSyncSamsaraTrailers } from "@/features/fleet/useTrailers";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import SlideOver from "@/components/SlideOver.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import SearchInput from "@/components/SearchInput.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import TrailerForm from "@/features/fleet/TrailerForm.vue";
import { useToastStore } from "@/stores/toast";

const session = useSessionStore();
const { data: trailers, isLoading, isError, error, refetch, isFetching } = useTrailersQuery();
const { data: vehicles } = useVehiclesQuery();
const toast = useToastStore();

const search = ref("");
const filtered = computed(() => {
  const term = search.value.toLowerCase();
  return (trailers.value ?? []).filter((t) =>
    !term ? true : [t.unit_number, t.make, t.model, t.plate].filter(Boolean).some((f) => f!.toLowerCase().includes(term)),
  );
});

const vehUnit = (id: string | null) => (id ? (vehicles.value?.find((v) => v.id === id)?.unit_number ?? "—") : "—");

const createTrailer = useCreateTrailer();
const updateTrailer = useUpdateTrailer();
const retireTrailer = useRetireTrailer();
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
  } catch (e) {
    toast.error("Could not save trailer", e instanceof Error ? e.message : undefined);
  }
}

async function onSync() {
  try {
    const r = await syncTrailers.mutateAsync();
    toast.success(`Synced ${r.total} trailers from Samsara`, `${r.created} added, ${r.updated} updated, ${r.paired} paired to a tractor.`);
  } catch (e) {
    toast.error("Could not sync trailers", e instanceof Error ? e.message : undefined);
  }
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
      <p class="text-sm text-gray-500">Reefer trailers and their tank capacity. Reefer (ULSR) fuel is tracked against these.</p>
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

    <div class="sm:max-w-xs"><SearchInput v-model="search" placeholder="Search unit, make, model, plate…" /></div>

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <TableSkeleton v-if="isLoading" :cols="6" />
      <ErrorState v-else-if="isError" :message="error instanceof Error ? error.message : 'Failed to load trailers'" :retrying="isFetching" @retry="refetch" />
      <div v-else-if="!trailers || trailers.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        No trailers yet. Add one, or sync from Samsara.
      </div>
      <div v-else-if="filtered.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">No trailers match your search.</div>
      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-sm">
          <thead class="text-left text-gray-500">
            <tr>
              <th class="px-6 py-3 font-medium">Unit</th>
              <th class="px-6 py-3 font-medium">Trailer</th>
              <th class="px-6 py-3 font-medium">Reefer tank</th>
              <th class="px-6 py-3 font-medium">Paired tractor</th>
              <th class="px-6 py-3 font-medium">Status</th>
              <th class="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="t in filtered" :key="t.id">
              <td class="px-6 py-3 font-medium text-gray-900">{{ t.unit_number }}</td>
              <td class="px-6 py-3 text-gray-700">{{ [t.year, t.make, t.model].filter(Boolean).join(" ") || "—" }}</td>
              <td class="px-6 py-3 text-gray-700">{{ t.reefer_tank_capacity_gal }} gal</td>
              <td class="px-6 py-3 text-gray-700">{{ vehUnit(t.assigned_vehicle_id) }}</td>
              <td class="px-6 py-3"><StatusBadge :status="t.status" /></td>
              <td class="px-6 py-3 text-right whitespace-nowrap">
                <template v-if="session.canManage">
                  <button class="text-sm font-medium text-indigo-600 hover:text-indigo-500" @click="openEdit(t)">Edit</button>
                  <button v-if="t.status !== 'retired'" class="ml-4 text-sm font-medium text-red-600 hover:text-red-500" @click="onRetire(t)">Retire</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <SlideOver :open="drawerOpen" :title="editing ? 'Edit trailer' : 'New trailer'" @close="drawerOpen = false">
      <TrailerForm :trailer="editing" :vehicles="vehicles ?? []" :submitting="saving" @submit="onSubmit" @cancel="drawerOpen = false" />
    </SlideOver>
  </div>
</template>
