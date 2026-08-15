<script setup lang="ts">
/** Shared semantic surface. Raised is reserved for explicit emphasis and overlays. */
withDefaults(
  defineProps<{
    padding?: "none" | "sm" | "md";
    as?: string;
    variant?: "flat" | "bordered" | "raised";
  }>(),
  {
    padding: "md",
    as: "div",
    variant: "bordered",
  },
);
const PAD: Record<string, string> = { none: "overflow-hidden", sm: "p-4", md: "p-5" };
const VARIANT: Record<string, string> = {
  flat: "bg-transparent",
  bordered: "bg-surface shadow-card ring-1 ring-edge-subtle",
  raised: "bg-surface shadow-card-raised ring-1 ring-edge-subtle",
};
</script>

<template>
  <component :is="as" class="rounded-surface" :class="[PAD[padding], VARIANT[variant]]">
    <slot />
  </component>
</template>
