<script setup lang="ts">
/**
 * What did fuel cost — the number, its movement, its days, and where the dollars went, in ONE card
 * (D-FO1, D-FO2, D-FO3; Q-FO2 ruled (a)).
 *
 * This replaces four cards that each drew the same total: the hero tile, the operating-metrics
 * tile, the spend-trend readout and the donut centre. The figure appears here once, the daily bars
 * sit under it with the PREVIOUS period's bars as a grey ghost behind each day (the comparison is
 * the chart), and the composition is a share bar rather than a ring.
 *
 * ── WITHOUT `accounting` THIS CARD IS ABOUT GALLONS ──────────────────────────────────────────────
 * The widget is gated `fuel`, like the tab, so a `fleet_manager` keeps it (Q-LM-F1). For them the
 * readout is gallons with its own pill, the bars are not drawn — `spendTrend` is dollars and there
 * is no daily gallons series to draw honestly — and the composition shows shares alone. Every
 * dollar figure, hover titles included, is behind `canSeeMoney`, and `dashboardEquivalence.test.ts`
 * proves it with
 * "shows a caller without accounting no currency figure anywhere on the tab".
 */
import { computed, ref } from "vue";
import type { ChartConfiguration } from "chart.js";
import { CurrencyDollarIcon, GallonsIcon } from "@silvicom/ui/icons";
import { AppDelta } from "@silvicom/ui";
import { deltaLabel, deltaTone, type PeriodDelta } from "@silvicom/shared";
import BaseChart from "@/components/BaseChart.vue";
import ChartCard from "@/components/ui/ChartCard.vue";
import ShareBar from "../ShareBar.vue";
import DoorLink from "@/components/ui/DoorLink.vue";
import { useFleetWidgetData, fmtInt, type FleetRange } from "../fleetWidgetData";
import { viz, BAR_GEOMETRY, COST_COLORS, trendOptions, fmtDay, fmtMoney, fmtCompact, resolve } from "@/lib/chartTheme";

const props = defineProps<{ range: FleetRange }>();
const { s, previous, canSeeMoney, deltas, previousLabel, previousPhrase, rangeLabel } = useFleetWidgetData(computed(() => props.range));

const pill = (d: PeriodDelta | null, upIsGood: boolean) =>
  d ? { direction: d.direction, tone: deltaTone(d, upIsGood), label: deltaLabel(d), against: previousLabel.value } : null;

const points = computed(() => s.value?.spendTrend ?? []);
const ghost = computed(() => previous.value?.spendTrend ?? []);
const total = computed(() => points.value.reduce((n, p) => n + (p.value ?? 0), 0));

/** The day under the pointer (D-DT11), else the window's own total. */
const scrub = ref<{ label: string; value: number } | null>(null);

const readout = computed(() => {
  if (!canSeeMoney.value) return s.value ? `${fmtInt(s.value.totalGallons)} gal` : "—";
  if (scrub.value) return fmtMoney(scrub.value.value);
  return s.value ? fmtMoney(total.value) : "—";
});
const delta = computed(() => (canSeeMoney.value ? pill(deltas.value.spend, false) : pill(deltas.value.gallons, false)));
const caption = computed(() => {
  if (scrub.value) return fmtDay(scrub.value.label);
  if (!delta.value) return rangeLabel.value;
  const prev = canSeeMoney.value
    ? previous.value ? fmtMoney(previous.value.totalSpend) : null
    : previous.value ? `${fmtInt(previous.value.totalGallons)} gal` : null;
  return prev ? `vs ${previousPhrase.value} · ${prev}` : `vs ${previousPhrase.value}`;
});

/**
 * Bars, not a line (DR3): `spendTrend` is a discrete daily total, zero-filled, so a bar loses
 * nothing. The ghost is a second dataset drawn BEHIND (`order: 2` draws first) and not grouped, so
 * the two bars share one x rather than standing side by side; `onScrub` reads `elements[0]`, which
 * is this period's bar because it is dataset 0.
 */
const chart = computed<ChartConfiguration>(() => ({
  type: "bar",
  data: {
    labels: points.value.map((p) => p.date),
    datasets: [
      {
        label: "This period", data: points.value.map((p) => p.value), order: 1,
        backgroundColor: viz.spend, hoverBackgroundColor: viz.spendHover, ...BAR_GEOMETRY, barPercentage: 0.6,
      },
      {
        label: "Previous period, same day", data: ghost.value.map((p) => p.value), order: 2, grouped: false,
        backgroundColor: resolve("--ramp-neutral-200"), hoverBackgroundColor: resolve("--ramp-neutral-200"), ...BAR_GEOMETRY,
      },
    ],
  },
  options: trendOptions({
    series: "Spend",
    format: (v) => fmtMoney(v),
    dataMax: Math.max(0, ...points.value.map((p) => p.value ?? 0), ...ghost.value.map((p) => p.value ?? 0)),
    onScrub: (p) => { scrub.value = p; },
  }),
}));

const slices = computed(() => {
  const m = s.value?.movingSpend ?? 0, i = s.value?.idleCostUsd ?? 0, r = s.value?.reeferSpend ?? 0;
  const label = (v: number) => (canSeeMoney.value ? `$${fmtCompact(v)}` : "");
  return [
    { key: "moving", label: "Moving", value: m, valueLabel: label(m), color: COST_COLORS.moving },
    { key: "idle", label: "Idle", value: i, valueLabel: label(i), color: COST_COLORS.idle },
    { key: "reefer", label: "Reefer", value: r, valueLabel: label(r), color: COST_COLORS.reefer },
  ];
});
</script>

<template>
  <ChartCard
    :title="canSeeMoney ? 'Fuel spend' : 'Fuel bought'"
    :subtitle="canSeeMoney ? 'Daily total across the fleet · tractor and reefer' : 'Gallons across the fleet · tractor and reefer'"
    :icon="canSeeMoney ? CurrencyDollarIcon : GallonsIcon"
    tone="success"
    :readout="readout"
    :caption="caption"
    class="h-full"
  >
    <!-- The fills live on the Fuel log (FUEL-C2); `/transactions` is a compatibility redirect and a
         door should name where the thing is. -->
    <template #meta><DoorLink to="/fuel-log?tab=fills">Fuel log</DoorLink></template>
    <template #beside-readout><AppDelta v-if="delta" v-bind="delta" /></template>

    <template v-if="canSeeMoney">
      <BaseChart :config="chart" :height="200" />
      <ul class="mt-1.5 flex gap-4 text-2xs text-ink-tertiary" aria-hidden="true">
        <li class="flex items-center gap-1.5"><span class="size-2 rounded-detail" :style="{ backgroundColor: viz.spend }" /> This period</li> <!-- token-check-disable-line: token-resolved chart color -->
        <li class="flex items-center gap-1.5"><span class="size-2 rounded-detail bg-surface-muted" /> Previous period, same day</li>
      </ul>
      <table class="sr-only">
        <caption>Fuel spend by day, this period and the same day of the previous period</caption>
        <thead><tr><th scope="col">Day</th><th scope="col">Spend</th><th scope="col">Previous period</th></tr></thead>
        <tbody>
          <tr v-for="(p, i) in points" :key="p.date">
            <th scope="row">{{ fmtDay(p.date) }}</th>
            <td>{{ p.value == null ? "no data" : fmtMoney(p.value) }}</td>
            <td>{{ ghost[i]?.value == null ? "no data" : fmtMoney(ghost[i]!.value!) }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <ShareBar class="mt-4" :items="slices" :name="canSeeMoney ? 'Where fuel dollars go' : 'Where fuel goes'" />
  </ChartCard>
</template>
