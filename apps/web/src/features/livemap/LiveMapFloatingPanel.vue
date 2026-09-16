<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { XMarkIcon } from "@silvicom/ui/icons";
import type { LiveMapCorner } from "./liveMapPanels";

/**
 * One panel floating over the map (D-DR5/D-DR9/D-DR10, DESIGN-REFRESH-2026-09.md §4).
 *
 * ── THE CORNER IS FIXED, AND THAT IS A RULING RATHER THAN A SHORTCUT ─────────────────────────────
 * D-DR6 as first written said a floating panel is "a widget with a position". It is not, because
 * there is nowhere to put the position: `StoredDashboardLayout` holds `widgetKeys` and `hiddenKeys`
 * and nothing else, and migration 0343 has no column for one. Open/closed reuses that argument
 * perfectly; placement does not. Comp (7) draws every panel pinned to a corner anyway, so fixed
 * corners cost the design nothing and save a migration for a capability nobody asked for.
 *
 * ── WHEN IT IS SHUT IT IS STILL IN THE DOM ───────────────────────────────────────────────────────
 * `v-show`, not `v-if`, and the collapsed state is a real `<button>` carrying the panel's title.
 * D-DR7's warning applies to every panel, not only the fleet list: the map canvas is a surface a
 * screen reader cannot enter, so anything that leaves the DOM when collapsed leaves no route to
 * what it contained. A dismissed panel here is a labelled control, never an absence.
 *
 * ── IT GROWS OUT OF ITS OWN PILL (`apple-design` §7, §3) ─────────────────────────────────────────
 * `transform-origin` is derived from the corner, so the bottom-left panel expands up and to the
 * right out of the control that opened it and contracts back the same way — enter and exit along
 * one path. The transition is on opacity and transform only and nothing is ever disabled during it,
 * so a dispatcher who closes a panel and immediately reopens it is not made to wait for the first
 * animation to finish.
 */
const props = withDefaults(
  defineProps<{
    title: string;
    corner: LiveMapCorner;
    open: boolean;
    /**
     * Width of the expanded panel above `sm`. Below it every panel is full width — see the corner
     * map for why. The collapsed pill is always sized by its own label, at every width.
     */
    width?: string;
  }>(),
  { width: "sm:w-72" },
);

const emit = defineEmits<{ "update:open": [boolean] }>();

/**
 * Where the panel is anchored, and where it grows from — derived from ONE value so the two can
 * never disagree. A panel pinned bottom-left that scaled from its top-right would read as arriving
 * from somewhere it has never been.
 *
 * ── ⚠ EVERY POSITION IS `sm:`, AND THE CORNERS DO NOT EXIST BELOW IT ─────────────────────────────
 * Measured 2026-09-16 at 390px: the two top panels at their desktop widths (256 and 288) overlap by
 * 193px, so on a phone the Filters panel simply sits on top of the census. There is no width that
 * fixes it — 256 + 288 does not fit in 390 however it is trimmed, and trimming them to fit leaves a
 * search field 170px wide.
 *
 * So below `sm` the panels are not corners at all: they go `static` and stack in the single
 * scrolling column their parent lays out (`LiveMapWorkspace`'s panel layer). This IS a viewport
 * rule, unlike D-DR17's, and deliberately so — the container here is the map, and the map is the
 * viewport. Above `sm` each one takes its corner and its own width.
 */
const PLACEMENT: Record<LiveMapCorner, { position: string; origin: string; stack: string }> = {
  "top-left": {
    position: "sm:left-3 sm:top-3",
    origin: "origin-top-left",
    stack: "flex-col items-start",
  },
  "top-right": {
    position: "sm:right-3 sm:top-3",
    origin: "origin-top-right",
    stack: "flex-col items-start sm:items-end",
  },
  "bottom-left": {
    position: "sm:bottom-3 sm:left-3",
    origin: "origin-bottom-left",
    stack: "flex-col-reverse items-start",
  },
};

const placement = computed(() => PLACEMENT[props.corner]);
</script>

<template>
  <!--
    `z-sticky` rather than `z-raised`: maplibre gives its own control container `z-index: 2`, so the
    lowest tier would put a panel UNDER the map's attribution and controls. Anything above the top
    bar (`z-chrome`) would be wrong in the other direction — these float over the map, not over the
    application.
  -->
  <div class="pointer-events-none z-sticky flex gap-2 sm:absolute" :class="[placement.position, placement.stack]">
    <!--
      The pill. It is the panel's handle in both directions — it opens a shut panel and it is what a
      shut panel leaves behind — so it stays mounted and keeps the title in the accessibility tree
      whichever state the panel is in.
    -->
    <BaseButton
      variant="ghost"
      size="sm"
      class="map-panel pointer-events-auto text-xs text-ink"
      :aria-expanded="open"
      @click="emit('update:open', !open)"
    >
      {{ title }}
      <AppIcon v-if="open" :icon="XMarkIcon" class="size-3.5" aria-hidden="true" />
    </BaseButton>

    <Transition name="map-panel">
      <section
        v-show="open"
        class="map-panel pointer-events-auto w-full overflow-y-auto p-3 sm:max-h-[60vh]"
        :class="[width, placement.origin]"
        :aria-label="title"
      >
        <slot />
      </section>
    </Transition>
  </div>
</template>
