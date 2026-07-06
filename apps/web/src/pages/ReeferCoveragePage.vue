<script setup lang="ts">
import { computed } from "vue";
import { useReeferCoverage } from "@/features/fuel/useReeferCoverage";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";

const { data, isLoading, isError, error, refetch, isFetching } = useReeferCoverage();
const { data: vehicles } = useVehiclesQuery();

const unit = (id: string) => vehicles.value?.find((v) => v.id === id)?.unit_number ?? id;
const median = computed(() => data.value?.fleetMedianSharePct ?? null);

// Only reefer-active trucks (bought ULSR in the window). Sorted by reefer gallons (from the aggregator).
const active = computed(() => (data.value?.perTruck ?? []).filter((t) => t.reeferActive));

/** Flag trucks whose reefer share is far from the fleet baseline (informational, not an alert). */
function shareTone(pct: number): string {
  const m = median.value;
  if (m == null) return "text-gray-700";
  if (pct < m * 0.4) return "text-amber-600"; // much less reefer than peers
  if (pct > m * 2) return "text-cyan-700"; // much more reefer than peers
  return "text-gray-700";
}
function staleTone(days: number | null): string {
  return days != null && days > 7 ? "text-amber-600 font-medium" : "text-gray-700";
}
</script>

<template>
  <div class="space-y-6">
    <p class="text-sm text-gray-500">
      Read-only view of reefer (ULSR) vs tractor (ULSD) fuel per truck over the last 90 days. Use it to see
      which trucks run reefers and how consistently — it never raises alerts. Only trucks that bought reefer
      fuel are shown.
    </p>

    <div v-if="!isLoading && !isError && data" class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Reefer-active trucks</dt>
        <dd class="mt-1 text-2xl font-bold text-gray-900">{{ data.reeferActiveCount }}<span class="text-base font-normal text-gray-400"> / {{ data.totalTrucks }}</span></dd>
      </div>
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Fleet median reefer share</dt>
        <dd class="mt-1 text-2xl font-bold text-gray-900">{{ median != null ? median + "%" : "—" }}</dd>
        <dd class="mt-0.5 text-xs text-gray-400">of fuel on reefer-active trucks</dd>
      </div>
    </div>

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <TableSkeleton v-if="isLoading" :cols="6" />
      <ErrorState v-else-if="isError" :message="error instanceof Error ? error.message : 'Failed to load'" :retrying="isFetching" @retry="refetch" />
      <div v-else-if="active.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        No reefer (ULSR) fuel purchases in the last 90 days.
      </div>
      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-sm">
          <thead class="text-left text-gray-500">
            <tr>
              <th class="px-6 py-3 font-medium">Truck</th>
              <th class="px-6 py-3 font-medium text-right">Reefer gal</th>
              <th class="px-6 py-3 font-medium text-right">Tractor gal</th>
              <th class="px-6 py-3 font-medium text-right">Reefer share</th>
              <th class="px-6 py-3 font-medium text-right">vs fleet</th>
              <th class="px-6 py-3 font-medium text-right">Days since reefer</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="t in active" :key="t.vehicleId">
              <td class="px-6 py-3 font-medium text-gray-900">{{ unit(t.vehicleId) }}</td>
              <td class="px-6 py-3 text-right text-gray-700">{{ t.reeferGal.toLocaleString() }}</td>
              <td class="px-6 py-3 text-right text-gray-700">{{ t.tractorGal.toLocaleString() }}</td>
              <td class="px-6 py-3 text-right font-medium" :class="shareTone(t.reeferSharePct)">{{ t.reeferSharePct }}%</td>
              <td class="px-6 py-3 text-right text-gray-500">
                <span v-if="median != null">{{ t.reeferSharePct > median ? "+" : "" }}{{ Math.round(t.reeferSharePct - median) }} pts</span>
                <span v-else>—</span>
              </td>
              <td class="px-6 py-3 text-right" :class="staleTone(t.daysSinceReefer)">{{ t.daysSinceReefer ?? "—" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
