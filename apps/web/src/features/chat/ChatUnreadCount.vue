<script setup lang="ts">
/**
 * The rail's unread count (D-CHATUI5, re-toned 2026-11-01 by D-CHATUI22).
 *
 * It sat on `brand-accent-strong` with `text-ink`: in dark mode a muddy purple under grey figures,
 * the first thing the owner's "outdated" screenshot showed. It now wears the action pair, which
 * `lint:ui-contrast` holds at 4.5:1 in both schemes ("action foreground / action"). Still quiet —
 * no red anywhere in the rail — and a muted item never draws this; it shows a plain grey figure.
 */
defineProps<{ count: number; muted?: boolean }>();
</script>

<template>
  <span
    v-if="count > 0"
    class="shrink-0 tabular-nums"
    :class="muted ? 'text-2xs text-ink-tertiary' : 'min-w-5 rounded-full bg-action-primary px-1.5 py-0.5 text-center text-2xs font-semibold text-action-primary-foreground'"
    :aria-label="`${count} unread`"
  >{{ count > 99 ? "99+" : count }}</span>
</template>
