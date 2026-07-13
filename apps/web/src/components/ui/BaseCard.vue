<script setup lang="ts">
/**
 * The one raised surface: white card, rounded-lg, hairline ring, soft shadow.
 * padding md (p-5, default) | sm (p-4, filter bars & compact panels)
 *         none (tables & lists that manage their own inner padding —
 *               also clips children to the rounded corners)
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
