<script setup lang="ts">
/**
 * A screen that says the next move is the carrier's, not the applicant's — and nothing else.
 *
 * Two of them since AF4: permissions received and the application not yet sent (plan §3.1 row 5),
 * and the application handed over and not yet read (F4). They are the same shape on purpose — what
 * happened, what happens next, what to do meanwhile — so a driver who meets both reads them the same
 * way. Extracted from `ApplyPage.vue` when the second one arrived (500-line budget).
 */
defineProps<{ heading: string; body: string; note: string }>();
</script>

<template>
  <div>
    <h1 class="text-lg font-semibold text-ink">{{ heading }}</h1>
    <p class="mt-2 text-sm text-ink-muted">{{ body }}</p>
    <p class="mt-2 text-sm text-ink-muted">{{ note }}</p>
  </div>
</template>
