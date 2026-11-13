<script setup lang="ts">
import { computed } from "vue";
import type { BoardHomeTime, DispatchBoardRow, HomeTimeChip } from "@silvicom/shared";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import { homeTimeChipTone, homeTimeChipWords } from "@/components/homeTime/homeTimeView";

/**
 * The row's home time, in its Warnings cell (HOME-TIME-PLAN D-HT11): "Home time from 11/20", "Driver
 * home until 11/18", "Back in 18 h", "Home time overdue 1 d 4 h", "Truck at home 9 days". Which chips a
 * seat has is the server's (`homeTimeChips`); this words and colours them.
 *
 * Plain badges, like the due-date warnings beside them and unlike the note chips: the tone IS the
 * message here (red = act now), and a link inside a badge takes the link's colour. The row's own click
 * opens the truck's drawer, whose first section is home time, so the action is one click away either way.
 *
 * On a team truck the chip names the seat; on a solo truck the Driver column already says who.
 */
const props = defineProps<{ row: DispatchBoardRow; now: Date; zone: string }>();

// A web bundle newer than the API it reaches gets rows without the list for the minutes of a deploy.
const seats = computed<BoardHomeTime[]>(() => props.row.homeTimes ?? []);
const team = computed(() => props.row.coDriver !== null);
const chips = computed(() =>
  seats.value.flatMap((h) => h.chips.map((chip): { h: BoardHomeTime; chip: HomeTimeChip } => ({ h, chip }))),
);
const words = (h: BoardHomeTime, chip: HomeTimeChip) =>
  homeTimeChipWords(chip, h, { now: props.now, zone: props.zone, who: team.value ? h.driverName : null });
const title = (h: BoardHomeTime) =>
  `${h.driverName}: home time ${formatDateTime(h.startAt, "—", props.zone)} to ${formatDateTime(h.expectedReturnAt, "—", props.zone)}`;
</script>

<template>
  <div v-if="chips.length" class="flex flex-col items-start gap-0.5" data-board-home-time-chips>
    <span
      v-for="c in chips"
      :key="`${c.h.periodId}:${c.chip}`"
      :class="[BADGE_BASE, toneClass(homeTimeChipTone(c.chip))]"
      :title="title(c.h)"
      data-board-home-time-chip
    >
      {{ words(c.h, c.chip) }}
    </span>
  </div>
</template>
