<script setup lang="ts">
import { computed } from "vue";
import FuelStatTile from "./FuelStatTile.vue";
import type { PlanResult } from "./useFuelPlan";

const props = defineProps<{ result: PlanResult }>();

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const plan = computed(() => props.result.plan);
const savingsTone = computed(() => (plan.value?.savingsVsNaive && plan.value.savingsVsNaive > 0 ? "success" : "ink"));
</script>

<template>
  <div v-if="plan" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <FuelStatTile label="Route" :value="result.route ? `${result.route.distanceMiles} mi` : '—'" :hint="`${plan.stops.length} stop${plan.stops.length === 1 ? '' : 's'}`" />
    <FuelStatTile label="Fuel to buy" :value="`${plan.totalGallons} gal`" :hint="plan.arrivalFuelPct != null ? `arrive ~${plan.arrivalFuelPct}%` : undefined" />
    <FuelStatTile label="Est. cost" :value="usd(plan.totalCost)" tone="brand" />
    <FuelStatTile label="Savings vs naive" :value="usd(plan.savingsVsNaive)" :tone="savingsTone" />
  </div>
</template>
