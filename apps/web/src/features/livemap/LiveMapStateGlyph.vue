<script setup lang="ts">
/**
 * A map state's marker, drawn in the rail from the SAME path strings the map's canvas draws
 * (`liveMapGlyphs.ts`, D-LM30). The census and each row show the shape a dispatcher is about to look
 * for on the map, so the legend is the marker rather than a promise about it.
 *
 * Decorative: every use sits beside the state's written label, so the SVG is `aria-hidden`.
 */
import { computed } from "vue";
import type { VehicleMapState } from "@silvicom/shared";
import { GLYPHS, STATE_GLYPH } from "./liveMapGlyphs";
import { STATE_COLOR_CLASS } from "./liveMapLayer";

const props = defineProps<{ state: VehicleMapState }>();

const parts = computed(() => GLYPHS[STATE_GLYPH[props.state]].parts);
</script>

<template>
  <svg
    viewBox="-12 -12 24 24"
    class="shrink-0"
    :class="STATE_COLOR_CLASS[state]"
    aria-hidden="true"
    focusable="false"
  >
    <!--
      `currentColor` is the state's token (the class above); the keyline paint is the surface the rail
      sits on, which is what white is on the map — a white centre would glare in the dark scheme.
    -->
    <path
      v-for="(part, i) in parts"
      :key="i"
      :d="part.d"
      :class="part.paint === 'keyline' ? (part.mode === 'fill' ? 'fill-surface' : 'stroke-surface') : ''"
      :fill="part.mode === 'fill' ? (part.paint === 'state' ? 'currentColor' : undefined) : 'none'"
      :stroke="part.mode === 'stroke' && part.paint === 'state' ? 'currentColor' : undefined"
      :stroke-width="part.mode === 'stroke' ? part.width : undefined"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>
