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
/*
 * `none` clips to the surface's rounded corners. A `flat` card has no surface to clip to, and
 * clipping there cuts the rings of whatever it holds (DataWorkspace over boxed cards,
 * SMALL-SCREENS-PLAN.md D-SM5) — so the template leaves it off for that one pair.
 */
const VARIANT: Record<string, string> = {
  flat: "bg-transparent",
  bordered: "bg-surface shadow-card ring-1 ring-edge-subtle",
  raised: "bg-surface shadow-card-raised ring-1 ring-edge-subtle",
};
</script>

<template>
  <component :is="as" class="rounded-surface" :class="[variant === 'flat' && padding === 'none' ? '' : PAD[padding], VARIANT[variant]]">
    <slot />
  </component>
</template>
