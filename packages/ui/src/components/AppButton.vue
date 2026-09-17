<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";

/** Shared button for both applications. Gold is identity; graphite is action. */
const props = withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "danger" | "soft" | "ghost" | "link";
    size?: "sm" | "md" | "icon" | "row";
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
  /**
   * A SQUARE button holding one icon and no label — a row's move-up, a row's hide.
   *
   * Added 2026-09-15 for the Dashboard layout editor (LM10), and added HERE rather than written as
   * `class="!h-8 !w-8 !p-0"` at the call site because `lint:ui-adoption` refuses that and is right
   * to: the `ghost` variant's own comment above records the same lesson from the other direction —
   * an `!important` override is the sign that a variant is missing, not that the rule is wrong.
   *
   * The caller still owns the ACCESSIBLE NAME. A button with no text has none, so every call site
   * passes `aria-label`; there is no way for this file to enforce that, which is why it is said here.
   */
  icon: "size-8 p-0",
  /**
   * A ROW in a list: the full width of its column, left-aligned, as tall as its own content.
   *
   * Added 2026-09-16 for the live map's fleet rail (D-DR25), and added here for the third time the
   * same lesson has been learned in this file — the call site was written as
   * `class="!h-auto !justify-start !rounded-none !px-3 !py-2 !text-left !font-normal"`, six
   * `!important`s to undo the button's box, which `lint:template-integrity` refused and was right to.
   *
   * ⚠ A row is a BUTTON and not a table row on purpose: in the fleet rail it is the keyboard's only
   * route onto a canvas a screen reader cannot enter, so it has to be focusable and activatable
   * without a grid's roles. It also wraps — `whitespace-normal` — because a row carries a driver's
   * name and a place name rather than a label, and truncation is the caller's to choose per line.
   */
  row: "h-auto w-full gap-x-2 px-3 py-2 text-sm",
};

/** The link variant sits in running text, so it takes the surrounding size and no box at all. */
const LINK_SIZE = "h-auto gap-x-1 p-0 text-inherit";

/**
 * ⚠ The shape line is conditional because `row` inverts three of its defaults — a control is centred,
 * pill-cornered and semibold; a list row is left-aligned, square and normal weight. Branching here is
 * what lets the variant exist WITHOUT an `!important` at the call site, which was the whole reason it
 * was added.
 */
const SHAPE = {
  control: "justify-center whitespace-nowrap rounded-control font-semibold",
  row: "justify-start whitespace-normal text-left font-normal",
} as const;

const cls = computed(() => [
  "inline-flex items-center transition-colors",
  props.size === "row" ? SHAPE.row : SHAPE.control,
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
