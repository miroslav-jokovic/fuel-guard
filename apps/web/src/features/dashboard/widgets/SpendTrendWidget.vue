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
import { viz, BAR_GEOMETRY, trendOptions, fmtDay, fmtMoney } from "@/lib/chartTheme";

const props = defineProps<{ range: FleetRange }>();
const { s } = useFleetWidgetData(computed(() => props.range));

/**
 * ── BARS, NOT A LINE (DR3) ───────────────────────────────────────────────────────────────────────
 * Both dashboard comps draw this card as bars, and the data agrees with them: `spendTrend` is a
 * DISCRETE daily total, and `dashboard.ts` zero-fills it — `round2(spendByDay.get(date) ?? 0)`,
 * commented "a no-spend day is a real $0 day". So every point is a real number, the series can
 * never contain a null, and a line's implication that Tuesday flows into Wednesday was never true
 * of it. `spanGaps: false` was doing nothing here; it stays on the MPG card, where the nulls are.
 *
 * That zero-fill is also why bars lose nothing. A bar chart cannot tell "no data" from "zero" — both
 * draw no bar — which would be a real objection on a series that could be withheld, and is not one
 * on a series that cannot.
 */
const spendChart = computed<ChartConfiguration>(() => ({
  type: "bar",
  data: {
    labels: s.value?.spendTrend.map((p) => p.date) ?? [],
    datasets: [{
      label: "Spend",
      data: s.value?.spendTrend.map((p) => p.value) ?? [],
      backgroundColor: viz.spend,
      // The palette's own hover step, rather than an alpha invented here. ⚠ The comps draw these
      // bars VIOLET, like everything else on the page, and that is the generator being a generator:
      // `--viz-spend` is emerald because the visualisation palette is a validated set rather than
      // brand decoration, and DR1 already paid for that lesson when rotating `--viz-cost-reefer`
      // failed `lint:chart-colors`.
      hoverBackgroundColor: viz.spendHover,
      ...BAR_GEOMETRY,
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
