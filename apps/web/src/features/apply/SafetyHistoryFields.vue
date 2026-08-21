<script setup lang="ts">
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppInput as BaseInput,
  AppDateField,
  AppFormField as FormField,
} from "@fuelguard/ui";
import { emptyAccident, emptyViolation, type ApplicationDraft } from "@/features/apply/draft";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * §391.21(b)(7), (b)(8) and (b)(9) — accidents, convictions, and any denial of a licence.
 *
 * Each list has an explicit "none" checkbox rather than being answered by emptiness. An empty array
 * and an unanswered question look identical in storage, and the difference is the whole point: a
 * declaration of no accidents is a statement the applicant certified, and a blank form is somebody
 * who stopped reading. The PSP cross-match reads the first as an answer worth comparing against
 * FMCSA's crash file.
 */
const draft = defineModel<ApplicationDraft>({ required: true });
const copy = APPLY_COPY.safety;
</script>

<template>
  <section class="space-y-6">
    <p class="text-sm text-ink-muted">{{ copy.intro }}</p>

    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-ink">{{ copy.accidentsHeading }}</h3>
      <BaseCheckbox v-model="draft.declares_no_accidents">{{ copy.noAccidents }}</BaseCheckbox>

      <template v-if="!draft.declares_no_accidents">
        <div
          v-for="(accident, i) in draft.accidents"
          :key="i"
          class="space-y-4 rounded-surface bg-surface-muted p-4"
        >
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField v-slot="{ id }" :label="copy.accidentDate">
              <AppDateField :id="id" v-model="accident.occurred_on" />
            </FormField>
            <FormField v-slot="{ id }" :label="copy.accidentNature">
              <BaseInput :id="id" v-model="accident.nature" />
            </FormField>
          </div>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField v-slot="{ id }" :label="copy.fatalities">
              <BaseInput :id="id" v-model="accident.fatalities" inputmode="numeric" />
            </FormField>
            <FormField v-slot="{ id }" :label="copy.injuries">
              <BaseInput :id="id" v-model="accident.injuries" inputmode="numeric" />
            </FormField>
          </div>
          <BaseCheckbox v-model="accident.hazmat_spill">{{ copy.hazmatSpill }}</BaseCheckbox>
          <div class="flex justify-end">
            <BaseButton variant="ghost" size="sm" @click="draft.accidents.splice(i, 1)">{{ copy.remove }}</BaseButton>
          </div>
        </div>
        <BaseButton @click="draft.accidents.push(emptyAccident())">{{ copy.addAccident }}</BaseButton>
      </template>
    </div>

    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-ink">{{ copy.violationsHeading }}</h3>
      <BaseCheckbox v-model="draft.declares_no_violations">{{ copy.noViolations }}</BaseCheckbox>

      <template v-if="!draft.declares_no_violations">
        <div
          v-for="(violation, i) in draft.violations"
          :key="i"
          class="space-y-4 rounded-surface bg-surface-muted p-4"
        >
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField v-slot="{ id }" :label="copy.violationDate">
              <AppDateField :id="id" v-model="violation.occurred_on" />
            </FormField>
            <FormField v-slot="{ id }" :label="copy.offence">
              <BaseInput :id="id" v-model="violation.offence" />
            </FormField>
          </div>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField v-slot="{ id }" :label="copy.violationState" :hint="copy.violationStateHint">
              <BaseInput :id="id" v-model="violation.state" placeholder="Optional" />
            </FormField>
            <FormField v-slot="{ id }" :label="copy.penalty" :hint="copy.penaltyHint">
              <BaseInput :id="id" v-model="violation.penalty" placeholder="Optional" />
            </FormField>
          </div>
          <div class="flex justify-end">
            <BaseButton variant="ghost" size="sm" @click="draft.violations.splice(i, 1)">{{ copy.remove }}</BaseButton>
          </div>
        </div>
        <BaseButton @click="draft.violations.push(emptyViolation())">{{ copy.addViolation }}</BaseButton>
      </template>
    </div>

    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-ink">{{ copy.licenceHeading }}</h3>
      <BaseCheckbox v-model="draft.licence_ever_denied">{{ copy.everDenied }}</BaseCheckbox>
      <FormField
        v-if="draft.licence_ever_denied"
        v-slot="{ id }"
        :label="copy.denialDetail"
        :hint="copy.denialDetailHint"
      >
        <BaseInput :id="id" v-model="draft.licence_denial_detail" />
      </FormField>
    </div>
  </section>
</template>
