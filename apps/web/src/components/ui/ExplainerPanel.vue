<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard, AppIcon } from "@silvicom/ui";
import { ChevronRightIcon } from "@silvicom/ui/icons";

/**
 * The collapsed "how this is calculated" panel for report pages.
 *
 * ── Why the finance pages needed one ────────────────────────────────────────────────────────────
 * The four Finance reports carried their method in the page description and in trailing note cards:
 * the cost-per-mile header alone ran to 58 words before the reader reached a figure, and its
 * caveats, provenance notes and GL reconciliation sat below the table as three more cards. None of
 * that is wrong — a CPM number whose assumptions are invisible is worse than none, and it is the
 * hardest-won text in the app — but it is reference material, and reference material read by
 * someone whose first language is not English should be one click away rather than in the way
 * (owner ruling, 2026-08-29).
 *
 * ── Why <details> and not a component with its own open state ───────────────────────────────────
 * The native element is already the accessible disclosure: keyboard operable, announced as a
 * disclosure, and findable by the browser's own in-page search even while collapsed — which a
 * JS-toggled `v-if` panel is not. `features/hazmat/VerdictPanel.vue:336` established the house
 * styling; this only wraps it in the standard card so report pages stop hand-rolling both.
 *
 * Content is a slot, not a prop: every one of these panels is several paragraphs with structure.
 *
 * ── WHY THERE IS A SECOND VARIANT, AND WHY IT IS A PROP RATHER THAN A CLASS AT THE CALL SITE ─────
 * The live map's rail foot needs this same disclosure (Q-LM19): one quiet line a dispatcher reads
 * every day, opening onto the three reference sentences behind it. What it cannot take is the card
 * — the rail IS the panel, so a card inside its foot is a box in a box — or the `text-sm
 * font-semibold text-ink` summary, which would be the loudest thing in a strip of `text-2xs`
 * metadata.
 *
 * ⚠ It is a VARIANT and not a class passed in, because a class passed in would not have worked and
 * would not have said so. D-LM22 measured exactly that on `AppButton`: a call-site utility and the
 * component's own utility land in the same cascade layer, Tailwind's ordering decides which wins,
 * and the second attempt there failed SILENTLY — three entries read back from the DOM as one
 * colour. `AppButton`'s comments say three times that an override at a call site means a variant is
 * missing. This is a fourth, and it is written as a variant instead.
 */
const props = withDefaults(
  defineProps<{
    summary?: string;
    /**
     * `card` is the report-page disclosure — a `BaseCard` with a heading-weight summary.
     * `inline` is the same disclosure with no container and metadata typography, for a surface that
     * is already a panel.
     */
    variant?: "card" | "inline";
  }>(),
  { summary: "How this is calculated", variant: "card" },
);

/**
 * One copy of the `<details>` markup, wrapped differently.
 *
 * The alternative was `v-if`/`v-else` around two copies of the disclosure, and two copies is how one
 * of them comes to lose the `list-none` or the slot. The `div` in the `inline` case is a wrapper
 * that does nothing on purpose — it costs one element and keeps the accessible structure identical
 * between the variants.
 */
const wrapper = computed(() => (props.variant === "card" ? BaseCard : "div"));
const wrapperProps = computed(() => (props.variant === "card" ? { padding: "sm" as const } : {}));

const summaryClass = computed(() =>
  props.variant === "card"
    ? "gap-1.5 text-sm font-semibold text-ink"
    : "gap-1 text-2xs text-ink-tertiary",
);
const chevronClass = computed(() => (props.variant === "card" ? "size-4" : "size-3"));
/** `text-xs` and not `text-2xs`: this is material meant to be READ, which D-DS6 starts at `text-xs`. */
const bodyClass = computed(() =>
  props.variant === "card" ? "mt-3 space-y-2 text-sm" : "mt-2 space-y-1.5 text-xs",
);
</script>

<template>
  <component :is="wrapper" v-bind="wrapperProps">
    <details class="group">
      <summary
        class="flex cursor-pointer list-none items-center"
        :class="summaryClass"
      >
        <!-- `list-none` above hides the UA's own marker, so this one is the only one drawn; it
             turns with `open` to say which way the panel is going. -->
        <AppIcon
          :icon="ChevronRightIcon"
          class="shrink-0 text-ink-tertiary transition-transform group-open:rotate-90 motion-reduce:transition-none"
          :class="chevronClass"
          aria-hidden="true"
        />
        {{ summary }}
      </summary>
      <div class="text-ink-secondary" :class="bodyClass">
        <slot />
      </div>
    </details>
  </component>
</template>
