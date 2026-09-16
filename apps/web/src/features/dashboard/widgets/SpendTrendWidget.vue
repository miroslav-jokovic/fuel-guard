<script setup lang="ts">
/**
 * Fuel spend by day.
 *
 * ⚠ Gated `accounting` in `DASHBOARD_WIDGETS`, and it was NOT gated before 2026-09-15 — this card
 * rendered a currency figure per day to every caller on the tab, including the `fleet_manager` from
 * whose tile strip the very same number had already been correctly removed. Found by the LM9
 * equivalence harness. The gate is on the catalogue entry, not in here, so it is visible beside
 * every other gate rather than buried in a template.
 */
import { computed } from "vue";
import type { ChartConfiguration } from "chart.js";
import BaseChart from "@/components/BaseChart.vue";
import ChartCard from "../ChartCard.vue";
import { useFleetWidgetData, type FleetRange } from "../fleetWidgetData";
import { viz, areaFill, trendOptions, fmtDay, fmtMoney } from "@/lib/chartTheme";

const props = defineProps<{ range: FleetRange }>();
const { s } = useFleetWidgetData(computed(() => props.range));

// Zero-filled and org-tz-bucketed upstream; a withheld day is a gap, not a zero.
const spendChart = computed<ChartConfiguration>(() => ({
  type: "line",
  data: {
    labels: s.value?.spendTrend.map((p) => p.date) ?? [],
    datasets: [{
      label: "Spend",
      data: s.value?.spendTrend.map((p) => p.value) ?? [],
      borderColor: viz.spend,
      backgroundColor: areaFill("--viz-spend") as unknown as string,
      fill: true, tension: 0.4, spanGaps: false, borderWidth: 2.5,
      borderCapStyle: "round", borderJoinStyle: "round",
      pointRadius: 0, pointHitRadius: 12, pointHoverRadius: 4,
      pointHoverBackgroundColor: viz.spend, pointHoverBorderColor: viz.pointHalo, pointHoverBorderWidth: 2,
    }],
  },
  options: trendOptions({ series: "Spend", format: (v) => fmtMoney(v) }),
}));
</script>

<template>
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
