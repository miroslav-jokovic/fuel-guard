<script setup lang="ts">
/**
 * The one raised surface (shared design primitive): white card, rounded-lg, hairline ring, soft shadow.
 * Mirrors apps/web BaseCard. padding md (p-5, default) | sm (p-4) | none (clips to rounded corners).
 */
withDefaults(defineProps<{ padding?: "none" | "sm" | "md"; as?: string }>(), {
  padding: "md",
  as: "div",
});
const PAD: Record<string, string> = { none: "overflow-hidden", sm: "p-4", md: "p-5" };
</script>

<template>
  <component :is="as" class="rounded-lg bg-surface shadow-sm ring-1 ring-edge" :class="PAD[padding]">
    <slot />
  </component>
</template>
