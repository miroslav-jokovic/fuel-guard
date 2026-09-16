<script setup lang="ts">
/** The vehicles the scoring engine flagged hardest in this window. */
import { computed } from "vue";
import RiskList from "../RiskList.vue";
import { useFleetWidgetData, type FleetRange } from "../fleetWidgetData";

const props = defineProps<{ range: FleetRange }>();
const { s } = useFleetWidgetData(computed(() => props.range));
</script>

<template>
  <RiskList title="Top vehicles by risk" :rows="s?.topVehiclesByRisk ?? []" link-base="/vehicles" empty-label="No flagged vehicles" />
</template>
