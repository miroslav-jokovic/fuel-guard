<script setup lang="ts">
import { computed } from "vue";
import type { ChartConfiguration } from "chart.js";
import { AppCard as BaseCard } from "@silvicom/ui";
import BaseChart from "@/components/BaseChart.vue";
import { MONEY_COLORS, trendOptions, fmtMonth, viz } from "@/lib/chartTheme";
import { useFleetTrendQuery, type FleetTrendPoint } from "./useFleetTrend";

/**
 * Twelve months of earned, spent and kept per mile (G9).
 *
 * **Why the overview carries a trend at all.** The tab above answers "what did this month cost per
 * mile"; nobody can act on that answer without knowing whether it is where the fleet has been
 * sitting or where it has just moved to. $2.61 spent per mile is good news after four months at
 * $2.80 and bad news after four at $2.45, and the same figure is on the screen either way.
 *
 * **Two refusals it inherits from the harness, and neither is cosmetic:**
 *
 *  · A month whose mileage coverage was short of its fleet has NO rate, so the line breaks over it.
 *    Drawing through the gap would invent a shape out of a denominator that was missing eleven per
 *    cent of the trucks — a rate that reads low on miles and high on cost, and looks entirely
 *    plausible.
 *  · A month the McLeod sweep has not reached is not plotted at zero. It is named under the chart,
 *    because a chart is read faster than the footnote below it and a drop to the axis is the most
 *    alarming shape a finance page can draw.
 *
 * Nothing is computed here. Every figure comes from `computeFleetTrend`, which is where the
 * arithmetic is tested — the template only chooses colours and words.
 */

const props = withDefaults(defineProps<{ to: string; months?: number }>(), { months: 12 });

const to = computed(() => props.to);
const months = computed(() => props.months);
const { data, isLoading, isError } = useFleetTrendQuery(to, months);

const points = computed<FleetTrendPoint[]>(() => data.value?.points ?? []);
/** Months carrying a rate. With none, there is no line to draw and the reasons are the answer. */
const rated = computed(() => data.value?.rated ?? 0);

const SERIES = [
  { label: "Earned per mile", pick: (p: FleetTrendPoint) => p.revenuePerMile, color: () => MONEY_COLORS.earned },
  { label: "Spent per mile", pick: (p: FleetTrendPoint) => p.costPerMile, color: () => MONEY_COLORS.spent },
  { label: "Kept per mile", pick: (p: FleetTrendPoint) => p.netPerMile, color: () => MONEY_COLORS.kept },
];

const config = computed<ChartConfiguration>(() => ({
  type: "line",
  data: {
    labels: points.value.map((p) => p.month),
    datasets: SERIES.map((s) => ({
      label: s.label,
      data: points.value.map(s.pick),
      borderColor: s.color(),
      backgroundColor: s.color(),
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 4,
      pointHoverBorderColor: viz.pointHalo,
      tension: 0.25,
      // A month without a rate is a hole in the line, not a straight run between its neighbours.
      spanGaps: false,
    })),
  },
  // `series` is deliberately omitted: three lines name themselves, in a legend and in the index
  // tooltip that lists all three at once. The axis stays anchored at zero because the lines sit
  // within a dollar or two of each other, and a floating axis would magnify an ordinary month of
  // noise into a cliff — the gap between earned and spent is the height a reader acts on.
  options: trendOptions({ format: (v) => `$${v.toFixed(2)}`, labelFormat: fmtMonth, beginAtZero: true }),
}));

/**
 * Why a month has no rate, in the coverage rule's own words, once per distinct reason. The reason
 * names its own month, so nothing here restates which months are affected.
 */
const gaps = computed(() => [...new Set(points.value.filter((p) => p.reason).map((p) => p.reason!))]);
const missing = computed(() => data.value?.missing ?? []);
const span = computed(() => {
  const p = points.value;
  return p.length ? `${fmtMonth(p[0]!.month)} – ${fmtMonth(p[p.length - 1]!.month)}` : "";
});
</script>

<template>
  <BaseCard>
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="text-sm font-semibold text-ink">Earned, spent and kept per mile, month by month</h3>
      <p v-if="span" class="text-xs text-ink-tertiary">{{ span }}</p>
    </div>
    <p class="mt-1 text-sm text-ink-secondary">
      From McLeod's ledger, over the miles Samsara measured. A month is left blank when its
      mileage did not cover the whole fleet.
    </p>

    <p v-if="isError" class="mt-4 text-sm text-danger-600">
      The trend could not be loaded. Try the period again in a moment.
    </p>
    <p v-else-if="isLoading" class="mt-4 text-sm text-ink-secondary">Loading the trend…</p>
    <p v-else-if="rated === 0" class="mt-4 text-sm text-ink-secondary">
      No month in this span has mileage covering the whole fleet, so there is no rate to plot yet.
    </p>
    <BaseChart v-else :config="config" :height="260" class="mt-4" />

    <p v-for="reason in gaps" :key="reason" class="mt-2 text-xs text-ink-tertiary">{{ reason }}</p>
    <p v-if="missing.length" class="mt-2 text-xs text-ink-tertiary">
      The McLeod sweep has not reached {{ missing.join(", ") }}, so
      {{ missing.length === 1 ? "that month is" : "those months are" }} not on the chart at all.
    </p>
  </BaseCard>
</template>
