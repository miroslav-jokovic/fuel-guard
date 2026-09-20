<script setup lang="ts">
/**
 * Fleet MPG by week (D-MPG6).
 *
 * WEEKLY, not daily, and that is a measurement decision rather than a rendering one: a day's fuel
 * purchases are not that day's consumption. 1–3 September 2026 read 7.46, 6.90 and 6.38 over almost
 * identical distances, because the fleet filled more tanks on the third. The old daily line looked
 * smooth only because its miles and gallons had been spread across the same interval together.
 */
import { computed, ref } from "vue";
import type { ChartConfiguration } from "chart.js";
import { GaugeIcon } from "@silvicom/ui/icons";
import BaseChart from "@/components/BaseChart.vue";
import ChartCard from "../ChartCard.vue";
import { useFleetWidgetData, type FleetRange } from "../fleetWidgetData";
import { viz, areaFill, lastPointRadius, trendOptions, fmtDay } from "@/lib/chartTheme";

const props = defineProps<{ range: FleetRange }>();
const { mpgWeeks, mpgTotal, mpgSub } = useFleetWidgetData(computed(() => props.range));

/** The week under the pointer (D-DT11), formatted as this card's own series: MPG, week beginning. */
const scrub = ref<{ label: string; value: number } | null>(null);

/**
 * At rest the readout is the WINDOW's own MPG, not the mean of the weeks under it — D-MPG6, and the
 * same figure the hero tile carries. `mpgTotal` can be null with weeks still drawn (too little
 * measured distance over the window as a whole), and a dash is the honest answer there.
 */
const readout = computed(() => {
  if (scrub.value) return `${scrub.value.value} MPG`;
  return mpgTotal.value?.mpg != null ? `${mpgTotal.value.mpg} MPG` : "—";
});
const caption = computed(() => (scrub.value ? `week of ${fmtDay(scrub.value.label)}` : mpgSub.value));

// A week the endpoint withheld renders as an honest GAP (`spanGaps: false`) rather than as a zero —
// a fleet does not do 0 MPG.
const mpgChart = computed<ChartConfiguration>(() => ({
  type: "line",
  data: {
    labels: mpgWeeks.value.map((p) => p.from),
    datasets: [{
      label: "Fleet MPG",
      data: mpgWeeks.value.map((p) => p.mpg),
      borderColor: viz.brand,
      backgroundColor: areaFill("--viz-brand") as unknown as string,
      fill: true, tension: 0.4, spanGaps: false, borderWidth: 2.5,
      borderCapStyle: "round", borderJoinStyle: "round",
      // DR3: a dot on the LAST week, where the current figure is read — the treatment
      // `FleetTrendChart` already uses, now shared rather than transcribed. Still no dots along the
      // line: comp (3) has none either, which took counting pixels to see (`lastPointRadius`).
      pointRadius: lastPointRadius(mpgWeeks.value.length - 1),
      pointBackgroundColor: viz.brand, pointBorderColor: viz.pointHalo, pointBorderWidth: 2,
      pointHitRadius: 12, pointHoverRadius: 5,
      pointHoverBackgroundColor: viz.brand, pointHoverBorderColor: viz.pointHalo, pointHoverBorderWidth: 2,
    }],
  },
  options: trendOptions({
    series: "Fleet MPG",
    format: (v) => `${v} MPG`,
    tickFormat: (v) => String(v),
    // ⚠ No `dataMax`: this scale does not begin at zero (a fleet's MPG lives in a 2-wide band and a
    // 0-based axis flattens it), and `niceScale` is a ladder anchored at zero. `trendOptions`
    // ignores it under `beginAtZero: false` anyway; not passing it says so at the call site.
    beginAtZero: false,
    onScrub: (p) => { scrub.value = p; },
  }),
}));
</script>

<template>
  <ChartCard
    title="Fleet MPG trend"
    subtitle="Measured miles ÷ the fuel behind them · week beginning · gaps mean too little measured distance"
    :icon="GaugeIcon"
    tone="brand"
    :readout="readout"
    :caption="caption"
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
