<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";
import type { Icon } from "../icons";
import { useTouchTargets } from "../touchTargets";
import AppIcon from "./AppIcon.vue";

const props = withDefaults(
  defineProps<{
    icon: Icon;
    label: string;
    variant?: "secondary" | "ghost" | "danger";
    size?: "sm" | "md";
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    /**
     * Renders a `RouterLink`, as `AppButton`'s `to` does: an icon that opens a page is a link, so
     * middle-click and "open in new tab" keep working (TRUCK-CARD-ROUTE-PLAN D-TC1, the live map's
     * truck and driver doors). A disabled one falls back to the button, which can be disabled.
     */
    to?: RouteLocationRaw;
    /**
     * A toggle's state (TRUCK-CARD-ROUTE-PLAN D-TC7, the live map's route): sets `aria-pressed`, so a
     * screen reader hears "pressed", and the brand tint, so a sighted reader sees it is on. Omitted,
     * the button is a plain action and carries no `aria-pressed` at all.
     */
    pressed?: boolean;
  }>(),
  { variant: "ghost", size: "md", type: "button", disabled: false, to: undefined, pressed: undefined },
);
/** 44 px square inside a thumb-pressed layout (`touchTargets.ts`), whatever the size asked for. */
const touchTargets = useTouchTargets();

const cls = computed(() => [
  "inline-flex shrink-0 items-center justify-center rounded-control transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:pointer-events-none disabled:opacity-60",
  touchTargets ? "size-11" : props.size === "sm" ? "size-8" : "size-9",
  props.variant === "secondary" && "bg-surface text-ink-secondary ring-1 ring-inset ring-edge-control hover:bg-surface-subtle",
  props.variant === "ghost" && "text-ink-tertiary hover:bg-surface-muted hover:text-ink",
  props.variant === "danger" && "text-danger-700 hover:bg-danger-subtle",
  props.pressed && "bg-brand-50 text-brand-700 hover:bg-brand-50 hover:text-brand-700",
]);
</script>

<template>
  <!-- `title` beside `aria-label`: an icon alone is a guess for a sighted reader too, and the hover
       tooltip is the same words a screen reader announces. -->
  <RouterLink v-if="to && !disabled" :to="to" :aria-label="label" :title="label" :class="cls">
    <AppIcon :icon="icon" :class="size === 'sm' ? 'size-4' : 'size-5'" aria-hidden="true" />
  </RouterLink>
  <button v-else :type="type" :disabled="disabled" :aria-label="label" :title="label" :aria-pressed="pressed" :class="cls">
    <AppIcon :icon="icon" :class="size === 'sm' ? 'size-4' : 'size-5'" aria-hidden="true" />
  </button>
</template>
