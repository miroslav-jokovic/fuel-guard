<script setup lang="ts">
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The notice §391.21(d) requires "before an application is submitted" — that the (b)(10) employers will
 * be contacted and what they send used — and the §391.23(i) rights it must be given in writing (C3c2a).
 *
 * ⚠ Plan §4 recorded it as delivered, but buried: inside the previous-employer release signed in Part 1,
 * weeks before the application exists. This is the standalone screen §4 called for, on the one screen
 * every application passes through before it is sent. The words are the regulation's, sourced and
 * tested in `strings.hub.ts`.
 */
const copy = APPLY_COPY.employerCheck;
</script>

<template>
  <section class="space-y-3 rounded-surface bg-surface-muted p-4" aria-labelledby="employer-check-heading">
    <h3 id="employer-check-heading" class="text-sm font-semibold text-ink">{{ copy.heading }}</h3>
    <p class="text-sm text-ink-secondary">{{ copy.use }}</p>
    <p class="text-sm text-ink-secondary">{{ copy.rightsIntro }}</p>
    <ul class="list-disc space-y-1 pl-5 text-sm text-ink-secondary">
      <li v-for="right in copy.rights" :key="right">{{ right }}</li>
    </ul>
    <p v-for="line in copy.howTo" :key="line" class="text-sm text-ink-secondary">{{ line }}</p>
  </section>
</template>
