<script setup lang="ts">
import { AppCard as BaseCard } from "@silvicom/ui";

/**
 * The card both tabs answer inside — a heading, one sentence of what the rows decide, and the
 * staleness note that belongs to THIS kind of row (D-PERM6 for sections, D-SURF4 for screens).
 *
 * The note sits in the card header rather than in a page-level callout because the two contracts
 * differ and a reader has to meet the right one beside the control it governs. The page used to say
 * both in one paragraph at the top; that is where "which one applies to the thing I just changed"
 * got lost.
 */
defineProps<{ title: string; description: string; note: string }>();
</script>

<template>
  <BaseCard as="section" padding="none" :aria-label="title">
    <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-edge-subtle px-5 py-4">
      <div class="min-w-0">
        <h3 class="text-sm font-semibold text-ink">{{ title }}</h3>
        <p class="mt-1 text-sm text-ink-muted">{{ description }}</p>
      </div>
      <p class="text-xs text-ink-tertiary">{{ note }}</p>
    </div>
    <slot />
  </BaseCard>
</template>
