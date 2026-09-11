<script setup lang="ts">
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppInput as BaseInput,
  AppDateField,
} from "@silvicom/ui";
import { emptyAccident, emptyViolation, type ApplicationDraft } from "@/features/apply/draft";
import ApplyField from "@/features/apply/ApplyField.vue";
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
            <ApplyField v-slot="f" :path="['accidents', i, 'occurred_on']" :label="copy.accidentDate">
              <AppDateField v-bind="f" v-model="accident.occurred_on" />
            </ApplyField>
            <ApplyField v-slot="f" :path="['accidents', i, 'nature']" :label="copy.accidentNature">
              <BaseInput v-bind="f" v-model="accident.nature" />
            </ApplyField>
          </div>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ApplyField v-slot="f" :path="['accidents', i, 'fatalities']" :label="copy.fatalities">
              <BaseInput v-bind="f" v-model="accident.fatalities" inputmode="numeric" />
            </ApplyField>
            <ApplyField v-slot="f" :path="['accidents', i, 'injuries']" :label="copy.injuries">
              <BaseInput v-bind="f" v-model="accident.injuries" inputmode="numeric" />
            </ApplyField>
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
            <ApplyField v-slot="f" :path="['violations', i, 'occurred_on']" :label="copy.violationDate">
              <AppDateField v-bind="f" v-model="violation.occurred_on" />
            </ApplyField>
            <ApplyField v-slot="f" :path="['violations', i, 'offence']" :label="copy.offence">
              <BaseInput v-bind="f" v-model="violation.offence" />
            </ApplyField>
          </div>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ApplyField v-slot="f" :path="['violations', i, 'state']" :label="copy.violationState" :hint="copy.violationStateHint">
              <BaseInput v-bind="f" v-model="violation.state" placeholder="Optional" />
            </ApplyField>
            <ApplyField v-slot="f" :path="['violations', i, 'penalty']" :label="copy.penalty" :hint="copy.penaltyHint">
              <BaseInput v-bind="f" v-model="violation.penalty" placeholder="Optional" />
            </ApplyField>
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
      <ApplyField
v-if="draft.licence_ever_denied"
        v-slot="f"
        :path="['licence_denial_detail']"
        :label="copy.denialDetail"
        :hint="copy.denialDetailHint"
      >
        <BaseInput v-bind="f" v-model="draft.licence_denial_detail" />
      </ApplyField>
    </div>

    <!-- §40.25(j) (P8). The carrier's packet gives this a page of its own; here it is the last block
         of the driving-record screen, because a wizard step exists per REGULATION-shaped group of
         answers and an eighth screen for one checkbox is a step somebody abandons on. The intro says
         what a yes means before the box is offered — see the copy's own note. -->
    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-ink">{{ copy.priorTestHeading }}</h3>
      <p class="text-sm text-ink-muted">{{ copy.priorTestIntro }}</p>
      <BaseCheckbox v-model="draft.prior_failed_pre_employment_test">{{ copy.priorTest }}</BaseCheckbox>
      <p class="text-xs text-ink-muted">{{ copy.priorTestHint }}</p>
    </div>
  </section>
</template>
