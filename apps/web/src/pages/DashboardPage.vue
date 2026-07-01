<script setup lang="ts">
import { ref, computed } from "vue";
import { RouterLink } from "vue-router";
import { ArrowDownTrayIcon } from "@heroicons/vue/20/solid";
import type { ChartConfiguration } from "chart.js";
import type { TrendPoint } from "@fuelguard/shared";
import { useDashboard } from "@/features/dashboard/useDashboard";
import { useSessionStore } from "@/stores/session";
import { downloadReport } from "@/features/reports/download";
import BaseChart from "@/components/BaseChart.vue";
import { useToastStore } from "@/stores/toast";

const session = useSessionStore();
const days = ref(30);
const { data: s, isLoading } = useDashboard(days);

const stats = computed(() => [
  { label: "Fuel spend", value: s.value ? `$${s.value.totalSpend.toLocaleString()}` : "—" },
  { label: "Gallons", value: s.value ? s.value.totalGallons.toLocaleString() : "—" },
  { label: "Fleet avg MPG", value: s.value?.fleetMpg ?? "—" },
  { label: "Open anomalies", value: s.value?.openAnomalies ?? "—" },
]);

const mpgChart = computed<ChartConfiguration>(() => ({
  type: "line",
  data: {
    labels: s.value?.mpgTrend.map((p: TrendPoint) => p.date) ?? [],
    datasets: [{ label: "Fleet MPG", data: s.value?.mpgTrend.map((p: TrendPoint) => p.value) ?? [], borderColor: "#4f46e5", backgroundColor: "#4f46e5", tension: 0.3 }],
  },
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
}));

const spendChart = computed<ChartConfiguration>(() => ({
  type: "bar",
  data: {
    labels: s.value?.spendTrend.map((p: TrendPoint) => p.date) ?? [],
    datasets: [{ label: "Spend", data: s.value?.spendTrend.map((p: TrendPoint) => p.value) ?? [], backgroundColor: "#10b981" }],
  },
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
}));

const sevChart = computed<ChartConfiguration>(() => {
  const sev = s.value?.anomaliesBySeverity ?? { low: 0, medium: 0, high: 0, critical: 0 };
  return {
    type: "doughnut",
    data: {
      labels: ["Critical", "High", "Medium", "Low"],
      datasets: [{ data: [sev.critical, sev.high, sev.medium, sev.low], backgroundColor: ["#dc2626", "#ea580c", "#d97706", "#9ca3af"] }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  };
});

const toast = useToastStore();
const exporting = ref(false);
async function exportReport(path: string, filename: string) {
  exporting.value = true;
  try {
    await downloadReport(`${path}?days=${days.value}`, filename);
  } catch (e) {
    toast.error("Export failed", e instanceof Error ? e.message : undefined);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex gap-1 rounded-md bg-gray-100 p-1">
        <button
          v-for="d in [7, 30, 90]"
          :key="d"
          :class="['rounded px-3 py-1 text-sm font-medium', days === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500']"
          @click="days = d"
        >
          {{ d }}d
        </button>
      </div>
      <div v-if="session.canManage || session.readOnly" class="flex gap-2">
        <button :disabled="exporting" class="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50" @click="exportReport('/api/reports/transactions.csv', 'transactions.csv')">
          <ArrowDownTrayIcon class="size-4" /> Transactions CSV
        </button>
        <button :disabled="exporting" class="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50" @click="exportReport('/api/reports/summary.pdf', 'summary.pdf')">
          <ArrowDownTrayIcon class="size-4" /> Summary PDF
        </button>
      </div>
    </div>

    <dl class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <div v-for="stat in stats" :key="stat.label" class="rounded-lg bg-white px-4 py-5 shadow-sm ring-1 ring-gray-200">
        <dt class="truncate text-sm font-medium text-gray-500">{{ stat.label }}</dt>
        <dd class="mt-1 text-3xl font-semibold tracking-tight text-gray-900">{{ stat.value }}</dd>
      </div>
    </dl>

    <div v-if="isLoading" class="text-sm text-gray-500">Loading dashboard…</div>

    <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <h3 class="mb-3 text-sm font-semibold text-gray-900">Fleet MPG trend</h3>
        <BaseChart :config="mpgChart" />
      </div>
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <h3 class="mb-3 text-sm font-semibold text-gray-900">Fuel spend</h3>
        <BaseChart :config="spendChart" />
      </div>
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <h3 class="mb-3 text-sm font-semibold text-gray-900">Open anomalies by severity</h3>
        <BaseChart :config="sevChart" :height="240" />
      </div>
      <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <h3 class="mb-3 text-sm font-semibold text-gray-900">Top vehicles by risk</h3>
        <ul class="divide-y divide-gray-100 text-sm">
          <li v-for="v in s?.topVehiclesByRisk ?? []" :key="v.id" class="flex items-center justify-between py-2">
            <RouterLink :to="`/vehicles/${v.id}`" class="font-medium text-indigo-600 hover:text-indigo-500">{{ v.label }}</RouterLink>
            <span class="text-gray-600">{{ v.anomalyCount }} open<span v-if="v.criticalCount" class="text-red-600"> · {{ v.criticalCount }} critical</span></span>
          </li>
          <li v-if="(s?.topVehiclesByRisk ?? []).length === 0" class="py-2 text-gray-500">No flagged vehicles.</li>
        </ul>
      </div>
    </div>
  </div>
</template>
