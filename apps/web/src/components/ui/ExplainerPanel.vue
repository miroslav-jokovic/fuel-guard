<script setup lang="ts">
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
 */
withDefaults(defineProps<{ summary?: string }>(), { summary: "How this is calculated" });
</script>

<template>
  <BaseCard padding="sm">
    <details class="group">
      <summary
        class="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-ink"
      >
        <!-- `list-none` above hides the UA's own marker, so this one is the only one drawn; it
             turns with `open` to say which way the panel is going. -->
        <AppIcon
          :icon="ChevronRightIcon"
          class="size-4 shrink-0 text-ink-tertiary transition-transform group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden="true"
        />
        {{ summary }}
      </summary>
      <div class="mt-3 space-y-2 text-sm text-ink-secondary">
        <slot />
      </div>
    </details>
  </BaseCard>
</template>
