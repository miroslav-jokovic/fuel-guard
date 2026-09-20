<script setup lang="ts">
/** The drivers the scoring engine flagged hardest in this window. */
import { computed } from "vue";
import { UsersIcon } from "@silvicom/ui/icons";
import RiskList from "../RiskList.vue";
import { useFleetWidgetData, type FleetRange } from "../fleetWidgetData";

const props = defineProps<{ range: FleetRange }>();
const { s } = useFleetWidgetData(computed(() => props.range));
</script>

<template>
  <RiskList title="Top drivers by risk" :icon="UsersIcon" tone="caution" :rows="s?.topDriversByRisk ?? []" link-base="/drivers" empty-label="No flagged drivers" />
</template>
