<script setup lang="ts">
/** Open anomaly cases by severity. */
import { computed } from "vue";
import SeverityBreakdown from "../SeverityBreakdown.vue";
import { useFleetWidgetData, type FleetRange } from "../fleetWidgetData";

const props = defineProps<{ range: FleetRange }>();
const { s } = useFleetWidgetData(computed(() => props.range));
</script>

<template>
  <SeverityBreakdown :severity="s?.anomaliesBySeverity ?? { low: 0, medium: 0, high: 0, critical: 0 }" />
</template>
