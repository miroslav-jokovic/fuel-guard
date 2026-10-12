<script setup lang="ts">
/**
 * Hiring (FLEET-MANAGER-HOME-PLAN §4 card 9) — the Applicants board's own split, waiting on us vs
 * waiting on them, from the same pipeline query and the same `countWaitingOn`.
 *
 * Each row opens the board on exactly its rows: the board opens on "waiting on you" by default, and
 * `?waiting=them` is the other half — the board's own URL state (D-US2), so the figure is the row
 * count behind the door (D-FM9).
 */
import { computed } from "vue";
import { UserListIcon } from "@silvicom/ui/icons";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList, { type CountRow } from "@/components/ui/CountList.vue";
import { countWaitingOn, usePipelineQuery } from "./useEmployment";

const { data: applicants } = usePipelineQuery();
const count = (who: "us" | "them") => (applicants.value ? countWaitingOn(applicants.value, who) : null);

const rows = computed<CountRow[]>(() => [
  { key: "us", label: "Waiting on you", value: count("us"), caption: "applications with our next step", to: "/recruitment", door: "Applicants" },
  { key: "them", label: "Waiting on them", value: count("them"), caption: "with the applicant", to: "/recruitment?waiting=them", door: "Applicants" },
]);
</script>

<template>
  <ChartCard
    title="Hiring"
    subtitle="Open applications"
    :icon="UserListIcon"
    tone="info"
    :readout="applicants ? applicants.length.toLocaleString('en-US') : '—'"
    caption="applicants in the pipeline"
    class="h-full"
  >
    <CountList :rows="rows" />
  </ChartCard>
</template>
