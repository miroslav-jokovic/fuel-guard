<script setup lang="ts">
/**
 * Fleet MPG by week (D-MPG6).
 *
 * WEEKLY, not daily, and that is a measurement decision rather than a rendering one: a day's fuel
 * purchases are not that day's consumption. 1–3 September 2026 read 7.46, 6.90 and 6.38 over almost
 * identical distances, because the fleet filled more tanks on the third. The old daily line looked
 * smooth only because its miles and gallons had been spread across the same interval together.
 */
import { computed } from "vue";
import type { ChartConfiguration } from "chart.js";
import BaseChart from "@/components/BaseChart.vue";
import ChartCard from "../ChartCard.vue";
import { useFleetWidgetData, type FleetRange } from "../fleetWidgetData";
import { viz, areaFill, trendOptions, fmtDay } from "@/lib/chartTheme";

const props = defineProps<{ range: FleetRange }>();
const { mpgWeeks, mpgTotal } = useFleetWidgetData(computed(() => props.range));

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
      pointRadius: 0, pointHitRadius: 12, pointHoverRadius: 4,
      pointHoverBackgroundColor: viz.brand, pointHoverBorderColor: viz.pointHalo, pointHoverBorderWidth: 2,
    }],
  },
  options: trendOptions({ series: "Fleet MPG", format: (v) => `${v} MPG`, tickFormat: (v) => String(v), beginAtZero: false }),
}));
</script>

<template>
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
