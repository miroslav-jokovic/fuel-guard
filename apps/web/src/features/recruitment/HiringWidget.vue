<script setup lang="ts">
/**
 * Hiring (FLEET-MANAGER-HOME-PLAN §4 card 9) — the Applicants board's own split, waiting on us vs
 * waiting on them, from the same pipeline query and the same `countWaitingOn`.
 *
 * Each row opens the board on exactly its rows: the board opens on "waiting on you" by default, and
 * `?waiting=them` is the other half — the board's own URL state (D-US2), so the figure is the row
 * count behind the door (D-FM9).
 */
import { UserListIcon } from "@silvicom/ui/icons";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList from "@/components/ui/CountList.vue";
import { useHiringRows } from "./useHiringRows";

const { applicants, rows } = useHiringRows();
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
