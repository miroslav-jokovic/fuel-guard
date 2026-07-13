<script setup lang="ts">
import { ref, computed } from "vue";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/vue";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  CurrencyDollarIcon,
  BeakerIcon,
  ChartBarSquareIcon,
  DocumentChartBarIcon,
  ShieldExclamationIcon,
  TableCellsIcon,
} from "@heroicons/vue/24/outline";
import type { ChartConfiguration } from "chart.js";
import { useDashboard } from "@/features/dashboard/useDashboard";
import { useSessionStore } from "@/stores/session";
import { downloadReport } from "@/features/reports/download";
import { useToastStore } from "@/stores/toast";
import BaseChart from "@/components/BaseChart.vue";
import FleetReadiness from "@/features/dashboard/FleetReadiness.vue";
import StatCard from "@/features/dashboard/StatCard.vue";
import ChartCard from "@/features/dashboard/ChartCard.vue";
import SeverityBreakdown from "@/features/dashboard/SeverityBreakdown.vue";
import RiskList from "@/features/dashboard/RiskList.vue";
import { viz, trendOptions, fmtDay, fmtMoney, fmtCompact } from "@/features/dashboard/chartTheme";

const session = useSessionStore();
const days = ref(30);
const RANGES = [7, 30, 90];
const { data: s, isLoading, isFetching } = useDashboard(days);

// ── KPI tiles ────────────────────────────────────────────────────────────────
const stats = computed(() => {
  const sev = s.value?.anomaliesBySeverity ?? { low: 0, medium: 0, high: 0, critical: 0 };
  const alerts = sev.critical + sev.high;
  return [
    {
      label: "Fuel spend",
      value: s.value ? `$${fmtCompact(s.value.totalSpend)}` : "—",
      valueTitle: s.value ? fmtMoney(s.value.totalSpend) : undefined,
      sub: `last ${days.value} days`,
      icon: CurrencyDollarIcon,
      tone: "text-emerald-600 bg-emerald-50",
      spark: s.value?.spendTrend.map((p) => p.value),
      sparkColor: viz.emerald,
    },
    {
      label: "Gallons",
      value: s.value ? fmtCompact(s.value.totalGallons) : "—",
      valueTitle: s.value ? `${s.value.totalGallons.toLocaleString()} gal` : undefined,
      sub: `last ${days.value} days`,
      icon: BeakerIcon,
      tone: "text-sky-600 bg-sky-50",
    },
    {
      label: "Fleet avg MPG",
      value: s.value?.fleetMpg != null ? String(s.value.fleetMpg) : "—",
      sub: "gallon-weighted",
      icon: ChartBarSquareIcon,
      tone: "text-indigo-600 bg-indigo-50",
      spark: s.value?.mpgTrend.map((p) => p.value),
      sparkColor: viz.indigo,
    },
    {
      label: "Active alerts",
      value: s.value ? String(alerts) : "—",
      sub: s.value ? `${s.value.openAnomalies} open case${s.value.openAnomalies === 1 ? "" : "s"}` : undefined,
      icon: ShieldExclamationIcon,
      tone: alerts > 0 ? "text-red-600 bg-red-50" : "text-gray-500 bg-gray-100",
    },
  ];
});

// ── Trend charts ─────────────────────────────────────────────────────────────
// Trends are zero-filled/org-tz-bucketed upstream; null MPG days render as honest GAPS (spanGaps off).
const mpgChart = computed<ChartConfiguration>(() => ({
  type: "line",
  data: {
    labels: s.value?.mpgTrend.map((p) => p.date) ?? [],
    datasets: [
      {
        label: "Fleet MPG",
        data: s.value?.mpgTrend.map((p) => p.value) ?? [],
        borderColor: viz.indigo,
        backgroundColor: viz.indigoWash,
        fill: true,
        tension: 0.3,
        spanGaps: false,
        borderWidth: 2,
        borderCapStyle: "round",
        borderJoinStyle: "round",
        pointRadius: 0,
        pointHitRadius: 12,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: viz.indigo,
        pointHoverBorderColor: "#ffffff",
        pointHoverBorderWidth: 2,
      },
    ],
  },
  options: trendOptions({
    series: "Fleet MPG",
    format: (v) => `${v} MPG`,
    tickFormat: (v) => String(v),
    beginAtZero: false,
  }),
}));

const spendChart = computed<ChartConfiguration>(() => ({
  type: "bar",
  data: {
    labels: s.value?.spendTrend.map((p) => p.date) ?? [],
    datasets: [
      {
        label: "Spend",
        data: s.value?.spendTrend.map((p) => p.value) ?? [],
        backgroundColor: viz.emerald,
        hoverBackgroundColor: "#047857",
        borderRadius: { topLeft: 4, topRight: 4 },
        borderSkipped: false,
        maxBarThickness: 24,
        categoryPercentage: 0.8,
        barPercentage: 0.9,
      },
    ],
  },
  options: trendOptions({ series: "Spend", format: (v) => fmtMoney(v) }),
}));

// ── Exports ──────────────────────────────────────────────────────────────────
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
const EXPORTS = [
  {
    label: "Transactions CSV",
    description: "Every fill in the selected range",
    icon: TableCellsIcon,
    run: () => exportReport("/api/reports/transactions.csv", "transactions.csv"),
  },
  {
    label: "Summary PDF",
    description: "Executive summary of this dashboard",
    icon: DocumentChartBarIcon,
    run: () => exportReport("/api/reports/summary.pdf", "summary.pdf"),
  },
];
</script>

<template>
  <div class="space-y-6">
    <!-- ── Page header: context + the one filter row that scopes everything below ── -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 class="text-lg font-semibold tracking-tight text-gray-900">Fleet overview</h2>
        <p class="mt-0.5 flex items-center gap-1.5 text-sm text-gray-500">
          Fuel activity and risk · last {{ days }} days
          <ArrowPathIcon
            v-if="isFetching && !isLoading"
            class="size-3.5 animate-spin text-gray-400"
            aria-hidden="true"
          />
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <div
          class="inline-flex gap-0.5 rounded-lg bg-gray-100 p-0.5"
          role="group"
          aria-label="Date range"
        >
          <button
            v-for="d in RANGES"
            :key="d"
            type="button"
            :aria-pressed="days === d"
            :class="[
              'rounded-md px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
              days === d ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-800',
            ]"
            @click="days = d"
          >
            {{ d }}d
          </button>
        </div>

        <Menu v-if="session.canManage || session.readOnly" as="div" class="relative">
          <MenuButton
            :disabled="exporting"
            class="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-300 ring-inset transition hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50"
          >
            <ArrowDownTrayIcon class="size-4" aria-hidden="true" />
            {{ exporting ? "Exporting…" : "Export" }}
            <ChevronDownIcon class="size-4 text-gray-400" aria-hidden="true" />
          </MenuButton>
          <transition
            enter-active-class="transition duration-100 ease-out"
            enter-from-class="scale-95 opacity-0"
            enter-to-class="scale-100 opacity-100"
            leave-active-class="transition duration-75 ease-in"
            leave-from-class="scale-100 opacity-100"
            leave-to-class="scale-95 opacity-0"
          >
            <MenuItems
              class="absolute right-0 z-20 mt-2 w-64 origin-top-right rounded-xl bg-white p-1 shadow-lg ring-1 ring-gray-200 focus:outline-none"
            >
              <MenuItem v-for="exp in EXPORTS" :key="exp.label" v-slot="{ active }">
                <button
                  type="button"
                  :class="['flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left', active ? 'bg-gray-50' : '']"
                  @click="exp.run()"
                >
                  <component :is="exp.icon" class="mt-0.5 size-5 shrink-0 text-gray-400" aria-hidden="true" />
                  <span>
                    <span class="block text-sm font-medium text-gray-900">{{ exp.label }}</span>
                    <span class="block text-xs text-gray-500">{{ exp.description }}</span>
                  </span>
                </button>
              </MenuItem>
            </MenuItems>
          </transition>
        </Menu>
      </div>
    </div>

    <!-- Everything below scopes to the selected range; refetch dims the frame instead of flashing skeletons. -->
    <div
      class="space-y-6 transition-opacity duration-200"
      :class="isFetching && !isLoading ? 'opacity-60' : ''"
      :aria-busy="isFetching"
    >
      <!-- ── KPI row ── -->
      <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          v-for="stat in stats"
          :key="stat.label"
          v-bind="stat"
          :loading="isLoading"
        />
      </dl>

      <FleetReadiness v-if="session.canManage" />

      <!-- ── Trends ── -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <template v-if="isLoading">
          <div v-for="i in 2" :key="i" class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div class="h-4 w-32 animate-pulse rounded bg-gray-100" />
            <div class="mt-4 h-60 animate-pulse rounded-lg bg-gray-50" />
          </div>
        </template>
        <template v-else>
          <ChartCard title="Fleet MPG trend" subtitle="Gallon-weighted daily average · gaps mean no valid fills">
            <BaseChart :config="mpgChart" :height="260" />
            <table class="sr-only">
              <caption>Fleet MPG by day</caption>
              <thead><tr><th scope="col">Day</th><th scope="col">MPG</th></tr></thead>
              <tbody>
                <tr v-for="p in s?.mpgTrend ?? []" :key="p.date">
                  <th scope="row">{{ fmtDay(p.date) }}</th>
                  <td>{{ p.value ?? "no data" }}</td>
                </tr>
              </tbody>
            </table>
          </ChartCard>
          <ChartCard title="Fuel spend" subtitle="Daily total across the fleet">
            <BaseChart :config="spendChart" :height="260" />
            <table class="sr-only">
              <caption>Fuel spend by day</caption>
              <thead><tr><th scope="col">Day</th><th scope="col">Spend</th></tr></thead>
              <tbody>
                <tr v-for="p in s?.spendTrend ?? []" :key="p.date">
                  <th scope="row">{{ fmtDay(p.date) }}</th>
                  <td>{{ p.value == null ? "no data" : fmtMoney(p.value) }}</td>
                </tr>
              </tbody>
            </table>
          </ChartCard>
        </template>
      </div>

      <!-- ── Risk breakdown ── -->
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <template v-if="isLoading">
          <div v-for="i in 3" :key="i" class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div class="h-4 w-40 animate-pulse rounded bg-gray-100" />
            <div class="mt-4 space-y-3">
              <div v-for="j in 4" :key="j" class="h-8 animate-pulse rounded-lg bg-gray-50" />
            </div>
          </div>
        </template>
        <template v-else>
          <SeverityBreakdown :severity="s?.anomaliesBySeverity ?? { low: 0, medium: 0, high: 0, critical: 0 }" />
          <RiskList
            title="Top vehicles by risk"
            :rows="s?.topVehiclesByRisk ?? []"
            link-base="/vehicles"
            empty-label="No flagged vehicles"
          />
          <RiskList
            title="Top drivers by risk"
            :rows="s?.topDriversByRisk ?? []"
            empty-label="No flagged drivers"
            class="md:col-span-2 xl:col-span-1"
          />
        </template>
      </div>
    </div>
  </div>
</template>
