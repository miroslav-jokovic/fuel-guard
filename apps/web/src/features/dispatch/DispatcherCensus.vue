<script setup lang="ts">
import { AppButton as BaseButton } from "@silvicom/ui";
import type { CensusItem, CensusPick } from "./censusItems";

/**
 * Rows per dispatcher, in numbers, and the page's scope control at once (DISPATCH-BOARD-V2-PLAN
 * D-DBV2). The owner, after the dispatchers' session (2026-10-15): "dispatch needs to see how many
 * trucks each dispatcher has — we have that, but it is not transparent in numbers." Each fleet is a
 * button with its count, and pressing it is the filter — so the count and the control are one thing,
 * never two that could disagree (the live map's census-button rule).
 *
 * It draws; it does not count. The board counts trucks and the Loads page counts loads
 * (`censusItems.ts`, Q-DBV8), and `noun` names which, so a button never calls a load a truck.
 */
const props = defineProps<{ items: readonly CensusItem[]; noun: "truck" | "load" | "exception" }>();
const emit = defineEmits<{ pick: [v: CensusPick] }>();

const title = (i: CensusItem) =>
  `${i.label}${i.owner ? ` (${i.owner})` : ""}: ${i.count} ${props.noun}${i.count === 1 ? "" : "s"}${i.sub != null ? `, ${i.sub} ${i.subWords}` : ""}`;
</script>

<template>
  <!-- Scrolls sideways on a phone rather than wrapping into a wall of buttons: 16 fleets do not fit. -->
  <div role="group" :aria-label="`${noun[0]!.toUpperCase()}${noun.slice(1)}s per dispatcher`" class="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
    <!-- The live map's census tile (LiveMapRail): a ghost row button, ringed, pressed = in force. The
         `row` size is full-width by design, so each sits in a cell sized to its own content. -->
    <div v-for="i in items" :key="i.key" class="shrink-0">
      <BaseButton
        variant="ghost"
        size="row"
        class="px-2.5 ring-1 ring-inset"
        :class="i.pressed ? 'bg-surface-subtle ring-edge-strong' : 'ring-edge-subtle'"
        :aria-pressed="i.pressed"
        :title="title(i)"
        :aria-label="title(i)"
        @click="emit('pick', i.pick)"
      >
        <span class="flex flex-col items-start">
          <span class="text-xs font-normal text-ink-muted">{{ i.label }}</span>
          <span class="whitespace-nowrap text-sm tabular-nums text-ink">
            <span class="font-semibold">{{ i.count }}</span>
            <span v-if="i.sub" class="text-xs font-normal text-ink-muted"> · {{ i.sub }} empty</span>
          </span>
        </span>
      </BaseButton>
    </div>
  </div>
</template>
