<script setup lang="ts">
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppInput as BaseInput,
  AppDateField,
  AppFormField as FormField,
} from "@fuelguard/ui";
import { CMV_WINDOW_YEARS, EMPLOYMENT_WINDOW_YEARS } from "@fuelguard/shared";
import { emptyEmployer, type ApplicationDraft } from "@/features/apply/draft";

/**
 * §391.21(b)(10) and (b)(11) — and the reason the instructions below are worded so carefully.
 *
 * The regulation asks two different questions over two different windows: everything you did for
 * three years, then only the commercial driving for the seven before that (D-HIRE1). An applicant
 * told "list ten years of employment" will either over-report and be asked to explain a warehouse
 * job from 2019, or give up. The form asks for what is actually required and sorts the entries
 * itself, because the boundary is ours to compute and not theirs to remember.
 */
const draft = defineModel<ApplicationDraft>({ required: true });
</script>

<template>
  <section class="space-y-4">
    <div>
      <h2 class="text-base font-semibold text-ink">Where you have worked</h2>
      <p class="mt-1 text-sm text-ink-muted">
        List every job — driving or not — from the last {{ EMPLOYMENT_WINDOW_YEARS }} years. For the
        {{ CMV_WINDOW_YEARS - EMPLOYMENT_WINDOW_YEARS }} years before that, list only the jobs where
        you drove a commercial vehicle. Time you were not driving is not a gap you need to explain.
      </p>
    </div>

    <BaseCheckbox v-model="draft.declares_no_employment">
      I have not been employed during this period
    </BaseCheckbox>

    <template v-if="!draft.declares_no_employment">
      <div
        v-for="(employer, i) in draft.employers"
        :key="i"
        class="space-y-4 rounded-surface bg-surface-muted p-4"
      >
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="Employer">
            <BaseInput :id="id" v-model="employer.employer_name" />
          </FormField>
          <FormField v-slot="{ id }" label="USDOT number" hint="Optional — leave blank if you do not know it.">
            <BaseInput :id="id" v-model="employer.usdot_number" placeholder="Optional" />
          </FormField>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField v-slot="{ id }" label="City">
            <BaseInput :id="id" v-model="employer.city" />
          </FormField>
          <FormField v-slot="{ id }" label="State">
            <BaseInput :id="id" v-model="employer.state" maxlength="2" />
          </FormField>
          <FormField v-slot="{ id }" label="Phone" hint="So we can contact them.">
            <BaseInput :id="id" v-model="employer.phone" type="tel" />
          </FormField>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField v-slot="{ id }" label="Position">
            <BaseInput :id="id" v-model="employer.position_held" />
          </FormField>
          <FormField v-slot="{ id }" label="From">
            <AppDateField :id="id" v-model="employer.started_on" />
          </FormField>
          <FormField v-slot="{ id }" label="Until" hint="Blank if you work there now.">
            <AppDateField :id="id" v-model="employer.ended_on" />
          </FormField>
        </div>
        <FormField v-slot="{ id }" label="Reason for leaving" hint="§391.21(b)(10) asks for it.">
          <BaseInput :id="id" v-model="employer.reason_for_leaving" />
        </FormField>

        <div class="space-y-2">
          <BaseCheckbox v-model="employer.operated_cmv">I drove a commercial vehicle in this job</BaseCheckbox>
          <BaseCheckbox v-model="employer.dot_regulated">This employer was DOT-regulated</BaseCheckbox>
          <!-- §40.25(j): asked of the applicant because the answer is theirs, and a yes changes what
               §40.25 obliges the carrier to chase from that employer. -->
          <BaseCheckbox v-model="employer.safety_sensitive">
            This job was safety-sensitive under DOT drug and alcohol rules
          </BaseCheckbox>
          <BaseCheckbox v-model="employer.subject_to_fmcsr">
            This job was subject to the federal motor carrier safety regulations
          </BaseCheckbox>
        </div>

        <div v-if="draft.employers.length > 1" class="flex justify-end">
          <BaseButton variant="ghost" size="sm" @click="draft.employers.splice(i, 1)">Remove</BaseButton>
        </div>
      </div>

      <BaseButton @click="draft.employers.push(emptyEmployer())">Add another employer</BaseButton>
    </template>
  </section>
</template>
