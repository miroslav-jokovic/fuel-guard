<script setup lang="ts">
/**
 * Where every fuel dollar goes — moving fuel vs idle waste vs reefer.
 *
 * ⚠ Gated `accounting`, and like the spend trend it was NOT gated before 2026-09-15. It is the
 * larger of the two leaks the LM9 harness found: every slice is dollars and so is the centre total,
 * and its own title said so while the gate above it said the opposite.
 */
import { computed } from "vue";
import { ChartBarSquareIcon } from "@silvicom/ui/icons";
import ChartCard from "../ChartCard.vue";
import DonutBreakdown from "../DonutBreakdown.vue";
import { useFleetWidgetData, type FleetRange } from "../fleetWidgetData";
import { COST_COLORS, fmtMoney, fmtCompact } from "@/lib/chartTheme";

const props = defineProps<{ range: FleetRange }>();
const { s } = useFleetWidgetData(computed(() => props.range));

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
  <ChartCard
    title="Where fuel dollars go"
    subtitle="Moving fuel vs idle waste vs reefer · this range"
    :icon="ChartBarSquareIcon"
    tone="info"
  >
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
</template>
