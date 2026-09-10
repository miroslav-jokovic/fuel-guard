<script setup lang="ts">
import { computed } from "vue";
import FuelStatTile from "./FuelStatTile.vue";
import type { PlanResult } from "./useFuelPlan";

const props = defineProps<{ result: PlanResult }>();

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const plan = computed(() => props.result.plan);
const savingsTone = computed(() => (plan.value?.savingsVsNaive && plan.value.savingsVsNaive > 0 ? "success" : "ink"));
// The cost tile carries the discount beside it (D-FP5): what the same gallons would cost at the pump, and the
// difference. When a stop has no price the tile says so rather than showing a total that omits it.
const costHint = computed(() => {
  const p = plan.value;
  if (!p) return undefined;
  if (p.totalCost == null) return "a stop has no price";
  if (p.discountSavings != null && p.totalCostAtPump != null) return `${usd(p.totalCostAtPump)} at the pump · ${usd(p.discountSavings)} saved by your discount`;
  return "pump price unknown for a stop";
});
</script>

<template>
  <div v-if="plan" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <FuelStatTile label="Route" :value="result.route ? `${result.route.distanceMiles} mi` : '—'" :hint="`${plan.stops.length} stop${plan.stops.length === 1 ? '' : 's'}`" />
    <FuelStatTile label="Fuel to buy" :value="`${plan.totalGallons} gal`" :hint="plan.arrivalFuelPct != null ? `arrive ~${plan.arrivalFuelPct}%` : undefined" />
    <FuelStatTile label="Est. cost" :value="usd(plan.totalCost)" tone="brand" :hint="costHint" />
    <FuelStatTile label="Savings vs naive" :value="usd(plan.savingsVsNaive)" :tone="savingsTone" />
  </div>
</template>
