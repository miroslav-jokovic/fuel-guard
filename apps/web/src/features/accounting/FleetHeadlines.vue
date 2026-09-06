<script setup lang="ts">
import { computed } from "vue";
import StatCard from "@/components/ui/StatCard.vue";
import { MONEY_COLORS } from "@/lib/chartTheme";
import { changeTone, formatPercentChange, percentChange } from "@/lib/periodChange";
import { monthKey, shiftMonth, type ReportPeriod } from "@/lib/reportPeriod";
import { monthName } from "./fleetProvenance";
import type { FleetReportResponse } from "./useFleetReport";
import type { FleetTrendPoint, FleetTrendResponse } from "./useFleetTrend";

/**
 * The four headlines (R3, D-FRUI3): kept, earned, spent, and kept per mile — each with the change
 * against the previous month, the year to date, and an eight-month sparkline. Kept leads because it
 * is the question the page is opened with.
 *
 * Every figure is the harness's (`computeFleetReport`, `computeFleetTrend`). What this component
 * adds is the neighbour: the previous month is the trend point one month before the period's end,
 * and the change is `percentChange` over two harness figures — presentation, like a share of
 * revenue, never a new source. A comparison is offered for a MONTH period only. A quarter or a year
 * to date would need the previous quarter or year summed from trend points, and summing months on
 * the page is arithmetic the harness does not expose; those grains show the year to date and no
 * change, and say so, rather than a number nobody can check.
 *
 * A null rate prints a dash with the coverage reason (D-FIN10) — never $0.00, which is a plausible
 * number and a wrong one.
 */

const props = defineProps<{
  report: FleetReportResponse;
  trend: FleetTrendResponse | null;
  period: ReportPeriod;
  loading?: boolean;
}>();

const fmtUsd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtRate = (n: number | null) =>
  n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 });

const endKey = computed(() => monthKey(props.period.to));
const previousKey = computed(() => shiftMonth(endKey.value, -1));
const previous = computed<FleetTrendPoint | null>(() =>
  props.period.grain === "month" ? (props.trend?.points.find((p) => p.month === previousKey.value) ?? null) : null,
);
const previousName = computed(() => monthName(previousKey.value).split(" ")[0] ?? previousKey.value);

/** The eight trend months up to the period's end, oldest first; a month without a rate is a gap. */
const trail = (pick: (p: FleetTrendPoint) => number | null): (number | null)[] =>
  (props.trend?.points ?? []).filter((p) => p.month <= endKey.value).slice(-8).map(pick);

interface Line {
  text: string;
  tone: string;
}

/** "−47.7% vs June" / "no previous month" / "no change against a quarter" — whichever is true. */
function change(pick: (p: { revenue: number; expenses: number; net: number }) => number, current: number, upIsGood: boolean): Line {
  if (props.period.grain !== "month") return { text: `${props.period.grain === "quarter" ? "quarter" : props.period.grain === "ytd" ? "year to date" : "custom range"} — no month-on-month change`, tone: "text-ink-tertiary" };
  if (!previous.value) return { text: "no previous month to compare", tone: "text-ink-tertiary" };
  const pc = percentChange(pick(previous.value), current);
  if (pc == null) return { text: `no comparison with ${previousName.value}`, tone: "text-ink-tertiary" };
  return { text: `${formatPercentChange(pc)} vs ${previousName.value} ${fmtUsd(pick(previous.value))}`, tone: changeTone(pc, upIsGood) };
}

const toDate = (n: number | null) => (n == null ? null : `${fmtUsd(n)} year to date`);

const kept = computed(() => ({
  change: change((p) => p.net, props.report.total.net, true),
  toDate: toDate(props.report.statement.toDateNet),
  spark: trail((p) => p.net),
}));
const earned = computed(() => ({
  change: change((p) => p.revenue, props.report.total.revenue, true),
  toDate: toDate(props.report.statement.toDateRevenue),
  spark: trail((p) => p.revenue),
}));
const spent = computed(() => ({
  change: change((p) => p.expenses, props.report.total.expenses, false),
  toDate: toDate(props.report.statement.toDateExpenses),
  spark: trail((p) => p.expenses),
}));

/** Kept per mile: the rate, its change in dollars (a rate's percentage change misleads), the reason when absent. */
const keptPerMile = computed(() => {
  const rate = props.report.total.netPerMile;
  const prev = previous.value?.netPerMile ?? null;
  let change: Line;
  if (rate == null) change = { text: props.report.mileageReason ?? "per-mile figure not available for this period", tone: "text-warning-700" };
  else if (props.period.grain !== "month") change = { text: `earned ${fmtRate(props.report.total.revenuePerMile)} − spent ${fmtRate(props.report.total.costPerMile)}, per mile driven`, tone: "text-ink-tertiary" };
  else if (prev == null) change = { text: `${previousName.value} has no rate to compare`, tone: "text-ink-tertiary" };
  else {
    const diff = rate - prev;
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
    change = { text: `${sign}${fmtRate(Math.abs(diff))} vs ${previousName.value} ${fmtRate(prev)}`, tone: changeTone(diff, true) };
  }
  return { value: fmtRate(rate), change, spark: trail((p) => p.netPerMile) };
});

const perMile = (rate: number | null, verb: string) => (rate == null ? null : `${fmtRate(rate)} ${verb} per mile driven`);
</script>

<template>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <!-- Two lines under each figure: the change in its own tone, then the neighbour in grey. They
         are nested block spans rather than siblings because the tile's sub line is a flex row, and
         two sibling spans there wrap into two ragged columns. -->
    <StatCard label="Kept" :value="fmtUsd(report.total.net)" size="hero" :spark="kept.spark" :spark-color="MONEY_COLORS.kept" :loading="loading">
      <template #sub>
        <span>
          <span :class="['block', kept.change.tone]">{{ kept.change.text }}</span>
          <span v-if="kept.toDate" class="block text-ink-tertiary">{{ kept.toDate }}</span>
        </span>
      </template>
    </StatCard>
    <StatCard label="Earned" :value="fmtUsd(report.total.revenue)" size="hero" :spark="earned.spark" :spark-color="MONEY_COLORS.earned" :loading="loading">
      <template #sub>
        <span>
          <span :class="['block', earned.change.tone]">{{ earned.change.text }}</span>
          <span class="block text-ink-tertiary">{{ perMile(report.total.revenuePerMile, "earned") ?? earned.toDate ?? "" }}</span>
        </span>
      </template>
    </StatCard>
    <StatCard label="Spent" :value="fmtUsd(report.total.expenses)" size="hero" :spark="spent.spark" :spark-color="MONEY_COLORS.spent" :loading="loading">
      <template #sub>
        <span>
          <span :class="['block', spent.change.tone]">{{ spent.change.text }}</span>
          <span class="block text-ink-tertiary">{{ perMile(report.total.costPerMile, "spent") ?? spent.toDate ?? "" }}</span>
        </span>
      </template>
    </StatCard>
    <StatCard label="Kept per mile driven" :value="keptPerMile.value" size="hero" :spark="keptPerMile.spark" :spark-color="MONEY_COLORS.kept" :loading="loading">
      <template #sub>
        <span>
          <span :class="['block', keptPerMile.change.tone]">{{ keptPerMile.change.text }}</span>
          <span class="block text-ink-tertiary">{{ keptPerMile.value === "—" ? "" : `earned ${fmtRate(report.total.revenuePerMile)} − spent ${fmtRate(report.total.costPerMile)}` }}</span>
        </span>
      </template>
    </StatCard>
  </div>
</template>
