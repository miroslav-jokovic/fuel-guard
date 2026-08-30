<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";

/** Shared button for both applications. Gold is identity; graphite is action. */
const props = withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "danger" | "soft" | "ghost" | "link";
    size?: "sm" | "md";
    type?: "button" | "submit" | "reset";
    block?: boolean;
    disabled?: boolean;
    to?: RouteLocationRaw;
  }>(),
  {
    variant: "secondary",
    size: "md",
    type: "button",
    block: false,
    disabled: false,
    to: undefined,
  },
);

const VARIANTS: Record<NonNullable<typeof props.variant>, string> = {
  primary: "bg-action-primary text-action-primary-foreground hover:bg-action-primary-hover",
  secondary:
    "bg-surface text-ink-secondary ring-1 ring-inset ring-edge-control hover:bg-surface-subtle",
  danger: "bg-danger-solid text-danger-solid-foreground hover:bg-danger-600",
  soft: "bg-surface-muted text-ink-secondary hover:bg-selected-surface",
  ghost: "text-ink-secondary hover:bg-surface-muted hover:text-ink",
  /**
   * An action that reads as part of a sentence — "…works out to 3,600 lb — use it." — rather than a
   * control beside one.
   *
   * It exists because its absence was being faked. Two hazmat call sites wrote
   * `variant="ghost" class="!h-auto !px-0 !text-xs !font-medium !text-brand-700 hover:!bg-transparent
   * hover:!underline"`: six `!important`s to undo the button's box and repaint it as a link, against a
   * contract whose first rule is that a primitive is never re-styled. The honest reading was that the
   * variant was missing, not that the rule was wrong.
   *
   * `link` drops the SIZE box too (see `SIZES`), because height and horizontal padding are exactly
   * what an inline action must not have.
   */
  link: "text-link hover:text-link-hover hover:underline",
};
const SIZES: Record<NonNullable<typeof props.size>, string> = {
  sm: "h-8 gap-x-1 px-2.5 text-sm",
  md: "h-9 gap-x-1.5 px-3 text-sm",
};

/** The link variant sits in running text, so it takes the surrounding size and no box at all. */
const LINK_SIZE = "h-auto gap-x-1 p-0 text-inherit";

const cls = computed(() => [
  "inline-flex items-center justify-center whitespace-nowrap rounded-control font-semibold transition-colors",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
  "disabled:pointer-events-none disabled:text-ink-disabled disabled:opacity-60",
  VARIANTS[props.variant],
  props.variant === "link" ? LINK_SIZE : SIZES[props.size],
  props.block ? "flex w-full" : "",
]);
</script>

<template>
  <RouterLink v-if="to && !disabled" :to="to" :class="cls"><slot /></RouterLink>
  <button v-else :type="type" :disabled="disabled" :class="cls"><slot /></button>
</template>
