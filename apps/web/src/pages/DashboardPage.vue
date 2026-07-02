<script setup lang="ts">
import { ref, computed, type FunctionalComponent } from "vue";
import { RouterLink } from "vue-router";
import {
  ArrowDownTrayIcon,
  CurrencyDollarIcon,
  BeakerIcon,
  ChartBarSquareIcon,
  ShieldExclamationIcon,
} from "@heroicons/vue/24/outline";
import type { ChartConfiguration } from "chart.js";
import { useDashboard } from "@/features/dashboard/useDashboard";
import { useSessionStore } from "@/stores/session";
import { downloadReport } from "@/features/reports/download";
import BaseChart from "@/components/BaseChart.vue";
import FleetReadiness from "@/features/dashboard/FleetReadiness.vue";
import { useToastStore } from "@/stores/toast";

const session = useSessionStore();
const days = ref(30);
const { data: s, isLoading } = useDashboard(days);

interface Stat {
  label: string;
  value: string | number;
  sub?: string;
  icon: FunctionalComponent;
  tone: string;
}
const stats = computed<Stat[]>(() => {
  const sev = s.value?.anomaliesBySeverity ?? { low: 0, medium: 0, high: 0, critical: 0 };
  const alerts = sev.critical + sev.high;
  return [
    { label: "Fuel spend", value: s.value ? `$${s.value.totalSpend.toLocaleString()}` : "—", icon: CurrencyDollarIcon, tone: "text-emerald-600 bg-emerald-50" },
    { label: "Gallons", value: s.value ? s.value.totalGallons.toLocaleString() : "—", icon: BeakerIcon, tone: "text-sky-600 bg-sky-50" },
    { label: "Fleet avg MPG", value: s.value?.fleetMpg ?? "—", icon: ChartBarSquareIcon, tone: "text-indigo-600 bg-indigo-50" },
    {
      label: "Active alerts",
      value: s.value ? alerts : "—",
      sub: s.value ? `${s.value.openAnomalies} open case${s.value.openAnomalies === 1 ? "" : "s"}` : undefined,
      icon: ShieldExclamationIcon,
      tone: alerts > 0 ? "text-red-600 bg-red-50" : "text-gray-500 bg-gray-100",
    },
  ];
});

// Trends are zero-filled/org-tz-bucketed upstream; null MPG days render as honest GAPS (spanGaps off).
const mpgChart = computed<ChartConfiguration>(() => ({
  type: "line",
  data: {
    labels: s.value?.mpgTrend.map((p: { date: string; value: number | null }) => p.date) ?? [],
    datasets: [{ label: "Fleet MPG", data: s.value?.mpgTrend.map((p: { date: string; value: number | null }) => p.value) ?? [], borderColor: "#4f46e5", backgroundColor: "#4f46e5", tension: 0.3, fill: false, spanGaps: false }],
  },
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
}));

const spendChart = computed<ChartConfiguration>(() => ({
  type: "bar",
  data: {
    labels: s.value?.spendTrend.map((p: { date: string; value: number | null }) => p.date) ?? [],
    datasets: [{ label: "Spend", data: s.value?.spendTrend.map((p: { date: string; value: number | null }) => p.value) ?? [], backgroundColor: "#10b981", borderRadius: 4 }],
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
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } },
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
    <!-- Controls -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="inline-flex gap-1 rounded-md bg-gray-100 p-1">
        <button
          v-for="d in [7, 30, 90]"
          :key="d"
          :class="['rounded px-3 py-1 text-sm font-medium transition', days === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700']"
          @click="days = d"
        >
          {{ d }}d
        </button>
      </div>
      <div v-if="session.canManage || session.readOnly" class="flex flex-wrap gap-2">
        <button :disabled="exporting" class="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50" @click="exportReport('/api/reports/transactions.csv', 'transactions.csv')">
          <ArrowDownTrayIcon class="size-4" /> <span class="hidden sm:inline">Transactions</span> CSV
        </button>
        <button :disabled="exporting" class="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 ring-inset hover:bg-gray-50 disabled:opacity-50" @click="exportReport('/api/reports/summary.pdf', 'summary.pdf')">
          <ArrowDownTrayIcon class="size-4" /> <span class="hidden sm:inline">Summary</span> PDF
        </button>
      </div>
    </div>

    <!-- Stat cards -->
    <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div v-for="stat in stats" :key="stat.label" class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <div class="flex items-center justify-between">
          <dt class="text-sm font-medium text-gray-500">{{ stat.label }}</dt>
          <span :class="['inline-flex size-8 items-center justify-center rounded-lg', stat.tone]">
            <component :is="stat.icon" class="size-5" aria-hidden="true" />
          </span>
        </div>
        <dd class="mt-2 text-3xl font-semibold tracking-tight text-gray-900">{{ stat.value }}</dd>
        <dd v-if="stat.sub" class="mt-0.5 text-xs text-gray-400">{{ stat.sub }}</dd>
      </div>
    </dl>

    <FleetReadiness v-if="session.canManage" />

    <div v-if="isLoading" class="rounded-lg bg-white p-10 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
      Loading dashboard…
    </div>

    <template v-else>
      <!-- Trends -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <h3 class="mb-3 text-sm font-semibold text-gray-900">Fleet MPG trend</h3>
          <BaseChart :config="mpgChart" :height="240" />
        </div>
        <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <h3 class="mb-3 text-sm font-semibold text-gray-900">Fuel spend</h3>
          <BaseChart :config="spendChart" :height="240" />
        </div>
      </div>

      <!-- Risk breakdown -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <h3 class="mb-3 text-sm font-semibold text-gray-900">Open cases by severity</h3>
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
        <div class="rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200">
          <h3 class="mb-3 text-sm font-semibold text-gray-900">Top drivers by risk</h3>
          <ul class="divide-y divide-gray-100 text-sm">
            <li v-for="d in s?.topDriversByRisk ?? []" :key="d.id" class="flex items-center justify-between py-2">
              <span class="font-medium text-gray-900">{{ d.label }}</span>
              <span class="text-gray-600">{{ d.anomalyCount }} open<span v-if="d.criticalCount" class="text-red-600"> · {{ d.criticalCount }} critical</span></span>
            </li>
            <li v-if="(s?.topDriversByRisk ?? []).length === 0" class="py-2 text-gray-500">No flagged drivers.</li>
          </ul>
        </div>
      </div>
    </template>
  </div>
</template>
