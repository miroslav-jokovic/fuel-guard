<script setup lang="ts">
import { computed } from "vue";
import StatCard from "@/components/ui/StatCard.vue";
import type { PlanResult } from "./useFuelPlan";

const props = defineProps<{ result: PlanResult }>();

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const plan = computed(() => props.result.plan);
// The cost tile carries the pump total beside it and the discount tile the difference (D-FP5). When a stop
// has no price the tile says so rather than showing a total that omits it. "Savings vs naive" — the same
// walk with a nearest-station picker — was retired (D-FP7): null on both plans production ever made.
const costHint = computed(() => {
  const p = plan.value;
  if (!p) return undefined;
  if (p.totalCost == null) return "a stop has no price";
  return p.totalCostAtPump != null ? `${usd(p.totalCostAtPump)} at the pump` : "pump price unknown for a stop";
});
const discountHint = computed(() => (plan.value?.discountSavings == null ? "needs the pump price at every stop" : "below the pump price"));
</script>

<template>
  <div v-if="plan" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <StatCard label="Route" :value="result.route ? `${result.route.distanceMiles} mi` : '—'" :sub="`${plan.stops.length} stop${plan.stops.length === 1 ? '' : 's'}`" />
    <StatCard label="Fuel to buy" :value="`${plan.totalGallons} gal`" :sub="plan.arrivalFuelPct != null ? `arrive ~${plan.arrivalFuelPct}%` : undefined" />
    <StatCard label="Est. cost" :value="usd(plan.totalCost)" value-tone="text-brand-700" :sub="costHint" />
    <StatCard label="Your discount" :value="usd(plan.discountSavings)" :sub="discountHint" :value-tone="plan.discountSavings != null && plan.discountSavings > 0 ? 'text-success-700' : undefined" />
  </div>
</template>
