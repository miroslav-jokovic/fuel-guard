<script setup lang="ts">
/**
 * Needs a hand now — what is going wrong on the road (FLEET-MANAGER-HOME-PLAN §4 card 2).
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
import { BOARD_HOS_LOW_MS } from "@silvicom/shared";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList, { type CountRow } from "@/components/ui/CountList.vue";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { formatDateTime } from "@/lib/format";
import { useDispatchBoardQuery } from "./useDispatchBoard";
import { boardDoor, boardRows, queueLabel } from "./boardCounts";
import type { BoardQueue } from "./dispatchBoardView";

const { data: board } = useDispatchBoardQuery();
const { zone } = useOrgTimezone();

const count = (q: BoardQueue) => (board.value ? boardRows(board.value, q).length : null);
const hosHours = BOARD_HOS_LOW_MS / 3_600_000;

const rows = computed<CountRow[]>(() => [
  { key: "late", label: queueLabel("late"), value: count("late"), caption: "loads late or at risk of it", to: boardDoor("late"), door: "Review", alarm: true },
  { key: "hos-low", label: queueLabel("hos-low"), value: count("hos-low"), caption: `drivers under ${hosHours} h of drive time, with a load`, to: boardDoor("hos-low"), door: "Review", alarm: true },
  { key: "no-gps", label: queueLabel("no-gps"), value: count("no-gps"), caption: "trucks not reporting a position", to: boardDoor("no-gps"), door: "Review" },
  { key: "no-next", label: queueLabel("no-next"), value: count("no-next"), caption: "hauling now, nothing booked after", to: boardDoor("no-next"), door: "Plan" },
  {
    key: "uncovered",
    label: "Uncovered loads",
    value: board.value?.uncoveredCount ?? null,
    caption: "open loads no truck carries",
    to: "/loads?queue=uncovered&scope=all",
    door: "Cover",
  },
]);

const hosAsOf = computed(() =>
  board.value?.hosAsOf ? `HOS as of ${formatDateTime(board.value.hosAsOf, "—", zone.value)}` : "Live, every minute",
);
</script>

<template>
  <ChartCard title="Needs a hand now" :subtitle="hosAsOf" :icon="ExclamationTriangleIcon" tone="danger" class="h-full">
    <CountList :rows="rows" />
  </ChartCard>
</template>
