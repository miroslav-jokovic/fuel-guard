<script setup lang="ts">
import { computed } from "vue";
import type { PlacardName } from "@hazmat/engine";
import { placardArt, renderPlacardWithIdNumber } from "@hazmat/placards";

/**
 * Renders the exact §172.5xx DOT diamond for a placard the engine says is required, using the shared
 * @hazmat/placards artwork (the same SVGs the driver app will use). Display only — the engine decides
 * WHICH placards; this just draws them. `symbolProvisional` art is flagged so a reviewer knows the
 * pictogram is a placeholder pending official artwork.
 *
 * SIZING: the wrapper is the single source of truth for how big the diamond is. It used to size a box
 * to `size` px while the SVG carried its own `width="200" height="200"`, so the artwork ignored the box
 * and overflowed it by 104 px in every direction — covering the caption underneath, the positions line
 * and the citation chip. The generator now emits a container-relative root, and the wrapper pins the
 * aspect ratio, so what you size is what you get.
 *
 * `idNumber` renders the §172.332(c) variant — the number across the center of the placard. The art
 * package refuses (returns null) for the designs §172.334 bars, and this component falls back to the
 * plain placard rather than drawing something unlawful.
 */
const props = withDefaults(
  defineProps<{ name: PlacardName; size?: number; idNumber?: string | null }>(),
  { size: 96, idNumber: null },
);

const art = computed(() => placardArt(props.name));
const svg = computed(() => {
  const digits = props.idNumber?.replace(/[^0-9]/g, "") ?? "";
  if (digits) {
    const withId = renderPlacardWithIdNumber(props.name, digits);
    if (withId) return withId;
  }
  return art.value.svg;
});
const label = computed(() => {
  const base = art.value.label || art.value.name.replace(/_/g, " ");
  return props.idNumber ? `${base} placard displaying ${props.idNumber}` : `${base} placard`;
});
</script>

<template>
  <div class="inline-flex max-w-full flex-col items-center gap-1">
    <!-- eslint-disable vue/no-v-html -- Trusted static art: SVGs are generated in-repo by @hazmat/placards, never user input. -->
    <div
      class="block shrink-0 overflow-hidden [&>svg]:block [&>svg]:size-full"
      :style="{ width: `${size}px`, height: `${size}px` }"
      role="img"
      :aria-label="label"
      v-html="svg"
    />
    <!-- eslint-enable vue/no-v-html -->
    <span
      v-if="art.symbolProvisional"
      class="text-2xs font-medium uppercase tracking-wide text-ink-tertiary"
      title="Pictogram is a placeholder pending official artwork"
    >
      placeholder art
    </span>
  </div>
</template>
