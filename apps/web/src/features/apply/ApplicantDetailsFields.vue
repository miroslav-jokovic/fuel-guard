<script setup lang="ts">
import { AppInput as BaseInput, AppDateField, AppFormField as FormField } from "@fuelguard/ui";
import type { ApplicationDraft } from "@/features/apply/draft";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * §391.21(b)(2) — identity, and the one field on this form that is not saved as you go.
 *
 * The licence moved to `LicenceFields.vue` when the form became a wizard (A3): (b)(2) and (b)(5) are
 * different questions and, on a phone, different screens.
 *
 * The Social Security number is here because (b)(2) lists it, and it is OPTIONAL because PSP matches
 * on name/licence/state/date of birth and never needs it (D-HIRE6/Q-H2). Two sentences of copy do
 * the work that matters: why it is asked at all, and that it is the one answer autosave does not
 * keep — because `application_drafts` is prunable plain jsonb and nine digits do not go in it
 * (D-APP3). A sensitive field with no stated reason is an abandonment spike.
 */
const draft = defineModel<ApplicationDraft>({ required: true });
const copy = APPLY_COPY.identity;
</script>

<template>
  <section class="space-y-4">
    <p class="text-sm text-ink-muted">{{ copy.intro }}</p>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <FormField v-slot="{ id }" :label="copy.first_name">
        <BaseInput :id="id" v-model="draft.first_name" autocomplete="given-name" />
      </FormField>
      <FormField v-slot="{ id }" :label="copy.middle_name" :hint="copy.optional">
        <BaseInput :id="id" v-model="draft.middle_name" autocomplete="additional-name" />
      </FormField>
      <FormField v-slot="{ id }" :label="copy.last_name">
        <BaseInput :id="id" v-model="draft.last_name" autocomplete="family-name" />
      </FormField>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <FormField v-slot="{ id }" :label="copy.date_of_birth">
        <AppDateField :id="id" v-model="draft.date_of_birth" />
      </FormField>
      <FormField v-slot="{ id }" :label="copy.email">
        <BaseInput :id="id" v-model="draft.email" type="email" autocomplete="email" />
      </FormField>
      <FormField v-slot="{ id }" :label="copy.phone">
        <BaseInput :id="id" v-model="draft.phone" type="tel" autocomplete="tel" />
      </FormField>
    </div>

    <FormField v-slot="{ id }" :label="copy.ssn" :hint="copy.ssnHint">
      <BaseInput :id="id" v-model="draft.ssn" inputmode="numeric" autocomplete="off" />
    </FormField>
    <p class="text-xs text-ink-muted">{{ copy.ssnNotSaved }}</p>
  </section>
</template>
