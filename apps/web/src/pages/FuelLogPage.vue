<script setup lang="ts">
import { ref, computed } from "vue";
import { PlusIcon } from "@heroicons/vue/20/solid";
import type { FillUpInput } from "@fleetguard/shared";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useFuelTransactions, useCreateFillUp, type FuelFilters } from "@/features/fuel/useFuelLog";
import SlideOver from "@/components/SlideOver.vue";
import FillUpForm from "@/features/fuel/FillUpForm.vue";
import AppSelect from "@/components/AppSelect.vue";
import { useToastStore } from "@/stores/toast";

const { data: vehicles } = useVehiclesQuery();

const filters = ref<FuelFilters>({});
const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
  useFuelTransactions(filters);

const rows = computed(() => data.value?.pages.flat() ?? []);

const vehicleLabel = (id: string | null) =>
  id ? (vehicles.value?.find((v) => v.id === id)?.unit_number ?? "—") : "Unattributed";

const toast = useToastStore();
const drawerOpen = ref(false);
const createFillUp = useCreateFillUp();

async function onSubmit(payload: { input: FillUpInput; file: File | null }) {
  try {
    await createFillUp.mutateAsync(payload);
    drawerOpen.value = false;
    toast.success("Fill-up logged");
  } catch (e) {
    toast.error("Could not save fill-up", e instanceof Error ? e.message : undefined);
  }
}

const fmtDate = (iso: string) => new Date(iso).toLocaleString();
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <AppSelect
          v-model="filters.vehicleId"
          :options="[
            { value: undefined, label: 'All vehicles' },
            ...(vehicles ?? []).map((v) => ({ value: v.id, label: v.unit_number })),
          ]"
        />
      </div>
      <button
        class="inline-flex items-center gap-x-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
        @click="drawerOpen = true"
      >
        <PlusIcon class="-ml-0.5 size-5" aria-hidden="true" /> Log fill-up
      </button>
    </div>

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <div v-if="isLoading" class="px-6 py-10 text-sm text-gray-500">Loading fuel log…</div>
      <div v-else-if="isError" class="px-6 py-10 text-sm text-red-600">
        {{ error instanceof Error ? error.message : "Failed to load fuel log" }}
      </div>
      <div v-else-if="rows.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        No fill-ups recorded yet.
      </div>
      <table v-else class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="text-left text-gray-500">
          <tr>
            <th class="px-6 py-3 font-medium">When</th>
            <th class="px-6 py-3 font-medium">Vehicle</th>
            <th class="px-6 py-3 font-medium">Odometer</th>
            <th class="px-6 py-3 font-medium">Gallons</th>
            <th class="px-6 py-3 font-medium">$/gal</th>
            <th class="px-6 py-3 font-medium">MPG</th>
            <th class="px-6 py-3 font-medium">Flag</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="t in rows" :key="t.id">
            <td class="px-6 py-3 whitespace-nowrap text-gray-700">{{ fmtDate(t.fueled_at) }}</td>
            <td class="px-6 py-3 text-gray-900">{{ vehicleLabel(t.vehicle_id) }}</td>
            <td class="px-6 py-3 text-gray-700">{{ t.odometer ?? "—" }}</td>
            <td class="px-6 py-3 text-gray-700">{{ t.gallons }}</td>
            <td class="px-6 py-3 text-gray-700">{{ t.price_per_gal ?? "—" }}</td>
            <td class="px-6 py-3 text-gray-700">{{ t.computed_mpg ?? "—" }}</td>
            <td class="px-6 py-3">
              <div class="flex items-center gap-1">
                <span
                  v-if="t.has_anomaly"
                  class="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800"
                  >{{ t.max_severity ?? "flagged" }}</span
                >
                <span
                  v-if="t.ai_risk_level"
                  class="inline-flex rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800"
                  title="AI risk level"
                  >AI: {{ t.ai_risk_level }}</span
                >
                <span v-if="!t.has_anomaly && !t.ai_risk_level" class="text-gray-300">—</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="hasNextPage" class="border-t border-gray-100 px-6 py-3 text-center">
        <button
          class="text-sm font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-50"
          :disabled="isFetchingNextPage"
          @click="fetchNextPage()"
        >
          {{ isFetchingNextPage ? "Loading…" : "Load more" }}
        </button>
      </div>
    </div>

    <SlideOver :open="drawerOpen" title="Log fill-up" @close="drawerOpen = false">
      <FillUpForm
        :vehicles="vehicles ?? []"
        :submitting="createFillUp.isPending.value"
        @submit="onSubmit"
        @cancel="drawerOpen = false"
      />
    </SlideOver>
  </div>
</template>
