<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";

/**
 * The one button. Renders a <RouterLink> when `to` is set, a <button> otherwise.
 *
 * variant  primary   — brand call-to-action (one per view, ideally)
 *          secondary — white + border; the default workhorse
 *          danger    — destructive confirmation
 *          soft      — filled neutral (toolbars, "Copy report", sign-out)
 *          ghost     — text-only (e.g. "Clear filters")
 * size     sm (compact toolbars/pagination) | md (default)
 */
const props = withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "danger" | "soft" | "ghost";
    size?: "sm" | "md";
    type?: "button" | "submit" | "reset";
    block?: boolean;
    disabled?: boolean;
    to?: RouteLocationRaw;
  }>(),
  { variant: "secondary", size: "md", type: "button", block: false, disabled: false, to: undefined },
);

const VARIANTS: Record<NonNullable<typeof props.variant>, string> = {
  primary: "bg-brand-600 text-ink-inverse shadow-sm hover:bg-brand-500",
  secondary: "bg-surface text-ink-secondary ring-1 ring-inset ring-edge-strong hover:bg-surface-subtle",
  danger: "bg-danger-600 text-ink-inverse shadow-sm hover:bg-danger-500",
  soft: "bg-surface-muted text-ink-secondary hover:bg-neutral-200",
  ghost: "text-ink-muted hover:text-ink-secondary",
};

const SIZES: Record<NonNullable<typeof props.size>, string> = {
  sm: "gap-x-1 px-2.5 py-1.5 text-sm",
  md: "gap-x-1.5 px-3 py-2 text-sm",
};

const cls = computed(() => [
  "inline-flex items-center justify-center whitespace-nowrap rounded-md font-semibold transition-colors",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
  "disabled:pointer-events-none disabled:opacity-50",
  VARIANTS[props.variant],
  SIZES[props.size],
  props.block ? "flex w-full" : "",
]);
</script>

<template>
  <RouterLink v-if="to && !disabled" :to="to" :class="cls"><slot /></RouterLink>
  <button v-else :type="type" :disabled="disabled" :class="cls"><slot /></button>
</template>
