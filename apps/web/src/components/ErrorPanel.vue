<script setup lang="ts">
/**
 * The body of the three dead-end pages (G1, UI-GAPS-PLAN.md): not-found, server-error,
 * maintenance. The pages themselves carry `<PageHeader>` — `lint:ui-adoption` greps for it
 * per-file, so it cannot move in here — and this holds everything below it.
 *
 * Why a shared piece for three pages: they are the same shape (a mark, a sentence, a fact worth
 * quoting, one or two ways out) and the only thing that differs is the wording. Three copies of
 * that would drift, and a dead-end page nobody looks at is exactly where drift survives.
 */
import { AppIcon } from "@fuelguard/ui";
import type { Icon } from "@fuelguard/ui/icons";

defineProps<{
  /** Icon from `@fuelguard/ui/icons` — the concept, not decoration. */
  icon: Icon;
  /** What happened, in one sentence. */
  message: string;
  /**
   * The fact the reader can act on or quote back: the path we could not find, the timestamp of a
   * failure. Rendered in a monospace row so a URL with punctuation can be read character by
   * character — the whole point of showing it is that a typo is legible.
   */
  detail?: string;
  /** What `detail` is, so the row is not a bare string. */
  detailLabel?: string;
}>();
</script>

<template>
  <div class="mt-8 flex flex-col items-center gap-4 py-10 text-center">
    <span class="flex size-12 items-center justify-center rounded-full bg-surface-muted">
      <AppIcon :icon="icon" class="size-6 text-ink-tertiary" aria-hidden="true" />
    </span>
    <p class="max-w-prose text-sm text-ink-secondary">{{ message }}</p>
    <!--
      The label sits ABOVE the value rather than beside it. Sharing a line squeezed the value into a
      narrow column, and since `break-all` is what stops a long path overflowing the card, the
      squeeze turned into a break mid-word — "/fuel-reconci / liation", which is precisely the
      opposite of legible for the one string on the page the reader has to copy accurately.
    -->
    <div v-if="detail" class="w-full max-w-full">
      <p v-if="detailLabel" class="mb-1 text-xs text-ink-tertiary">{{ detailLabel }}</p>
      <code class="inline-block rounded-control bg-surface-muted px-2 py-1 font-mono text-xs break-all text-ink">{{ detail }}</code>
    </div>
    <div v-if="$slots.default" class="mt-2 flex flex-wrap items-center justify-center gap-2">
      <slot />
    </div>
  </div>
</template>
