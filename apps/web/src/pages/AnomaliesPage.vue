<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { ANOMALY_SEVERITIES, RULE_IDS, formatRuleId, type Anomaly } from "@fuelguard/shared";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { useAnomaliesQuery, type AnomalyFilters } from "@/features/anomalies/useAnomalies";
import SlideOver from "@/components/SlideOver.vue";
import AnomalyDetail from "@/features/anomalies/AnomalyDetail.vue";
import AppSelect from "@/components/AppSelect.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import ErrorState from "@/components/ErrorState.vue";
import TablePagination from "@/components/TablePagination.vue";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";

const PAGE_SIZE = 20;
const session = useSessionStore();
const toast = useToastStore();
const { data: vehicles } = useVehiclesQuery();
const filters = ref<AnomalyFilters>({ status: "open" });
const { data: anomalies, isLoading, isError, error, refetch, isFetching } = useAnomaliesQuery(filters);

const setFrom = (v: string | undefined) => (filters.value = { ...filters.value, from: v });
const setTo = (v: string | undefined) => (filters.value = { ...filters.value, to: v });
const activeFilterCount = computed(() => {
  const f = filters.value;
  return [f.severity, f.vehicleId, f.ruleId, f.from, f.to].filter(Boolean).length;
});
function resetFilters() {
  filters.value = { status: "open" };
}

const rebuilding = ref(false);
async function rebuild() {
  if (!confirm("Re-score every transaction with the current rules? Existing false flags will clear; your notes are kept.")) return;
  rebuilding.value = true;
  const res = await apiFetch("/api/transactions/rebuild", { method: "POST" });
  rebuilding.value = false;
  if (res.ok) toast.success("Rebuild started", "Re-scoring in the background — refresh in a minute to see the cleaned-up list.");
  else toast.error("Could not start rebuild", res.error?.message);
}

const statusBadge = (s: string) =>
  s === "open"
    ? "bg-indigo-100 text-indigo-800"
    : s === "investigating"
      ? "bg-amber-100 text-amber-800"
      : s === "resolved"
        ? "bg-green-100 text-green-800"
        : "bg-gray-100 text-gray-600"; // dismissed / superseded

const page = ref(1);
watch(filters, () => (page.value = 1), { deep: true });
const total = computed(() => anomalies.value?.length ?? 0);
const pageRows = computed(() => (anomalies.value ?? []).slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

const ruleOptions = [
  { value: undefined, label: "All rules" },
  ...RULE_IDS.map((r) => ({ value: r, label: formatRuleId(r) })),
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
</script>

<template>
  <div class="space-y-6">
    <div class="rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 class="text-sm font-semibold text-gray-900">
          Anomalies
          <span class="ml-1 font-normal text-gray-400">· {{ total }}</span>
          <span v-if="activeFilterCount" class="ml-1 font-normal text-indigo-600">· {{ activeFilterCount }} filter{{ activeFilterCount > 1 ? "s" : "" }}</span>
        </h2>
        <div class="flex items-center gap-2">
          <button
            v-if="activeFilterCount"
            class="text-sm font-medium text-gray-500 hover:text-gray-700"
            @click="resetFilters"
          >
            Clear filters
          </button>
          <button
            v-if="session.canManage"
            :disabled="rebuilding"
            class="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50"
            title="Re-score every transaction with the current rules — clears stale/false flags"
            @click="rebuild"
          >
            {{ rebuilding ? "Rebuilding…" : "Rebuild" }}
          </button>
        </div>
      </div>
      <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <AppSelect
          v-model="filters.status"
          :options="[
            { value: 'open', label: 'Open' },
            { value: 'investigating', label: 'Investigating' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'dismissed', label: 'False alarm / Dismissed' },
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
      </div>
      <div class="mt-2">
        <DateRangeFilter :from="filters.from" :to="filters.to" @update:from="setFrom" @update:to="setTo" />
      </div>
    </div>

    <div class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <TableSkeleton v-if="isLoading" :cols="7" />
      <ErrorState
        v-else-if="isError"
        :message="error instanceof Error ? error.message : 'Failed to load anomalies'"
        :retrying="isFetching"
        @retry="refetch"
      />
      <div v-else-if="!anomalies || anomalies.length === 0" class="px-6 py-10 text-center text-sm text-gray-500">
        Nothing here — no anomalies match these filters.
      </div>
      <div v-else class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200 whitespace-nowrap text-sm">
        <thead class="text-left text-gray-500">
          <tr>
            <th class="px-6 py-3 font-medium">Severity</th>
            <th class="px-6 py-3 font-medium">Rule</th>
            <th class="px-6 py-3 font-medium">Vehicle</th>
            <th class="px-6 py-3 font-medium">Detail</th>
            <th class="px-6 py-3 font-medium">Status</th>
            <th class="px-6 py-3 font-medium">When</th>
            <th class="px-6 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="a in pageRows" :key="a.id" class="cursor-pointer hover:bg-gray-50" @click="selected = a">
            <td class="px-6 py-3">
              <span :class="['inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', sevBadge(a.severity)]">{{ a.severity }}</span>
            </td>
            <td class="px-6 py-3 text-sm text-gray-700">{{ formatRuleId(a.rule_id) }}</td>
            <td class="px-6 py-3 text-gray-900">{{ unit(a.vehicle_id) }}</td>
            <td class="max-w-md truncate px-6 py-3 text-gray-700">{{ a.message }}</td>
            <td class="px-6 py-3">
              <span :class="['inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', statusBadge(a.status)]">{{ a.status }}</span>
            </td>
            <td class="px-6 py-3 whitespace-nowrap text-gray-500">{{ fmt(a.created_at) }}</td>
            <td class="px-6 py-3 text-right">
              <span class="text-sm font-medium text-indigo-600">Review →</span>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
      <TablePagination
        v-if="!isLoading && !isError && total > 0"
        :page="page"
        :page-size="PAGE_SIZE"
        :total="total"
        @update:page="page = $event"
      />
    </div>

    <SlideOver :open="!!selected" title="Anomaly" @close="selected = null">
      <AnomalyDetail v-if="selected" :anomaly="selected" :vehicle-unit="unit(selected.vehicle_id)" @changed="selected = null" />
    </SlideOver>
  </div>
</template>
