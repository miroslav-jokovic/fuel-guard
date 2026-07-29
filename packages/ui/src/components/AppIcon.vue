<script setup lang="ts">
import { HugeiconsIcon, type IconArray } from "@hugeicons/vue";

/**
 * AppIcon — the single icon primitive for every FuelGuard surface.
 *
 * Renders a HugeIcons Stroke Rounded glyph and honours the existing
 * Tailwind sizing/colour convention (`class="size-5 text-brand-600"`).
 *
 * Migration note: this component replaces `@heroicons/vue`. Icons come from
 * the `@fuelguard/ui/icons` barrel — never import directly from
 * `@hugeicons/core-free-icons` in feature code, so we retain the freedom to
 * swap variants (or upgrade to HugeIcons Pro) in one place.
 *
 * Usage:
 *   import { AppIcon } from "@fuelguard/ui";
 *   import { CheckCircleIcon } from "@fuelguard/ui/icons";
 *
 *   <AppIcon :icon="CheckCircleIcon" class="size-5 text-success-500" aria-hidden="true" />
 *
 * Sizing:  Tailwind `size-*` (or `w-* h-*`) drives the SVG box. We deliberately
 *          do NOT pass the `size` prop to HugeiconsIcon so CSS wins.
 * Colour:  Icons inherit `currentColor`. Set `text-*` on the tag (or an
 *          ancestor) to colour them.
 * Stroke:  Default 1.5 (matches HugeIcons' shipping value). Override per call
 *          site only when a visual case demands it.
 */
withDefaults(
  defineProps<{
    /** An icon module imported from `@fuelguard/ui/icons`. */
    icon: IconArray;
    /** Stroke width. Keep the default unless a specific visual calls for another. */
    strokeWidth?: number;
  }>(),
  { strokeWidth: 1.5 },
);

// Any other attribute (class, aria-*, v-bind, listeners) falls through to the
// underlying <svg>. That's what makes the migration a drop-in.
defineOptions({ inheritAttrs: true });
</script>

<template>
  <HugeiconsIcon :icon="icon" color="currentColor" :stroke-width="strokeWidth" />
</template>
