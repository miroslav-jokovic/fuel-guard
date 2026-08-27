<script setup lang="ts">
import { AppButton as BaseButton, AppInput as BaseInput, AppDateField, AppFormField as FormField } from "@silvicom/ui";
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
 *
 * ⚠ "Other names" is on this screen and is NOT a (b)(2) field — that paragraph lists name, address,
 * date of birth and social security number, and FMCSA's own sample application asks for no other
 * name. It is here because it is where a person types their names, and it exists for §391.23(a)(2):
 * an employer cannot verify three years for somebody their records know by a different name. The copy
 * says exactly that, because being asked for a maiden name with no reason given is the other kind of
 * abandonment spike.
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

    <!-- §391.23(a)(2), not §391.21(b)(2) — see the header. -->
    <div class="space-y-2">
      <p class="text-sm text-ink">{{ copy.otherNames }}</p>
      <p class="text-xs text-ink-muted">{{ copy.otherNamesHint }}</p>
      <div v-for="(_, i) in draft.other_names" :key="i" class="flex items-center gap-2">
        <BaseInput v-model="draft.other_names[i]" class="flex-1" autocomplete="off" />
        <BaseButton variant="ghost" size="sm" @click="draft.other_names.splice(i, 1)">
          {{ copy.remove }}
        </BaseButton>
      </div>
      <BaseButton variant="secondary" size="sm" @click="draft.other_names.push('')">
        {{ copy.addOtherName }}
      </BaseButton>
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
