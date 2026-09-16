<script setup lang="ts">
/**
 * The fleet overview — the Dashboard tab an admin, a fleet manager and an accountant land on.
 *
 * Extracted from `DashboardPage.vue` by LM-T (D-DW6). The page is now a tab shell that decides WHICH
 * dashboard a caller gets from their section grants; this file is one of them, and the split is what
 * let the page stop being 501 lines of every role's dashboard at once.
 *
 * ⚠ **Its data sources were PROMOTED out of `features/fuel/` to get here, and that was the ruled
 * fix rather than my first choice.** `lint:boundaries` refuses one feature reaching into another's
 * internals, and this tab needs fuel totals, fleet MPG, findings and the dashboard's fuel links. Two
 * wrong answers were tried first: putting this file under `pages/` (which `lint:ui-adoption` rejects,
 * because everything under `pages/` is a ROUTED page and must carry a `PageHeader`), and the gate's
 * own ALLOW list — which `check-feature-boundaries.mjs` keeps deliberately EMPTY for web, with a
 * comment recording that the intended fix for every entry that tries to land there is to promote the
 * shared thing out of `features/`, not to allow-list the leak. So the four modules now live in
 * `@/composables/`, which is where `apps/web/CLAUDE.md` says shared code goes. `dashboardFuelLinks`
 * was the tell: it was named for this screen and used only by it, while living in the fuel feature.
 *
 * ⚠ Every currency figure on this tab passes through `applyMoneyGate` against
 * `session.canView("accounting")`. The tab itself is gated on `fuel`, deliberately — `fleet_manager`
 * holds `accounting: none`, so gating the whole tab on money would take their own main screen away
 * from them. That per-element split is `Q-LM-F1`'s ruling; `moneyGate.ts` carries the reasoning.
 *
 * ⚠ And it is a PRODUCT boundary, not a security one: this tab reads PostgREST directly under RLS,
 * and `ftxn_select` has no section check, so a caller who wants `total_cost` can still ask the API
 * for it. Closing that is LM-F2.
 */
import { AppCard as BaseCard } from "@silvicom/ui";
import {
  CurrencyDollarIcon,
  FireIcon,
  GallonsIcon,
  GaugeIcon,
  InvoiceIcon,
  RadarIcon,
  ReeferTruckIcon,
  RejectionIcon,
  RoadIcon,
  ShieldExclamationIcon,
} from "@silvicom/ui/icons";
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { ChartConfiguration } from "chart.js";
import { useDashboard } from "@/features/dashboard/useDashboard";
import { useFuelRangeTotals, type FuelFilters } from "@/composables/useFuelLog";
import { useFleetMpgSeries } from "@/composables/useFleetMpg";
import { fuelTileDestinations } from "@/composables/dashboardFuelLinks";
import { useFindingsSummaryQuery, ledgerTiles } from "@/composables/useFindingsSummary";
import { useSessionStore } from "@/stores/session";
import { applyMoneyGate } from "@/features/dashboard/moneyGate";
import BaseChart from "@/components/BaseChart.vue";
import SamsaraFeedLine from "@/components/SamsaraFeedLine.vue";
import StatCard from "@/components/ui/StatCard.vue";
import ChartCard from "@/features/dashboard/ChartCard.vue";
import DonutBreakdown from "@/features/dashboard/DonutBreakdown.vue";
import SeverityBreakdown from "@/features/dashboard/SeverityBreakdown.vue";
import RiskList from "@/features/dashboard/RiskList.vue";
import { viz, COST_COLORS, areaFill, trendOptions, fmtDay, fmtMoney, fmtCompact } from "@/lib/chartTheme";

/** The window the page's filter picked. Owned by the shell so the filter can live in its header. */
const props = defineProps<{ range: { from: string; to: string } }>();
const range = computed(() => props.range);

const session = useSessionStore();
// `canView` and never `session.role`: going through the matrix is what makes an org's sparse section
// override (D-PERM4) work here without a code change.
const canSeeMoney = computed(() => session.canView("accounting"));

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
// C9's ledger half — what the checks found and what came back. Gated PER ROW by the API and not by
// this page (the 2026-09-06 ruling): the Dashboard has no section gate, so refusing one strip here
// would introduce a gate on a page that refuses nothing else. `ledgerTiles` carries the reasoning,
// including why a null hides a tile and a zero renders one.
const { data: findings } = useFindingsSummaryQuery();
const ledgerStats = computed(() =>
  ledgerTiles(
    findings.value,
    { open: InvoiceIcon, money: CurrencyDollarIcon },
    { int: fmtInt, compact: fmtCompact, money: fmtMoney },
  ),
);

const fuelingStats = computed(() => {
  const t = fuelTotals.value; // fill count + robust miles (not carried on the dashboard summary)
  const d = s.value;          // spend / gallons / MPG — same source as the hero tiles, so they always agree
  // Destinations and the window they carry live in `dashboardFuelLinks` — pure, and total over the
  // strip's labels, so a tile added here without a destination is a compiler error. See its header
  // for why each tile goes where it does, and why NOT /odometer.
  const to = fuelTileDestinations(range.value);
  return [
    { label: "Fill-ups", value: t ? fmtInt(t.fillUps) : "—", sub: "in selected range", icon: InvoiceIcon, tone: "text-brand-600 bg-brand-50", to: to["Fill-ups"] },
    { label: "Gallons", value: d ? fmtInt(d.totalGallons) : "—", sub: "total fuel", icon: GallonsIcon, tone: "text-info-600 bg-info-50", to: to.Gallons },
    { label: "Miles driven", value: t ? fmtInt(t.totalMiles) : "—", sub: "odometer span in range", icon: RoadIcon, tone: "text-success-600 bg-success-50", to: to["Miles driven"] },
    { label: "Fuel spend", money: true as const, value: d ? `$${fmtCompact(d.totalSpend)}` : "—", valueTitle: d ? fmtMoney(d.totalSpend) : undefined, sub: "total cost", icon: CurrencyDollarIcon, tone: "text-success-600 bg-success-50", to: to["Fuel spend"] },
    { label: "Avg MPG", value: mpgTotal.value?.mpg != null ? mpgTotal.value.mpg.toFixed(1) : "—", valueTitle: mpgTitle.value, sub: mpgSub.value, icon: GaugeIcon, tone: "text-brand-600 bg-brand-50", to: to["Avg MPG"] },
  ];
});

// Human label for the active window (matches the picker's "Jul 1 – Jul 13" style).
const labelDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const rangeLabel = computed(() => {
  const { from: f, to: t } = range.value;
  return f === t ? labelDay(f) : `${labelDay(f)} – ${labelDay(t)}`;
});

// KPI hero — the money + risk headline, each tile drilling into its detail page.
const statsRaw = computed(() => {
  const sev = s.value?.anomaliesBySeverity ?? { low: 0, medium: 0, high: 0, critical: 0 };
  const alerts = sev.critical + sev.high;
  return [
    {
      label: "Fuel spend",
      money: true as const,
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
      money: true as const,
      // The one money tile with an honest operational twin, so a caller without `accounting` keeps
      // the tile and the hours — the number a dispatcher can actually act on — and loses the dollars.
      withoutMoney: { value: s.value ? Math.round(s.value.idleHours).toLocaleString() : "—", sub: "idle hrs" },
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
    // D-SAM7. The big number is the window the reader picked; the subtitle is the whole history, and
    // the pair is the point. Over 90 days this reads ~95% and looks healthy; measured against the
    // carrier's entire history on 2026-09-01 it was 23%, because 76.8% of fills had never had
    // telematics fetched at all. Both figures were correct and showing only the first turned an
    // unanswered question into a reassuring answer — which is the failure this whole plan opens with.
    // When the all-time figure is unknown the tile says what it always said, rather than "0%".
    sub:
      s.value?.allTimeCoveragePct != null
        ? `${s.value.allTimeCoveragePct}% all time`
        : "fills corroborated",
    icon: RadarIcon,
    tone: "text-info-600 bg-info-50",
    to: "/coverage",
  },
  {
    label: "Reefer fuel",
    money: true as const,
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
/**
 * The five measured figures, then what the checks made of them, then the trust line.
 *
 * The ledger tiles sit AFTER the five and not among them, because they answer a different kind of
 * question: the first five are what the fleet did, and these two are what somebody still has to do
 * about it. They are also the only tiles here that can be absent for a caller (C9's per-row gate), so
 * keeping them at the end means the strip does not reflow around a hole for a driver.
 */
const metricStrip = computed(() =>
  applyMoneyGate([...fuelingStats.value, ...ledgerStats.value, ...trust.value], canSeeMoney.value),
);
/** The hero strip, minus any tile this caller may not see a dollar on (Q-LM-F1). */
const stats = computed(() => applyMoneyGate(statsRaw.value, canSeeMoney.value));

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
</script>

<template>
  <div class="space-y-6">
    <!-- SAM-S5: how current the telematics behind this page is, before its numbers are believed.
         The three tiers its tiles are built from — the coverage tile is telematics, idle waste is idle,
         and the theft figures read the live stats feed. IFTA and the roster tiers annotate their
         own pages instead; naming them here would report a breach nobody can act on from here. -->
    <SamsaraFeedLine :feeds="['stats', 'telematics', 'idle']" />

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
          <BaseCard v-for="i in (canSeeMoney ? 2 : 1)" :key="i">
            <div class="h-4 w-32 animate-pulse rounded-control bg-surface-muted" />
            <div class="mt-4 h-60 animate-pulse rounded-surface bg-surface-subtle" />
          </BaseCard>
        </template>
        <template v-else>
          <!-- LM-F, fixed 2026-09-15: gated, because it was not. This card is a currency figure per
               day across the whole range, and it rendered in full for a caller from whose tile strip
               the very same number had just been removed. -->
          <ChartCard v-if="canSeeMoney" title="Fuel spend" subtitle="Daily total across the fleet">
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
        <!-- Same fix, and the larger of the two leaks: every slice is dollars and so is the centre
             total. Its title said so out loud while the gate above it said the opposite. -->
        <ChartCard v-if="canSeeMoney" title="Where fuel dollars go" subtitle="Moving fuel vs idle waste vs reefer · this range">
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
