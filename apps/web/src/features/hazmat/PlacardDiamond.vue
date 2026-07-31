<script setup lang="ts">
import { computed } from "vue";
import type { PlacardName } from "@hazmat/engine";
import { placardArt } from "@hazmat/placards";

/**
 * Renders the exact §172.5xx DOT diamond for a placard the engine says is required, using the shared
 * @hazmat/placards artwork (the same SVGs the driver app will use). Display only — the engine decides
 * WHICH placards; this just draws them. `symbolProvisional` art is flagged so a reviewer knows the
 * pictogram is a placeholder pending official artwork.
 */
const props = withDefaults(defineProps<{ name: PlacardName; size?: number }>(), { size: 96 });

const art = computed(() => placardArt(props.name));
</script>

<template>
  <div class="inline-flex flex-col items-center gap-1">
    <!-- eslint-disable vue/no-v-html -- Trusted static art: SVGs are generated in-repo by @hazmat/placards, never user input. -->
    <div
      class="shrink-0"
      :style="{ width: `${size}px`, height: `${size}px` }"
      role="img"
      :aria-label="`${art.label || art.name} placard`"
      v-html="art.svg"
    />
    <!-- eslint-enable vue/no-v-html -->
    <span
      v-if="art.symbolProvisional"
      class="text-xs font-medium uppercase tracking-wide text-ink-subtle"
      title="Pictogram is a placeholder pending official artwork"
    >
      placeholder art
    </span>
  </div>
</template>
