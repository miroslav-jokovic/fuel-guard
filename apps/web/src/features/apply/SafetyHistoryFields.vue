<script setup lang="ts">
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppInput as BaseInput,
  AppDateField,
  AppFormField as FormField,
} from "@fuelguard/ui";
import { emptyAccident, emptyViolation, type ApplicationDraft } from "@/features/apply/draft";

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
</script>

<template>
  <section class="space-y-6">
    <div>
      <h2 class="text-base font-semibold text-ink">Your safety history</h2>
      <p class="mt-1 text-sm text-ink-muted">
        These three questions come from §391.21(b)(7)–(9) and cover the last three years.
      </p>
    </div>

    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-ink">Accidents</h3>
      <BaseCheckbox v-model="draft.declares_no_accidents">
        I have had no accidents in the last 3 years
      </BaseCheckbox>

      <template v-if="!draft.declares_no_accidents">
        <div
          v-for="(accident, i) in draft.accidents"
          :key="i"
          class="space-y-4 rounded-surface bg-surface-muted p-4"
        >
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField v-slot="{ id }" label="Date">
              <AppDateField :id="id" v-model="accident.occurred_on" />
            </FormField>
            <FormField v-slot="{ id }" label="What happened">
              <BaseInput :id="id" v-model="accident.nature" />
            </FormField>
          </div>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField v-slot="{ id }" label="Fatalities">
              <BaseInput :id="id" v-model="accident.fatalities" inputmode="numeric" />
            </FormField>
            <FormField v-slot="{ id }" label="Injuries">
              <BaseInput :id="id" v-model="accident.injuries" inputmode="numeric" />
            </FormField>
          </div>
          <BaseCheckbox v-model="accident.hazmat_spill">Hazardous material was spilled</BaseCheckbox>
          <div class="flex justify-end">
            <BaseButton variant="ghost" size="sm" @click="draft.accidents.splice(i, 1)">Remove</BaseButton>
          </div>
        </div>
        <BaseButton @click="draft.accidents.push(emptyAccident())">Add an accident</BaseButton>
      </template>
    </div>

    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-ink">Traffic convictions</h3>
      <BaseCheckbox v-model="draft.declares_no_violations">
        I have had no traffic convictions or forfeitures in the last 3 years
      </BaseCheckbox>

      <template v-if="!draft.declares_no_violations">
        <div
          v-for="(violation, i) in draft.violations"
          :key="i"
          class="space-y-4 rounded-surface bg-surface-muted p-4"
        >
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField v-slot="{ id }" label="Date">
              <AppDateField :id="id" v-model="violation.occurred_on" />
            </FormField>
            <FormField v-slot="{ id }" label="Offence">
              <BaseInput :id="id" v-model="violation.offence" />
            </FormField>
          </div>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField v-slot="{ id }" label="Where" hint="Optional.">
              <BaseInput :id="id" v-model="violation.location" placeholder="Optional" />
            </FormField>
            <FormField v-slot="{ id }" label="Penalty" hint="Optional.">
              <BaseInput :id="id" v-model="violation.penalty" placeholder="Optional" />
            </FormField>
          </div>
          <div class="flex justify-end">
            <BaseButton variant="ghost" size="sm" @click="draft.violations.splice(i, 1)">Remove</BaseButton>
          </div>
        </div>
        <BaseButton @click="draft.violations.push(emptyViolation())">Add a conviction</BaseButton>
      </template>
    </div>

    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-ink">Licence history</h3>
      <BaseCheckbox v-model="draft.licence_ever_denied">
        A licence, permit or privilege of mine has been denied, revoked or suspended
      </BaseCheckbox>
      <FormField
        v-if="draft.licence_ever_denied"
        v-slot="{ id }"
        label="What happened"
        hint="§391.21(b)(9) asks for the reason."
      >
        <BaseInput :id="id" v-model="draft.licence_denial_detail" />
      </FormField>
    </div>
  </section>
</template>
