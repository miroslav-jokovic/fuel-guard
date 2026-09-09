<script setup lang="ts">
/**
 * The sticky header and the connectivity strip a walk carries (D-INV19; plan I5 PR 2b, I9).
 *
 * ── COUNTS, NEVER PERCENT ─────────────────────────────────────────────────────────────────────
 * "12 of 40 · 3 short" is what somebody reads at a glance while holding a phone in one hand. "30 %"
 * is not a number of bins and not a number of straps, and nobody can act on it.
 *
 * ── THE STRIP APPEARS ONLY WHEN SOMETHING IS WAITING ──────────────────────────────────────────
 * It is a promise being kept, not a status light. A strip that was always there would be furniture,
 * and the one time it matters — a technician behind a container with four unsent entries — it would
 * read as part of the chrome rather than as the answer to "did that save".
 */
defineProps<{
  title: string;
  /** "12 of 40 · 3 short · blind" — assembled by the body, which knows what it is counting. */
  progress: string;
  queued: number;
}>();
</script>

<template>
  <header class="sticky top-0 z-raised -mx-4 border-b border-edge bg-surface px-4 py-3">
    <p class="text-lg font-semibold text-ink">{{ title }}</p>
    <p class="mt-0.5 text-sm text-ink-secondary">{{ progress }}</p>
  </header>

  <div
    v-if="queued > 0"
    class="rounded-control bg-warning-50 px-3 py-2 text-xs text-warning-700 ring-1 ring-inset ring-warning-600/20"
  >
    Saving on this phone — will sync when connected. {{ queued }} waiting.
  </div>
</template>
