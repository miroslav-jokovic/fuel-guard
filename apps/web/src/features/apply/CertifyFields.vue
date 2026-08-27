<script setup lang="ts">
import { AppCheckbox as BaseCheckbox, AppInput as BaseInput, AppFormField as FormField } from "@silvicom/ui";
import type { ApplicationDraft } from "@/features/apply/draft";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * §391.21(b)(12) — the certification, verbatim in substance: "This certifies that this application
 * was completed by me, and that all entries on it and information in it are true and complete to the
 * best of my knowledge."
 *
 * The DATE that paragraph also requires is not asked for. D-APP9: no date of signing or submission
 * is ever accepted from a request body — `driver_applications.certified_at` is stamped server-side,
 * which is also what satisfies §391.21(b)(4). The copy says so, because a signature block with no
 * date looks like an omission to anyone who has signed one on paper.
 */
const draft = defineModel<ApplicationDraft>({ required: true });
const copy = APPLY_COPY.certify;
</script>

<template>
  <section class="space-y-4">
    <p class="text-sm text-ink-muted">{{ copy.intro }}</p>
    <BaseCheckbox v-model="draft.certified">{{ copy.statement }}</BaseCheckbox>
    <FormField v-slot="{ id }" :label="copy.signedName">
      <BaseInput :id="id" v-model="draft.signed_name" autocomplete="name" />
    </FormField>
    <p class="text-xs text-ink-muted">{{ copy.dateNote }}</p>
  </section>
</template>
