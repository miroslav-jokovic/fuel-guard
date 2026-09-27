<script setup lang="ts">
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * Screen 20's one action (§6.2): register with the Clearinghouse. The carrier's full query needs the
 * driver's consent given INSIDE the Clearinghouse (D-AW5 records that it was given), and only the driver
 * can register — so a waiting driver who does it now removes a day from their own hire. Shown on the
 * "permissions received" screen of a v2 link, beside the text-message card that screen already carries.
 */
defineProps<{ carrier: string }>();
const copy = APPLY_COPY.partOne.clearinghouse;
</script>

<template>
  <div class="mt-5 rounded-surface bg-surface-muted p-4">
    <h2 class="text-sm font-semibold text-ink">{{ copy.heading }}</h2>
    <p class="mt-2 text-sm text-ink-muted">{{ copy.body(carrier) }}</p>
    <ol class="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-secondary">
      <li v-for="(step, i) in copy.steps" :key="i">{{ typeof step === "function" ? step(carrier) : step }}</li>
    </ol>
    <a
      :href="copy.url"
      target="_blank"
      rel="noopener noreferrer"
      class="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-action-primary underline"
    >{{ copy.link }}</a>
    <p class="mt-1 text-xs text-ink-tertiary">{{ copy.already }}</p>
  </div>
</template>
