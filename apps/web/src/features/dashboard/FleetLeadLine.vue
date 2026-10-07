<script setup lang="ts">
/**
 * The greeting's second line on the Fleet overview (Q-FO6, ruled (a)): one sentence about what
 * moved most, one about what is waiting — DERIVED from the same figures the cards draw, by
 * `fleetLead` in `@silvicom/shared`, never generated.
 *
 * Its own component rather than a computed in `DashboardPage` because the figures come from
 * `useFleetWidgetData`, which the page has no other reason to call: the page decides WHICH
 * dashboard shows and stays ignorant of what is on it (LM-T). Mounted only on the fleet tab, so
 * the Dispatch workspace never pays for the fleet queries.
 */
import { computed } from "vue";
import { fleetLead } from "@silvicom/shared";
import { useFindingsSummaryQuery } from "@/composables/useFindingsSummary";
import { useFleetWidgetData, type FleetRange } from "./fleetWidgetData";

const props = defineProps<{ range: FleetRange }>();
const { s, deltas, previousPhrase } = useFleetWidgetData(computed(() => props.range));
const { data: findings } = useFindingsSummaryQuery();

/** The attention rail's rows that are above zero, counted the way the rail draws them. */
const waiting = computed(() =>
  [s.value?.declinedCount ?? 0, s.value?.openAnomalies ?? 0, findings.value?.open ?? 0, s.value?.idleHours ?? 0].filter((n) => n > 0).length,
);

const line = computed(() =>
  fleetLead({ spend: deltas.value.spend, mpg: deltas.value.mpg, idleHours: deltas.value.idleHours, waiting: waiting.value, against: previousPhrase.value }),
);
</script>

<template>
  <span data-test="fleet-lead">{{ line }}</span>
</template>
