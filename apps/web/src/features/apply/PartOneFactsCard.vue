<script setup lang="ts">
import CorrectionNote from "@/features/apply/CorrectionNote.vue";
import type { ApplicationDraft } from "@/features/apply/draft";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * Part 1's facts on a Part 2 screen, read-only, with "Something wrong? Tell us" under them (C3c2c2,
 * Q-AW34). The screens decide WHICH facts (`ApplicantDetailsFields`, `LicenceFields`); this is how they
 * look, once, so the two screens cannot drift into two presentations of the same kind of fact.
 */
defineProps<{ rows: ReadonlyArray<{ label: string; value: string }> }>();
const draft = defineModel<ApplicationDraft>({ required: true });
const copy = APPLY_COPY.partOneFacts;
</script>

<template>
  <section class="space-y-3 rounded-surface bg-surface-muted p-4" data-part-one-facts>
    <div>
      <h3 class="text-sm font-semibold text-ink">{{ copy.heading }}</h3>
      <p class="mt-1 text-xs text-ink-muted">{{ copy.intro }}</p>
    </div>
    <dl class="space-y-2">
      <div v-for="row in rows" :key="row.label + row.value">
        <dt class="text-xs text-ink-muted">{{ row.label }}</dt>
        <dd class="text-sm text-ink">{{ row.value }}</dd>
      </div>
    </dl>
    <CorrectionNote v-model="draft" />
  </section>
</template>
