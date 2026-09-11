<script setup lang="ts">
import { AppButton as BaseButton, AppInput as BaseInput, AppDateField } from "@silvicom/ui";
import type { ApplicationDraft } from "@/features/apply/draft";
import ApplyField from "@/features/apply/ApplyField.vue";
import QuestionnaireFields from "@/features/apply/QuestionnaireFields.vue";
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
      <ApplyField v-slot="f" :path="['first_name']" :label="copy.first_name">
        <BaseInput v-bind="f" v-model="draft.first_name" autocomplete="given-name" />
      </ApplyField>
      <ApplyField v-slot="f" :path="['middle_name']" :label="copy.middle_name" :hint="copy.optional">
        <BaseInput v-bind="f" v-model="draft.middle_name" autocomplete="additional-name" />
      </ApplyField>
      <ApplyField v-slot="f" :path="['last_name']" :label="copy.last_name">
        <BaseInput v-bind="f" v-model="draft.last_name" autocomplete="family-name" />
      </ApplyField>
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
      <ApplyField v-slot="f" :path="['date_of_birth']" :label="copy.date_of_birth">
        <AppDateField v-bind="f" v-model="draft.date_of_birth" />
      </ApplyField>
      <ApplyField v-slot="f" :path="['email']" :label="copy.email">
        <BaseInput v-bind="f" v-model="draft.email" type="email" autocomplete="email" />
      </ApplyField>
      <ApplyField v-slot="f" :path="['phone']" :label="copy.phone">
        <BaseInput v-bind="f" v-model="draft.phone" type="tel" autocomplete="tel" />
      </ApplyField>
    </div>

    <!-- D-AX7: the carrier's own page-1 questions — the position applied for, how they heard about
         the company, and the two eligibility questions. They are asked here because that is where the
         carrier's paper asks them, and because "what job are you applying for?" was the sixth of nine
         steps, after the two heaviest screens in the form. -->
    <QuestionnaireFields v-model="draft" section="identity" />

    <!-- ⚠ The Social Security number is NOT here since F4. It moved to the signing screen, and it was
         forced rather than chosen: D-APP3 keeps it out of every saved draft, the application is now
         signed on a SECOND visit after the office has read it, and a number typed here would be gone
         by then. `SignOffFields.vue` says the rest. -->
  </section>
</template>
