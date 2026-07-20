<script setup lang="ts">
import { ref, computed } from "vue";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/vue";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  CurrencyDollarIcon,
  FireIcon,
  ChartBarSquareIcon,
  DocumentChartBarIcon,
  ShieldExclamationIcon,
  SignalIcon,
  CubeIcon,
  NoSymbolIcon,
  TableCellsIcon,
} from "@heroicons/vue/24/outline";
import type { ChartConfiguration } from "chart.js";
import { useDashboard } from "@/features/dashboard/useDashboard";
import { useSessionStore } from "@/stores/session";
import { downloadReport } from "@/features/reports/download";
import { useToastStore } from "@/stores/toast";
import BaseChart from "@/components/BaseChart.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import FleetReadiness from "@/features/dashboard/FleetReadiness.vue";
import StatCard from "@/features/dashboard/StatCard.vue";
import ChartCard from "@/features/dashboard/ChartCard.vue";
import SeverityBreakdown from "@/features/dashboard/SeverityBreakdown.vue";
import RiskList from "@/features/dashboard/RiskList.vue";
import { viz, COST_COLORS, resolve, areaFill, donutGradient, trendOptions, fmtDay, fmtMoney, fmtCompact } from "@/features/dashboard/chartTheme";

const session = useSessionStore();
// Date range scoping the whole page (YYYY-MM-DD | undefined). Default window: the last 30 days.
const from = ref<string>();
const to = ref<string>();
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const range = computed(() => {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86400_000);
  return { from: from.value ?? isoDay(start), to: to.value ?? isoDay(end) };
});
const { data: s, isLoading, isFetching } = useDashboard(range);

// Human label for the active window (matches the picker's "Jul 1 – Jul 13" style).
const labelDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const rangeLabel = computed(() => {
  const { from: f, to: t } = range.value;
  return f === t ? labelDay(f) : `${labelDay(f)} – ${labelDay(t)}`;
});

// KPI hero — the money + risk headline, each tile drilling into its detail page.
const stats = computed(() => {
  const sev = s.value?.anomaliesBySeverity ?? { low: 0, medium: 0, high: 0, critical: 0 };
  const alerts = sev.critical + sev.high;
  return [
    {
      label: "Fuel spend",
      value: s.value ? `$${fmtCompact(s.value.totalSpend)}` : "—",
      valueTitle: s.value ? fmtMoney(s.value.totalSpend) : undefined,
      sub: rangeLabel.value,
      icon: CurrencyDollarIcon,
      tone: "text-success-600 bg-success-50",
      spark: s.value?.spendTrend.map((p) => p.value),
      sparkColor: viz.spend,
      to: "/transactions",
    },
    {
      label: "Fleet avg MPG",
      value: s.value?.fleetMpg != null ? String(s.value.fleetMpg) : "—",
      sub: "gallon-weighted",
      icon: ChartBarSquareIcon,
      tone: "text-brand-600 bg-brand-50",
      spark: s.value?.mpgTrend.map((p) => p.value),
      sparkColor: viz.brand,
      to: "/driver-performance",
    },
    {
      label: "Idle waste",
      value: s.value ? `$${fmtCompact(s.value.idleCostUsd)}` : "—",
      valueTitle: s.value ? fmtMoney(s.value.idleCostUsd) : undefined,
      sub: s.value ? `${Math.round(s.value.idleHours).toLocaleString()} idle hrs` : undefined,
      icon: FireIcon,
      tone: "text-caution-700 bg-caution-50",
      to: "/idling",
    },
    {
      label: "Active alerts",
      value: s.value ? String(alerts) : "—",
      sub: s.value ? `${s.value.openAnomalies} open case${s.value.openAnomalies === 1 ? "" : "s"}` : undefined,
      icon: ShieldExclamationIcon,
      tone: alerts > 0 ? "text-danger-600 bg-danger-50" : "text-ink-muted bg-surface-muted",
      to: "/anomalies",
    },
  ];
});

// Trust & leakage strip — makes the numbers above believable and surfaces money left on the table.
const trust = computed(() => [
  {
    label: "Telematics coverage",
    value: s.value?.coveragePct != null ? `${s.value.coveragePct}%` : "—",
    sub: "fills corroborated",
    icon: SignalIcon,
    tone: "text-info-600 bg-info-50",
    to: "/coverage",
  },
  {
    label: "Reefer fuel",
    value: s.value ? `$${fmtCompact(s.value.reeferSpend)}` : "—",
    valueTitle: s.value ? fmtMoney(s.value.reeferSpend) : undefined,
    sub: "refrigerated tank",
    icon: CubeIcon,
    tone: "text-info-600 bg-info-50",
    to: "/reefer-coverage",
  },
  {
    label: "Declined attempts",
    value: s.value ? String(s.value.declinedCount) : "—",
    sub: "blocked at the pump",
    icon: NoSymbolIcon,
    tone: (s.value?.declinedCount ?? 0) > 0 ? "text-caution-700 bg-caution-50" : "text-ink-muted bg-surface-muted",
    to: "/rejections",
  },
]);

// Trends are zero-filled/org-tz-bucketed upstream; null MPG days render as honest GAPS (spanGaps off).
const mpgChart = computed<ChartConfiguration>(() => ({
  type: "line",
  data: {
    labels: s.value?.mpgTrend.map((p) => p.date) ?? [],
    datasets: [
      {
        label: "Fleet MPG",
        data: s.value?.mpgTrend.map((p) => p.value) ?? [],
        borderColor: viz.brand,
        backgroundColor: areaFill("--viz-brand") as unknown as string,
        fill: true,
        tension: 0.4,
        spanGaps: false,
        borderWidth: 2.5,
        borderCapStyle: "round",
        borderJoinStyle: "round",
        pointRadius: 0,
        pointHitRadius: 12,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: viz.brand,
        pointHoverBorderColor: viz.pointHalo,
        pointHoverBorderWidth: 2,
      },
    ],
  },
  options: trendOptions({ series: "Fleet MPG", format: (v) => `${v} MPG`, tickFormat: (v) => String(v), beginAtZero: false }),
}));

// Spend as a modern gradient-style area line (single axis — never combined with MPG per viz rules).
const spendChart = computed<ChartConfiguration>(() => ({
  type: "line",
  data: {
    labels: s.value?.spendTrend.map((p) => p.date) ?? [],
    datasets: [
      {
        label: "Spend",
        data: s.value?.spendTrend.map((p) => p.value) ?? [],
        borderColor: viz.spend,
        backgroundColor: areaFill("--viz-spend") as unknown as string,
        fill: true,
        tension: 0.4,
        spanGaps: false,
        borderWidth: 2.5,
        borderCapStyle: "round",
        borderJoinStyle: "round",
        pointRadius: 0,
        pointHitRadius: 12,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: viz.spend,
        pointHoverBorderColor: viz.pointHalo,
        pointHoverBorderWidth: 2,
      },
    ],
  },
  options: trendOptions({ series: "Spend", format: (v) => fmtMoney(v) }),
}));

// Cost composition — where every fuel dollar goes. Validated 3-hue palette, always with direct labels.
const costSlices = computed(() => {
  const m = s.value?.movingSpend ?? 0;
  const i = s.value?.idleCostUsd ?? 0;
  const r = s.value?.reeferSpend ?? 0;
  const tot = m + i + r;
  const pct = (v: number) => (tot > 0 ? Math.round((v / tot) * 100) : 0);
  return [
    { label: "Moving fuel", value: m, pct: pct(m), color: COST_COLORS.moving },
    { label: "Idle waste", value: i, pct: pct(i), color: COST_COLORS.idle },
    { label: "Reefer", value: r, pct: pct(r), color: COST_COLORS.reefer },
  ];
});
const costTotal = computed(() => costSlices.value.reduce((n, x) => n + x.value, 0));
const costChart = computed<ChartConfiguration>(() => ({
  type: "doughnut",
  data: {
    labels: costSlices.value.map((x) => x.label),
    datasets: [
      {
        data: costSlices.value.map((x) => x.value),
        backgroundColor: donutGradient(costSlices.value.map((x) => x.color)) as unknown as string,
        borderColor: resolve("--ink-inverse"),
        borderWidth: 0,
        spacing: 3,
        borderRadius: 6,
        hoverOffset: 6,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    // Reserve a margin >= hoverOffset so the enlarged slice on hover never clips at the canvas edge.
    layout: { padding: 10 },
    cutout: "70%",
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: resolve("--surface-inverse"),
        titleColor: resolve("--ramp-neutral-50"),
        bodyColor: resolve("--ramp-neutral-200"),
        padding: 10,
        cornerRadius: 8,
        callbacks: {
          label: (item) => `${item.label}: ${fmtMoney(Number(item.parsed))}`,
        },
      },
    },
  },
}));

// Exports
const toast = useToastStore();
const exporting = ref(false);
async function exportReport(path: string, filename: string) {
  exporting.value = true;
  try {
    // Match the on-screen window exactly (the report endpoints read from/to; the old ?days= was ignored).
    const fromIso = new Date(`${range.value.from}T00:00:00`).toISOString();
    const toIso = new Date(`${range.value.to}T23:59:59.999`).toISOString();
    await downloadReport(`${path}?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`, filename);
  } catch (e) {
    toast.error("Export failed", e instanceof Error ? e.message : undefined);
  } finally {
    exporting.value = false;
  }
}
const EXPORTS = [
  { label: "Transactions CSV", description: "Every fill in the selected range", icon: TableCellsIcon, run: () => exportReport("/api/reports/transactions.csv", "transactions.csv") },
  { label: "Summary PDF", description: "Executive summary of this dashboard", icon: DocumentChartBarIcon, run: () => exportReport("/api/reports/summary.pdf", "summary.pdf") },
];
</script>

<template>
  <div class="space-y-6">
    <!-- Page header: context + the one filter row that scopes everything below -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 class="text-lg font-semibold tracking-tight text-ink">Fleet overview</h2>
        <p class="mt-0.5 flex items-center gap-1.5 text-sm text-ink-muted">
          Fuel, waste &amp; risk · {{ rangeLabel }}
          <ArrowPathIcon v-if="isFetching && !isLoading" class="size-3.5 animate-spin text-ink-subtle" aria-hidden="true" />
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <DateRangeFilter v-model:from="from" v-model:to="to" />

        <Menu v-if="session.canManage || session.readOnly" as="div" class="relative">
          <MenuButton
            :disabled="exporting"
            class="inline-flex items-center gap-1.5 rounded-lg bg-surface px-3 py-1.5 text-sm font-medium text-ink-secondary shadow-sm ring-1 ring-edge-strong ring-inset transition hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50"
          >
            <ArrowDownTrayIcon class="size-4" aria-hidden="true" />
            {{ exporting ? "Exporting…" : "Export" }}
            <ChevronDownIcon class="size-4 text-ink-subtle" aria-hidden="true" />
          </MenuButton>
          <transition
            enter-active-class="transition duration-100 ease-out"
            enter-from-class="scale-95 opacity-0"
            enter-to-class="scale-100 opacity-100"
            leave-active-class="transition duration-75 ease-in"
            leave-from-class="scale-100 opacity-100"
            leave-to-class="scale-95 opacity-0"
          >
            <MenuItems class="absolute right-0 z-20 mt-2 w-64 origin-top-right rounded-md bg-surface py-1 text-sm shadow-lg ring-1 ring-edge focus:outline-none">
              <MenuItem v-for="exp in EXPORTS" :key="exp.label" v-slot="{ active }">
                <button type="button" :class="['kebab-item flex items-start gap-3', active ? 'bg-surface-subtle' : '']" @click="exp.run()">
                  <component :is="exp.icon" class="mt-0.5 size-5 shrink-0 text-ink-subtle" aria-hidden="true" />
                  <span>
                    <span class="block font-medium text-ink">{{ exp.label }}</span>
                    <span class="block text-xs text-ink-muted">{{ exp.description }}</span>
                  </span>
                </button>
              </MenuItem>
            </MenuItems>
          </transition>
        </Menu>
      </div>
    </div>

    <div class="space-y-6 transition-opacity duration-200" :class="isFetching && !isLoading ? 'opacity-60' : ''" :aria-busy="isFetching">
      <!-- KPI hero -->
      <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard v-for="stat in stats" :key="stat.label" v-bind="stat" :loading="isLoading" />
      </dl>

      <!-- Trust & leakage strip -->
      <dl class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard v-for="stat in trust" :key="stat.label" v-bind="stat" :loading="isLoading" />
      </dl>

      <FleetReadiness v-if="session.canManage" />

      <!-- Trends -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <template v-if="isLoading">
          <BaseCard v-for="i in 2" :key="i">
            <div class="h-4 w-32 animate-pulse rounded bg-surface-muted" />
            <div class="mt-4 h-60 animate-pulse rounded-lg bg-surface-subtle" />
          </BaseCard>
        </template>
        <template v-else>
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
        </template>
      </div>

      <!-- Cost composition + severity -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Where fuel dollars go" subtitle="Moving fuel vs idle waste vs reefer · this range">
          <div class="flex flex-col items-center gap-5 sm:flex-row">
            <div class="relative h-44 w-44 shrink-0">
              <BaseChart :config="costChart" :height="176" />
              <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span class="text-lg font-semibold text-ink">${{ fmtCompact(costTotal) }}</span>
                <span class="text-[11px] text-ink-subtle">total</span>
              </div>
            </div>
            <ul class="min-w-0 flex-1 space-y-2.5 self-stretch">
              <li v-for="slice in costSlices" :key="slice.label" class="flex items-center justify-between gap-3 text-sm">
                <span class="flex min-w-0 items-center gap-2">
                  <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: slice.color }" aria-hidden="true" /> <!-- token-check-disable-line: data-driven slice color from COST_COLORS -->
                  <span class="truncate text-ink-secondary">{{ slice.label }}</span>
                </span>
                <span class="shrink-0 tabular-nums font-medium text-ink">
                  {{ fmtMoney(slice.value) }} <span class="font-normal text-ink-subtle">· {{ slice.pct }}%</span>
                </span>
              </li>
            </ul>
          </div>
          <table class="sr-only">
            <caption>Fuel cost composition</caption>
            <thead><tr><th scope="col">Category</th><th scope="col">Cost</th><th scope="col">Share</th></tr></thead>
            <tbody>
              <tr v-for="slice in costSlices" :key="slice.label">
                <th scope="row">{{ slice.label }}</th>
                <td>{{ fmtMoney(slice.value) }}</td>
                <td>{{ slice.pct }}%</td>
              </tr>
            </tbody>
          </table>
        </ChartCard>

        <SeverityBreakdown :severity="s?.anomaliesBySeverity ?? { low: 0, medium: 0, high: 0, critical: 0 }" />
      </div>

      <!-- Risk lists -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RiskList title="Top vehicles by risk" :rows="s?.topVehiclesByRisk ?? []" link-base="/vehicles" empty-label="No flagged vehicles" />
        <RiskList title="Top drivers by risk" :rows="s?.topDriversByRisk ?? []" empty-label="No flagged drivers" />
      </div>
    </div>
  </div>
</template>
