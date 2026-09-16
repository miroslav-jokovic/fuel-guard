<script setup lang="ts">
import type { LiveMapBoard, VehicleMapState } from "@silvicom/shared";
import { MAP_STATES, STATE_LABEL, offlineBoundSentence, engineOnBoundSentence } from "./liveMapLayer";

/**
 * The legend, and the census in the same row (LIVE-MAP-PLAN.md LM8, §2b/§2c of the LM8 handoff).
 *
 * ── IT IS A CENSUS BECAUSE 54 OF 199 TRUCKS RENDER OFFLINE ON DAY ONE ────────────────────────────
 * That is the truth (D-LM10: a map that draws a 17-day-old position the same as a 2-second-old one
 * is lying about one of them), and the first reaction to a fifth of the board being grey is "the map
 * is broken". Printing the count beside the colour turns it into a finding — seven of those trucks
 * are `active` vehicles whose telematics stopped more than a week ago, and that is a fleet problem
 * this page is for surfacing.
 *
 * ── THE NUMBERS COME FROM THE RESPONSE, NEVER FROM A LITERAL ─────────────────────────────────────
 * `GET /api/livemap/positions` returns `bounds` exactly so a legend needs no second copy of them. A
 * component that hard-coded "offline after 15 minutes" would be telling the user something the
 * response can already prove, and would be wrong the day the bound is retuned.
 */
withDefaults(
  defineProps<{
    counts: Record<VehicleMapState, number>;
    bounds: LiveMapBoard["bounds"];
    /**
     * `strip` is the row under the card in the document form. `stacked` is the same census one state
     * per line, for DR5's top-left floating panel, which is 16rem wide — the strip wraps to four
     * ragged lines in that box and stops reading as a legend.
     */
    layout?: "strip" | "stacked";
  }>(),
  { layout: "strip" },
);

/** Matches the symbol layer's `icon-opacity`, so grey-and-faded means the same thing in both places. */
const DOT_CLASS: Record<VehicleMapState, string> = {
  moving: "bg-success-600",
  stopped: "bg-info-500",
  parked: "bg-neutral-600",
  offline: "bg-neutral-500 opacity-65",
};

const HINT: Record<VehicleMapState, (b: LiveMapBoard["bounds"]) => string> = {
  moving: (b) => `Over ${b.stoppedSpeedMph} mph`,
  stopped: engineOnBoundSentence,
  parked: (b) => `Not moving, last heard from over ${b.engineOnBoundSeconds}s ago`,
  offline: offlineBoundSentence,
};
</script>

<template>
  <div
    :class="
      layout === 'stacked'
        ? 'flex flex-col gap-1.5'
        : 'flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-edge px-4 py-2.5'
    "
  >
    <span
      v-for="state in MAP_STATES"
      :key="state"
      class="inline-flex items-center gap-1.5 text-xs text-ink-secondary"
      :class="layout === 'stacked' && 'justify-between'"
      :title="HINT[state](bounds)"
    >
      <span class="inline-flex items-center gap-1.5">
        <span class="size-2.5 rounded-full" :class="DOT_CLASS[state]" />
        {{ STATE_LABEL[state] }}
      </span>
      <span class="font-semibold tabular-nums text-ink">{{ counts[state] }}</span>
    </span>
    <span class="text-2xs text-ink-tertiary" :class="layout === 'stacked' && 'pt-1'"
      >{{ offlineBoundSentence(bounds) }} counts as offline</span
    >
  </div>
</template>
