<script setup lang="ts">
import {
  AppCheckbox,
  AppCombobox as ComboSelect,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppMemorableDate,
  AppRadioGroup,
} from "@silvicom/ui";
import { CDL_CLASSES, ENDORSEMENT_CODES, US_JURISDICTION_CODES, jurisdictionOptions } from "@silvicom/shared";
import YesNoField from "@/features/apply/YesNoField.vue";
import type { PartOneAnswers, PartOneScreen, ScreenErrors } from "./partOneScreens";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The fields of Part 1's typed screens — 3 (about you), 4 (address), 5 (the CDL) and 7 (screening) —
 * one screen at a time (D-AW11: one thing per page). Screen 6's loop and the photo and rights screens
 * are their own components, because each carries state or content these do not.
 *
 * It owns nothing: the answers are `usePartOne`'s, mutated in place, and the errors are the ones its
 * Continue found — so what the screen shows and what the walk checks cannot disagree.
 */
defineProps<{ screen: PartOneScreen; errors: ScreenErrors }>();
const answers = defineModel<PartOneAnswers>("answers", { required: true });
const copy = APPLY_COPY.partOne;
const US_STATES = jurisdictionOptions().filter((o) => US_JURISDICTION_CODES.has(o.value));
const JURISDICTIONS = jurisdictionOptions();

function toggleEndorsement(code: string, on: boolean): void {
  const set = new Set(answers.value.cdl.endorsements);
  if (on) set.add(code); else set.delete(code);
  answers.value.cdl.endorsements = ENDORSEMENT_CODES.filter((c) => set.has(c));
}
</script>

<template>
  <div v-if="screen === 'about'" class="space-y-4">
    <FormField id="p1-phone" :label="copy.about.phone" :hint="copy.about.phoneHint" :error="errors.phone">
      <template #default="f">
        <BaseInput v-bind="f" v-model="answers.phone" type="tel" inputmode="tel" autocomplete="tel-national" />
      </template>
    </FormField>
    <FormField id="p1-dob" :label="copy.about.dateOfBirth" :hint="copy.about.dateOfBirthHint" :error="errors.date_of_birth">
      <template #default="f">
        <AppMemorableDate v-bind="f" v-model="answers.date_of_birth" autocomplete="bday" :invalid="Boolean(errors.date_of_birth)" />
      </template>
    </FormField>
  </div>

  <div v-else-if="screen === 'address'" class="space-y-4">
    <FormField id="p1-line1" :label="copy.address.line1" :error="errors.address_line1">
      <template #default="f"><BaseInput v-bind="f" v-model="answers.address_line1" autocomplete="address-line1" /></template>
    </FormField>
    <FormField id="p1-line2" :label="copy.address.line2">
      <template #default="f"><BaseInput v-bind="f" v-model="answers.address_line2" autocomplete="address-line2" /></template>
    </FormField>
    <FormField id="p1-city" :label="copy.address.city" :error="errors.city">
      <template #default="f"><BaseInput v-bind="f" v-model="answers.city" autocomplete="address-level2" /></template>
    </FormField>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField id="p1-state" :label="copy.address.state" :error="errors.state">
        <template #default="f"><ComboSelect v-bind="f" v-model="answers.state" :options="US_STATES" /></template>
      </FormField>
      <FormField id="p1-zip" :label="copy.address.postalCode" :error="errors.postal_code">
        <template #default="f">
          <BaseInput v-bind="f" v-model="answers.postal_code" inputmode="numeric" maxlength="5" autocomplete="postal-code" />
        </template>
      </FormField>
    </div>
  </div>

  <div v-else-if="screen === 'licence'" class="space-y-4">
    <FormField id="p1-cdl-state" :label="copy.licence.state" :hint="copy.licence.stateHint" :error="errors.state_code">
      <template #default="f"><ComboSelect v-bind="f" v-model="answers.cdl.state_code" :options="JURISDICTIONS" /></template>
    </FormField>
    <FormField id="p1-cdl-number" :label="copy.licence.number" :error="errors.licence_number">
      <template #default="f"><BaseInput v-bind="f" v-model="answers.cdl.licence_number" autocomplete="off" /></template>
    </FormField>
    <div>
      <AppRadioGroup
        v-model="answers.cdl.cdl_class"
        :legend="copy.licence.cdlClass"
        :options="CDL_CLASSES.map((c) => ({ value: c, label: c }))"
      />
      <p v-if="errors.cdl_class" class="mt-1 text-sm text-danger-700" role="alert">{{ errors.cdl_class }}</p>
    </div>
    <FormField id="p1-cdl-expires" :label="copy.licence.expiresOn" :error="errors.expires_on">
      <template #default="f">
        <AppMemorableDate v-bind="f" v-model="answers.cdl.expires_on" :invalid="Boolean(errors.expires_on)" />
      </template>
    </FormField>
    <fieldset>
      <legend class="text-sm font-medium text-ink-secondary">{{ copy.licence.endorsements }}</legend>
      <AppCheckbox
        v-for="code in ENDORSEMENT_CODES"
        :key="code"
        :model-value="answers.cdl.endorsements.includes(code)"
        :label="copy.licence.endorsementLabels[code]"
        @update:model-value="toggleEndorsement(code, $event)"
      />
    </fieldset>
  </div>

  <div v-else-if="screen === 'screening'" class="space-y-5">
    <YesNoField v-model="answers.prior_positive_2y" :legend="copy.screening.priorPositive" :error="errors.prior_positive_2y" />
    <YesNoField
      v-model="answers.dot_program_30d"
      :legend="copy.screening.program30d"
      :hint="copy.screening.programHint"
      :error="errors.dot_program_30d"
    />
    <template v-if="answers.dot_program_30d">
      <YesNoField v-model="answers.dot_tested_6m" :legend="copy.screening.tested6m" :error="errors.dot_tested_6m" />
      <YesNoField v-model="answers.dot_random_12m" :legend="copy.screening.random12m" :error="errors.dot_random_12m" />
    </template>
  </div>
</template>
