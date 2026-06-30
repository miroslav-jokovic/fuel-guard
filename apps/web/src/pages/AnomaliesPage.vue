<script setup lang="ts">
import { ref, computed } from "vue";
import { ANOMALY_SEVERITIES, RULE_IDS, type Anomaly } from "@fleetguard/shared";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useAnomaliesQuery, type AnomalyFilters } from "@/features/anomalies/useAnomalies";
import SlideOver from "@/components/SlideOver.vue";
import AnomalyDetail from "@/features/anomalies/AnomalyDetail.vue";
import AppSelect from "@/components/AppSelect.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";

const { data: vehicles } = useVehiclesQuery();
const filters = ref<AnomalyFilters>({ status: "open" });
const { data: anomalies, isLoading, isError, error, refetch, isFetching } = useAnomaliesQuery(filters);

const ruleOptions = [
  { value: undefined, label: "All rules" },
  ...RULE_IDS.map((r) => ({ value: r, label: r })),
];

const selected = ref<Anomaly | null>(null);

const unit = (vehicleId: string | null) =>
  vehicleId ? (vehicles.value?.find((v) => v.id === vehicleId)?.unit_number ?? "—") : "Unattributed";

const sevBadge = (s: string) =>
  s === "critical"
    ? "bg-red-100 text-red-800"
    : s === "high"
      ? "bg-orange-100 text-orange-800"
      : s === "medium"
        ? "bg-amber-100 text-amber-800"
        : "bg-gray-100 text-gray-600";

const fmt = (iso: string) => new Date(iso).toLocaleDateString();
const openCount = computed(() => anomalies.value?.length ?? 0);
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center gap-3">
      <AppSelect
        v-model="filters.status"
        :options="[
          { value: 'open', label: 'Open' },
          { value: 'investigating', label: 'Investigating' },
          { value: 'resolved', label: 'Resolved' },
          { value: 'dismissed', label: 'Dismissed' },
          { value: undefined, label: 'All (active)' },
        ]"
      />
      <AppSelect
        v-model="filters.severity"
        :options="[
          { value: undefined, label: 'All severities' },
          ...ANOMALY_SEVERITIES.map((s) => ({ value: s, label: s })),
        ]"
      />
      <AppSelect
        v-model="filters.vehicleId"
        :options="[
          { value: undefined, label: 'All vehicles' },
          ...(vehicles ?? []).map((v) => ({ value: v.id, label: v.unit_number })),
        ]"
      />
      <AppSelect v-model="filters.ruleId" :options="ruleOptions" />
      <span class="ml-auto text-sm text-gray-500">{{ openCount }} shown</span>
    </div>

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <TableSkeleton v-if="isLoading" :cols="6" />
      <ErrorState
        v-else-if="isError"
        :message="error instanceof Error ? error.message : 'Failed to load anomalies'"
        :retrying="isFetching"
        @retry="refetch"
      />
      <div v-else-if="!anomalies || anomalies.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        Nothing here — no anomalies match these filters.
      </div>
      <table v-else class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="text-left text-gray-500">
          <tr>
            <th class="px-6 py-3 font-medium">Severity</th>
            <th class="px-6 py-3 font-medium">Rule</th>
            <th class="px-6 py-3 font-medium">Vehicle</th>
            <th class="px-6 py-3 font-medium">Detail</th>
            <th class="px-6 py-3 font-medium">When</th>
            <th class="px-6 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="a in anomalies" :key="a.id" class="cursor-pointer hover:bg-gray-50" @click="selected = a">
            <td class="px-6 py-3">
              <span :class="['inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', sevBadge(a.severity)]">{{ a.severity }}</span>
            </td>
            <td class="px-6 py-3 font-mono text-xs text-gray-600">{{ a.rule_id }}</td>
            <td class="px-6 py-3 text-gray-900">{{ unit(a.vehicle_id) }}</td>
            <td class="max-w-md truncate px-6 py-3 text-gray-700">{{ a.message }}</td>
            <td class="px-6 py-3 whitespace-nowrap text-gray-500">{{ fmt(a.created_at) }}</td>
            <td class="px-6 py-3 text-right text-indigo-600">Review →</td>
          </tr>
        </tbody>
      </table>
    </div>

    <SlideOver :open="!!selected" title="Anomaly" @close="selected = null">
      <AnomalyDetail v-if="selected" :anomaly="selected" :vehicle-unit="unit(selected.vehicle_id)" @changed="selected = null" />
    </SlideOver>
  </div>
</template>
