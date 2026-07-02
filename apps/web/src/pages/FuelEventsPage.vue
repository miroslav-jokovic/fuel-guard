<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { supabase } from "@/lib/supabase";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";

interface FuelEvent {
  id: string;
  vehicle_id: string | null;
  happened_at: string;
  event_type: string;
  drop_pct: number | null;
  address: string | null;
}

const { data: vehicles } = useVehiclesQuery();
const unit = (id: string | null) => (id ? (vehicles.value?.find((v) => v.id === id)?.unit_number ?? "—") : "—");

const { data: events, isLoading, isError, error, refetch, isFetching } = useQuery({
  queryKey: ["fuel_events"],
  queryFn: async (): Promise<FuelEvent[]> => {
    const { data, error: e } = await supabase
      .from("fuel_events")
      .select("id, vehicle_id, happened_at, event_type, drop_pct, address")
      .order("happened_at", { ascending: false })
      .limit(200);
    if (e) throw new Error(e.message);
    return (data ?? []) as FuelEvent[];
  },
});

const rows = computed(() => events.value ?? []);
const fmt = (iso: string) => new Date(iso).toLocaleString();
</script>

<template>
  <div class="space-y-6">
    <div class="rounded-md bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-200">
      Sudden fuel-level drops reported by Samsara in real time. A drop is fuel leaving the tank with no
      purchase — a possible siphoning event worth investigating.
    </div>

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <TableSkeleton v-if="isLoading" :cols="4" />
      <ErrorState
        v-else-if="isError"
        :message="error instanceof Error ? error.message : 'Failed to load fuel events'"
        :retrying="isFetching"
        @retry="refetch"
      />
      <div v-else-if="rows.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        No fuel-drop events yet. Once the Samsara webhook is configured, siphoning alerts appear here.
      </div>
      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-sm">
          <thead class="text-left text-gray-500">
            <tr>
              <th class="px-6 py-3 font-medium">When</th>
              <th class="px-6 py-3 font-medium">Vehicle</th>
              <th class="px-6 py-3 font-medium">Drop</th>
              <th class="px-6 py-3 font-medium">Location</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="ev in rows" :key="ev.id">
              <td class="px-6 py-3 whitespace-nowrap text-gray-700">{{ fmt(ev.happened_at) }}</td>
              <td class="px-6 py-3 text-gray-900">{{ unit(ev.vehicle_id) }}</td>
              <td class="px-6 py-3">
                <span class="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                  {{ ev.drop_pct != null ? `−${ev.drop_pct}%` : "Fuel drop" }}
                </span>
              </td>
              <td class="px-6 py-3 text-gray-700">{{ ev.address ?? "—" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
