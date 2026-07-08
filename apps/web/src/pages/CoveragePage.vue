<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useDetectionCoverage } from "@/features/fuel/useDetectionCoverage";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import TablePagination from "@/components/TablePagination.vue";

const { data, isLoading, isError, error, refetch, isFetching } = useDetectionCoverage();
const { data: vehicles } = useVehiclesQuery();

const unit = (id: string) => vehicles.value?.find((v) => v.id === id)?.unit_number ?? id;
const trucks = computed(() => data.value?.perTruck ?? []);

const PAGE_SIZE = 20;
const page = ref(1);
watch(trucks, () => (page.value = 1));
const paged = computed(() => trucks.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const fmtPct = (n: number) => `${Math.round(n)}%`;
const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// Higher coverage = greener; blind share inverts the scale.
const covTone = (p: number) => (p >= 85 ? "text-green-700" : p >= 50 ? "text-amber-600" : "text-red-700");
const blindTone = (p: number) => (p <= 15 ? "text-green-700" : p <= 50 ? "text-amber-600" : "text-red-700");
</script>

<template>
  <div class="space-y-6">
    <p class="text-sm text-gray-500">
      How much of the last 90 days of fuel data the system could actually corroborate against Samsara —
      and which trucks are blind spots. A fill with no telematics match is still scored on internal
      physics, but it can't be cross-checked against location or a true odometer, so heavy blind coverage
      means "we didn't flag it" carries less weight. This is the honest bound on how much we can catch.
    </p>

    <div v-if="!isLoading && !isError && data" class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Telematics coverage</dt>
        <dd class="mt-1 text-2xl font-bold" :class="covTone(data.reconciledPct)">{{ fmtPct(data.reconciledPct) }}</dd>
        <dd class="mt-0.5 text-xs text-gray-400">{{ data.blindFills.toLocaleString() }} of {{ data.totalFills.toLocaleString() }} fills blind</dd>
      </div>
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Location-verifiable</dt>
        <dd class="mt-1 text-2xl font-bold" :class="covTone(data.locationPct)">{{ fmtPct(data.locationPct) }}</dd>
        <dd class="mt-0.5 text-xs text-gray-400">could judge where the truck was</dd>
      </div>
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Odometer-verifiable</dt>
        <dd class="mt-1 text-2xl font-bold" :class="covTone(data.odometerPct)">{{ fmtPct(data.odometerPct) }}</dd>
        <dd class="mt-0.5 text-xs text-gray-400">fueling-time odometer available</dd>
      </div>
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <dt class="text-xs font-medium uppercase tracking-wide text-gray-500">Attributed</dt>
        <dd class="mt-1 text-2xl font-bold" :class="covTone(data.attributedPct)">{{ fmtPct(data.attributedPct) }}</dd>
        <dd class="mt-0.5 text-xs text-gray-400">{{ data.unattributed.toLocaleString() }} unmatched to a truck/driver</dd>
      </div>
    </div>

    <!-- Fueling-time confidence mix -->
    <div v-if="data && data.totalFills > 0" class="rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">Fueling-time confidence</h3>
        <p class="text-xs text-gray-400">Last telematics match: {{ fmtDateTime(data.lastReconciledAt) }} · <RouterLink to="/settings/data" class="text-indigo-600 hover:text-indigo-500">Re-sync</RouterLink></p>
      </div>
      <div class="mt-2 flex flex-wrap gap-2 text-sm">
        <span class="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 ring-1 ring-green-200"><span class="font-medium text-green-800">Tank-confirmed</span><span class="text-green-700">{{ data.timeBasis.tank_confirmed }}</span></span>
        <span class="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 ring-1 ring-blue-200"><span class="font-medium text-blue-800">Stop-estimated</span><span class="text-blue-700">{{ data.timeBasis.stop_estimated }}</span></span>
        <span class="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 ring-1 ring-amber-200"><span class="font-medium text-amber-800">Reported time</span><span class="text-amber-700">{{ data.timeBasis.reported }}</span></span>
        <span class="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 ring-1 ring-gray-200"><span class="font-medium text-gray-700">Date only</span><span class="text-gray-600">{{ data.timeBasis.date_only }}</span></span>
        <span class="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 ring-1 ring-gray-200"><span class="font-medium text-gray-700">No telematics</span><span class="text-gray-600">{{ data.timeBasis.none }}</span></span>
      </div>
    </div>

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <TableSkeleton v-if="isLoading" :cols="7" />
      <ErrorState v-else-if="isError" :message="error instanceof Error ? error.message : 'Failed to load'" :retrying="isFetching" @retry="refetch" />
      <div v-else-if="trucks.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        No fuel activity in the last 90 days.
      </div>
      <template v-else>
        <div class="border-b border-gray-100 px-4 py-2.5 text-xs text-gray-500">Trucks with the biggest blind spots first — these are where detection is weakest.</div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-sm">
            <thead class="text-left text-gray-500">
              <tr>
                <th class="px-4 py-3 font-medium">Truck</th>
                <th class="px-4 py-3 font-medium text-right">Fills</th>
                <th class="px-4 py-3 font-medium text-right">Blind</th>
                <th class="px-4 py-3 font-medium text-right">Telematics</th>
                <th class="px-4 py-3 font-medium text-right">Location</th>
                <th class="px-4 py-3 font-medium text-right">Odometer</th>
                <th class="px-4 py-3 font-medium text-right">Attributed</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr v-for="t in paged" :key="t.vehicleId">
                <td class="px-4 py-3 font-medium text-gray-900">
                  <RouterLink :to="`/vehicles/${t.vehicleId}`" class="text-indigo-600 hover:text-indigo-500">{{ unit(t.vehicleId) }}</RouterLink>
                </td>
                <td class="px-4 py-3 text-right text-gray-700">{{ t.fills.toLocaleString() }}</td>
                <td class="px-4 py-3 text-right font-medium" :class="blindTone(t.blindPct)">{{ t.blindFills }} ({{ fmtPct(t.blindPct) }})</td>
                <td class="px-4 py-3 text-right" :class="covTone(t.reconciledPct)">{{ fmtPct(t.reconciledPct) }}</td>
                <td class="px-4 py-3 text-right" :class="covTone(t.locationPct)">{{ fmtPct(t.locationPct) }}</td>
                <td class="px-4 py-3 text-right" :class="covTone(t.odometerPct)">{{ fmtPct(t.odometerPct) }}</td>
                <td class="px-4 py-3 text-right" :class="covTone(t.attributedPct)">{{ fmtPct(t.attributedPct) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <TablePagination :page="page" :page-size="PAGE_SIZE" :total="trucks.length" @update:page="page = $event" />
      </template>
    </div>
  </div>
</template>
