<script setup lang="ts">
/**
 * The frame every trend card on the Dashboard wears (D-DT11, §4.3 of DASHBOARD-TEMPLATE-V2.md).
 *
 * ── WHAT CHANGED, AND WHY IT IS THE HEADER RATHER THAN THE PLOT ─────────────────────────────────
 * This was a title, an optional subtitle and a slot. Every comp draws the same card with three more
 * things, and none of them is a chart feature: a tinted icon chip leading the title, a READOUT — the
 * period's own figure in large type — and room at the right of the header for the card's own
 * control. The plot underneath is unchanged; the reason these cards read as thin next to the comps
 * was never the bars.
 *
 * ── THE READOUT IS THE TOOLTIP (D-DT11) ─────────────────────────────────────────────────────────
 * At rest `readout` is the period total and `caption` says what window it covers. While the pointer
 * is over the plot the CALLER swaps both for the point under the pointer — same slot, same type, no
 * floating box chasing the cursor (`trendOptions({ onScrub })` turns the Chart.js tooltip off when a
 * card takes this up). The swap lives in the widget rather than here because only the widget knows
 * how to format its own series: dollars on one card, MPG on the other.
 *
 * ⚠ `readout` is optional and the row is absent without it. Two cards on this page (the donuts)
 * have a centre figure of their own and a second one in the header would be the same number twice.
 */
import { AppCard as BaseCard, AppIconChip, type ChipTone } from "@silvicom/ui";
import { type Icon } from "@silvicom/ui/icons";

withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    /** The chip's glyph. Optional, for the same reason `StatCard`'s is (D-UI6). */
    icon?: Icon;
    tone?: ChipTone;
    /** The headline figure, already formatted — the period total, or the scrubbed point. */
    readout?: string;
    /** What the figure is OF: the window at rest, the day under the pointer while scrubbing. */
    caption?: string;
  }>(),
  { subtitle: undefined, icon: undefined, tone: undefined, readout: undefined, caption: undefined },
);
</script>

<template>
  <BaseCard>
    <div class="mb-4 flex items-start justify-between gap-3">
      <div class="flex min-w-0 items-start gap-3">
        <!-- `size="sm"` — the 32px chip §4.3 measures off the comps, one step down from the hero
             tile's. A card title is not a KPI and its chip should not out-weigh one. -->
        <AppIconChip v-if="icon" :icon="icon" :tone="tone" size="sm" />
        <div class="min-w-0">
          <h3 class="text-sm font-semibold text-ink">{{ title }}</h3>
          <p v-if="subtitle" class="mt-0.5 text-xs text-ink-muted">{{ subtitle }}</p>
        </div>
      </div>
      <div class="shrink-0"><slot name="meta" /></div>
    </div>

    <!--
      The readout sits between the header and the plot, which is where every comp puts it and where
      a scrubbed value has to be: above the thing being pointed at, so the pointer never covers the
      answer. `tabular-nums` because it changes under the cursor — proportional figures make the
      whole line jitter as the digits change width.

      `min-h-9` is a reservation, not decoration: the caption is absent on some scrub frames (a
      week with no measured distance), and a row that collapses would move the plot under the
      pointer mid-scrub.
    -->
    <div v-if="readout" class="mb-3 flex min-h-9 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <p class="text-2xl font-bold tabular-nums text-ink">{{ readout }}</p>
      <p v-if="caption" class="text-xs text-ink-tertiary">{{ caption }}</p>
    </div>

    <slot />
  </BaseCard>
</template>
