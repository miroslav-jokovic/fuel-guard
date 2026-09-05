<script setup lang="ts">
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  CsvIcon,
  CurrencyDollarIcon,
  FireIcon,
  GallonsIcon,
  GaugeIcon,
  InvoiceIcon,
  PdfIcon,
  RadarIcon,
  ReeferTruckIcon,
  RejectionIcon,
  RoadIcon,
  ShieldExclamationIcon,
} from "@silvicom/ui/icons";
import { ref, computed } from "vue";
import { RouterLink } from "vue-router";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/vue";
import type { ChartConfiguration } from "chart.js";
import { useDashboard } from "@/features/dashboard/useDashboard";
import { useFuelRangeTotals, type FuelFilters } from "@/features/fuel/useFuelLog";
import { useFleetMpgSeries } from "@/features/fuel/useFleetMpg";
import { useSessionStore } from "@/stores/session";
import { downloadReport } from "@/features/reports/download";
import { useToastStore } from "@/stores/toast";
import BaseChart from "@/components/BaseChart.vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import StatCard from "@/components/ui/StatCard.vue";
import ChartCard from "@/features/dashboard/ChartCard.vue";
import DonutBreakdown from "@/features/dashboard/DonutBreakdown.vue";
import SeverityBreakdown from "@/features/dashboard/SeverityBreakdown.vue";
import RiskList from "@/features/dashboard/RiskList.vue";
import { viz, COST_COLORS, areaFill, trendOptions, fmtDay, fmtMoney, fmtCompact } from "@/lib/chartTheme";

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

// ── Fueling summary (same window; reuses the Fuel Log's range-aware totals so the two pages agree) ──
const fuelRange = computed<FuelFilters>(() => ({
  // Same UTC bounds useDashboard uses, so the fill count + miles cover exactly the fills that back the
  // spend/gallons/MPG numbers taken from the dashboard summary (`s`) — the whole row stays consistent.
  from: new Date(`${range.value.from}T00:00:00`).toISOString(),
  to: new Date(`${range.value.to}T23:59:59.999`).toISOString(),
}));
const { data: fuelTotals, isLoading: fuelLoading } = useFuelRangeTotals(fuelRange);

/**
 * Fleet MPG and its trend, from the one place that computes them (M4, D-MPG1/D-MPG6).
 *
 * This page used to derive both from the fills it had already fetched — one of four copies of a
 * definition whose numerator ran 1.31–2.41% below Samsara's own IFTA miles, and the reason this tile
 * and the Spend trend tab disagreed by 10.7% for the same week. The numerator is now the difference
 * between two odometer readings the vendor asserted, which the browser cannot see.
 *
 * WEEKLY, not daily. A day's fuel purchases are not that day's consumption: 1–3 September 2026 read
 * 7.46, 6.90 and 6.38 over almost identical distances, because the fleet filled more tanks on the
 * third. The old daily line looked smooth only because its miles and its gallons had been spread
 * across the same interval together, which hid that swing rather than avoiding it.
 */
const { data: fleetMpg } = useFleetMpgSeries(computed(() => ({ ...range.value, grain: "week" as const })));
/** The window's own figure — NOT the mean of the weeks below it. */
const mpgTotal = computed(() => fleetMpg.value?.total ?? null);
const mpgWeeks = computed(() => fleetMpg.value?.periods ?? []);
/**
 * What the number is standing on, in the space a tile has. `null` mpg carries the service's own
 * `reason`, which is a sentence a fleet manager can act on — a bare dash sends them looking for a bug.
 */
const mpgSub = computed(() => {
  const t = mpgTotal.value;
  if (t == null) return "measured miles ÷ fuel";
  if (t.mpg == null) return "not enough measured distance";
  return t.measuredShare == null ? "measured miles ÷ fuel" : `${Math.round(t.measuredShare * 100)}% of fuel measured`;
});
const mpgTitle = computed(() => mpgTotal.value?.reason ?? undefined);
const fmtInt = (nn: number) => Math.round(nn).toLocaleString("en-US");
const fuelingStats = computed(() => {
  const t = fuelTotals.value; // fill count + robust miles (not carried on the dashboard summary)
  const d = s.value;          // spend / gallons / MPG — same source as the hero tiles, so they always agree
  return [
    { label: "Fill-ups", value: t ? fmtInt(t.fillUps) : "—", sub: "in selected range", icon: InvoiceIcon, tone: "text-brand-600 bg-brand-50", to: "/fuel-log" },
    { label: "Gallons", value: d ? fmtInt(d.totalGallons) : "—", sub: "total fuel", icon: GallonsIcon, tone: "text-info-600 bg-info-50", to: "/fuel-log" },
    { label: "Miles driven", value: t ? fmtInt(t.totalMiles) : "—", sub: "odometer span in range", icon: RoadIcon, tone: "text-success-600 bg-success-50", to: "/fuel-log" },
    { label: "Fuel spend", value: d ? `$${fmtCompact(d.totalSpend)}` : "—", valueTitle: d ? fmtMoney(d.totalSpend) : undefined, sub: "total cost", icon: CurrencyDollarIcon, tone: "text-success-600 bg-success-50", to: "/fuel-log" },
    { label: "Avg MPG", value: mpgTotal.value?.mpg != null ? mpgTotal.value.mpg.toFixed(1) : "—", valueTitle: mpgTitle.value, sub: mpgSub.value, icon: GaugeIcon, tone: "text-brand-600 bg-brand-50", to: "/fuel-log" },
  ];
});

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
      value: mpgTotal.value?.mpg != null ? String(mpgTotal.value.mpg) : "—",
      valueTitle: mpgTitle.value,
      sub: mpgSub.value,
      icon: GaugeIcon,
      tone: "text-brand-600 bg-brand-50",
      // A weekly spark, because there is no honest daily point to draw (D-MPG6).
      spark: mpgWeeks.value.map((p) => p.mpg),
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
    icon: RadarIcon,
    tone: "text-info-600 bg-info-50",
    to: "/coverage",
  },
  {
    label: "Reefer fuel",
    value: s.value ? `$${fmtCompact(s.value.reeferSpend)}` : "—",
    valueTitle: s.value ? fmtMoney(s.value.reeferSpend) : undefined,
    sub: "refrigerated tank",
    icon: ReeferTruckIcon,
    tone: "text-info-600 bg-info-50",
    to: "/reefer-coverage",
  },
  {
    label: "Declined attempts",
    value: s.value ? String(s.value.declinedCount) : "—",
    sub: "blocked at the pump",
    icon: RejectionIcon,
    tone: (s.value?.declinedCount ?? 0) > 0 ? "text-caution-700 bg-caution-50" : "text-ink-muted bg-surface-muted",
    // FUEL-C2: the declines are a TAB of the Fuel Log now. `/rejections` still redirects here and
    // always will, but a tile in the product should name where the thing lives rather than lean on
    // the compatibility path the outside world's old links use.
    to: "/fuel-log?tab=declines",
  },
]);
const metricStrip = computed(() => [...fuelingStats.value, ...trust.value]);

// Spend is zero-filled/org-tz-bucketed upstream. A week the endpoint withheld renders as an honest
// GAP (spanGaps off) rather than as a zero — a fleet does not do 0 MPG.
const mpgChart = computed<ChartConfiguration>(() => ({
  type: "line",
  data: {
    labels: mpgWeeks.value.map((p) => p.from),
    datasets: [
      {
        label: "Fleet MPG",
        data: mpgWeeks.value.map((p) => p.mpg),
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
    { key: "moving", label: "Moving fuel", value: m, valueLabel: fmtMoney(m), pct: pct(m), color: COST_COLORS.moving },
    { key: "idle", label: "Idle waste", value: i, valueLabel: fmtMoney(i), pct: pct(i), color: COST_COLORS.idle },
    { key: "reefer", label: "Reefer", value: r, valueLabel: fmtMoney(r), pct: pct(r), color: COST_COLORS.reefer },
  ];
});
const costTotal = computed(() => costSlices.value.reduce((n, x) => n + x.value, 0));

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
  { label: "Transactions CSV", description: "Every fill in the selected range", icon: CsvIcon, run: () => exportReport("/api/reports/transactions.csv", "transactions.csv") },
  { label: "Summary PDF", description: "Executive summary of this dashboard", icon: PdfIcon, run: () => exportReport("/api/reports/summary.pdf", "summary.pdf") },
];
</script>

<template>
  <div class="space-y-6">
    <!-- Page header: context + the one filter row that scopes everything below -->
    <PageHeader title="Fleet overview">
      <template #default>
        <span class="flex items-center gap-1.5">
          Fuel, waste &amp; risk · {{ rangeLabel }}
          <AppIcon v-if="isFetching && !isLoading" :icon="ArrowPathIcon" class="size-3.5 animate-spin text-ink-tertiary" aria-hidden="true" />
        </span>
      </template>
      <template #actions>
      <div class="flex flex-wrap items-center gap-3">
        <DateRangeFilter v-model:from="from" v-model:to="to" />

        <Menu v-if="session.can('settings') || session.readOnly" as="div" class="relative">
          <MenuButton
            :disabled="exporting"
            class="inline-flex h-9 items-center gap-1.5 rounded-control bg-surface px-3 text-sm font-medium text-ink-secondary ring-1 ring-edge ring-inset transition hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-50"
          >
            <AppIcon :icon="ArrowDownTrayIcon" class="size-4" aria-hidden="true" />
            {{ exporting ? "Exporting…" : "Export" }}
            <AppIcon :icon="ChevronDownIcon" class="size-4 text-ink-tertiary" aria-hidden="true" />
          </MenuButton>
          <transition
            enter-active-class="transition duration-100 ease-out"
            enter-from-class="scale-95 opacity-0"
            enter-to-class="scale-100 opacity-100"
            leave-active-class="transition duration-75 ease-in"
            leave-from-class="scale-100 opacity-100"
            leave-to-class="scale-95 opacity-0"
          >
            <MenuItems class="absolute right-0 z-sticky-lead mt-2 w-64 origin-top-right overflow-hidden rounded-control bg-surface py-1 text-sm shadow-overlay focus:outline-none">
              <MenuItem v-for="exp in EXPORTS" :key="exp.label" v-slot="{ active }">
                <BaseButton
                  type="button"
                  variant="ghost"
                  block
                  :class="[
                    '!h-auto !justify-start !gap-3 !whitespace-normal !rounded-none !px-3 !py-2 !text-left !font-normal',
                    active ? 'bg-surface-subtle' : '',
                  ]"
                  @click="exp.run()"
                >
                  <AppIcon :icon="exp.icon" class="mt-0.5 size-5 shrink-0 text-ink-tertiary" aria-hidden="true" />
                  <span class="min-w-0">
                    <span class="block font-medium text-ink">{{ exp.label }}</span>
                    <span class="mt-0.5 block text-xs leading-4 text-ink-muted">{{ exp.description }}</span>
                  </span>
                </BaseButton>
              </MenuItem>
            </MenuItems>
          </transition>
        </Menu>
      </div>
      </template>
    </PageHeader>

    <div class="space-y-6 transition-opacity duration-200" :class="isFetching && !isLoading ? 'opacity-60' : ''" :aria-busy="isFetching">
      <!-- KPI hero -->
      <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard v-for="stat in stats" :key="stat.label" v-bind="stat" size="hero" :loading="isLoading" />
      </dl>

      <!-- Secondary measures share one compact scan strip instead of competing hero cards. -->
      <BaseCard padding="none" as="section">
        <div class="border-b border-edge-subtle px-4 py-3">
          <h2 class="text-sm font-semibold text-ink">Operating metrics · {{ rangeLabel }}</h2>
        </div>
        <dl class="grid grid-cols-2 divide-x divide-y divide-edge-subtle sm:grid-cols-4 xl:grid-cols-8">
          <RouterLink
            v-for="stat in metricStrip"
            :key="stat.label"
            :to="stat.to"
            class="min-w-0 px-4 py-3 hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring"
          >
            <dt class="truncate text-xs font-medium text-ink-tertiary">{{ stat.label }}</dt>
            <dd class="mt-1 truncate text-lg font-semibold tabular-nums text-ink" :title="stat.valueTitle">
              {{ isLoading || fuelLoading ? "—" : stat.value }}
            </dd>
            <dd class="truncate text-xs text-ink-tertiary">{{ stat.sub }}</dd>
          </RouterLink>
        </dl>
      </BaseCard>

      <!-- Trends -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <template v-if="isLoading">
          <BaseCard v-for="i in 2" :key="i">
            <div class="h-4 w-32 animate-pulse rounded-control bg-surface-muted" />
            <div class="mt-4 h-60 animate-pulse rounded-surface bg-surface-subtle" />
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
          <ChartCard
            title="Fleet MPG trend"
            subtitle="Measured miles ÷ the fuel behind them · week beginning · gaps mean too little measured distance"
          >
            <BaseChart :config="mpgChart" :height="260" />
            <table class="sr-only">
              <caption>Fleet MPG by week</caption>
              <thead><tr><th scope="col">Week beginning</th><th scope="col">MPG</th></tr></thead>
              <tbody>
                <tr v-for="p in mpgWeeks" :key="p.from">
                  <th scope="row">{{ fmtDay(p.from) }}</th>
                  <td>{{ p.mpg ?? "no data" }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="mpgTotal?.reason" class="mt-3 text-xs text-ink-tertiary">{{ mpgTotal.reason }}</p>
          </ChartCard>
        </template>
      </div>

      <!-- Cost composition + severity -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Where fuel dollars go" subtitle="Moving fuel vs idle waste vs reefer · this range">
          <DonutBreakdown
            :items="costSlices"
            :center-value="`$${fmtCompact(costTotal)}`"
            center-label="total spend"
            :chart-label="`${fmtMoney(costTotal)} in fuel cost composition`"
          />
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
        <RiskList title="Top drivers by risk" :rows="s?.topDriversByRisk ?? []" link-base="/drivers" empty-label="No flagged drivers" />
      </div>
    </div>
  </div>
</template>
