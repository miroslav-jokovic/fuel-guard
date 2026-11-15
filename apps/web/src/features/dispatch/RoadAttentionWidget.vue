<script setup lang="ts">
/**
 * On the road — what is going wrong out there (FLEET-MANAGER-HOME-PLAN §4 card 2).
 *
 * Titled "Needs a hand now" until C2 (SMALL-SCREENS-PLAN.md D-SM12, 2026-11-15): the tab gained a
 * "Needs action" card that lists the alarms of every area, and two cards both named for needing
 * somebody could not be told apart. This one is named for its area, as Seats and Shop are.
 *
 * One row per board exception queue, counted by the board's own filter and named with the board's own
 * label, each linking to that queue — so the number here is the number of rows behind the door
 * (D-FM7). "Empty now" is deliberately absent: it is Fleet right now's figure (Q-FM3), and "No next
 * load" is the actionable form of the same worry. Uncovered loads have no truck and so no board row;
 * they come from the board response's own count and open the Loads page's queue, the way the board's
 * header links them.
 *
 * Every row renders at zero — seeing that nothing is late is the reason to look.
 */
import { computed } from "vue";
import { ExclamationTriangleIcon } from "@silvicom/ui/icons";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList from "@/components/ui/CountList.vue";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { formatDateTime } from "@/lib/format";
import { useRoadAttentionRows } from "./useRoadAttentionRows";

const { board, rows } = useRoadAttentionRows();
const { zone } = useOrgTimezone();

const hosAsOf = computed(() =>
  board.value?.hosAsOf ? `HOS as of ${formatDateTime(board.value.hosAsOf, "—", zone.value)}` : "Live, every minute",
);
</script>

<template>
  <ChartCard title="On the road" :subtitle="hosAsOf" :icon="ExclamationTriangleIcon" tone="danger" class="h-full">
    <CountList :rows="rows" />
  </ChartCard>
</template>
