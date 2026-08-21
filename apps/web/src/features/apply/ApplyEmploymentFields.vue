<script setup lang="ts">
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppInput as BaseInput,
  AppDateField,
  AppFormField as FormField,
} from "@fuelguard/ui";
import { emptyEmployer, type ApplicationDraft } from "@/features/apply/draft";
import { APPLY_COPY } from "@/features/apply/strings";

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
const copy = APPLY_COPY.employment;
</script>

<template>
  <section class="space-y-4">
    <p class="text-sm text-ink-muted">{{ copy.intro }}</p>

    <BaseCheckbox v-model="draft.declares_no_employment">{{ copy.none }}</BaseCheckbox>

    <template v-if="!draft.declares_no_employment">
      <div
        v-for="(employer, i) in draft.employers"
        :key="i"
        class="space-y-4 rounded-surface bg-surface-muted p-4"
      >
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" :label="copy.employer">
            <BaseInput :id="id" v-model="employer.employer_name" />
          </FormField>
          <FormField v-slot="{ id }" :label="copy.usdot" :hint="copy.usdotHint">
            <BaseInput :id="id" v-model="employer.usdot_number" placeholder="Optional" />
          </FormField>
        </div>
        <FormField
          v-slot="{ id }"
          :label="copy.address"
          :hint="copy.addressHint"
        >
          <BaseInput :id="id" v-model="employer.address_line1" />
        </FormField>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <FormField v-slot="{ id }" :label="copy.city">
            <BaseInput :id="id" v-model="employer.city" />
          </FormField>
          <FormField v-slot="{ id }" :label="copy.state">
            <BaseInput :id="id" v-model="employer.state" maxlength="2" />
          </FormField>
          <FormField v-slot="{ id }" :label="copy.phone" :hint="copy.phoneHint">
            <BaseInput :id="id" v-model="employer.phone" type="tel" />
          </FormField>
          <FormField v-slot="{ id }" :label="copy.email" :hint="copy.emailHint">
            <BaseInput :id="id" v-model="employer.email" type="email" placeholder="Optional" />
          </FormField>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField v-slot="{ id }" :label="copy.position">
            <BaseInput :id="id" v-model="employer.position_held" />
          </FormField>
          <FormField v-slot="{ id }" :label="copy.from">
            <AppDateField :id="id" v-model="employer.started_on" />
          </FormField>
          <FormField v-slot="{ id }" :label="copy.to" :hint="copy.toHint">
            <AppDateField :id="id" v-model="employer.ended_on" />
          </FormField>
        </div>
        <FormField v-slot="{ id }" :label="copy.reason" :hint="copy.reasonHint">
          <BaseInput :id="id" v-model="employer.reason_for_leaving" />
        </FormField>

        <div class="space-y-2">
          <BaseCheckbox v-model="employer.operated_cmv">{{ copy.operatedCmv }}</BaseCheckbox>
          <BaseCheckbox v-model="employer.dot_regulated">{{ copy.dotRegulated }}</BaseCheckbox>
          <!-- §40.25(j): asked of the applicant because the answer is theirs, and a yes changes what
               §40.25 obliges the carrier to chase from that employer. -->
          <BaseCheckbox v-model="employer.safety_sensitive">{{ copy.safetySensitive }}</BaseCheckbox>
          <BaseCheckbox v-model="employer.subject_to_fmcsr">{{ copy.subjectToFmcsr }}</BaseCheckbox>
        </div>

        <div v-if="draft.employers.length > 1" class="flex justify-end">
          <BaseButton variant="ghost" size="sm" @click="draft.employers.splice(i, 1)">{{ copy.remove }}</BaseButton>
        </div>
      </div>

      <BaseButton @click="draft.employers.push(emptyEmployer())">{{ copy.add }}</BaseButton>
    </template>

    <!-- §391.21(b)(6): "the nature and extent of the applicant's experience in the operation of
         motor vehicles, including the type of equipment". It reads as the preamble to (b)(10)
         rather than as a licence detail, so it is answered here. -->
    <FormField v-slot="{ id }" :label="copy.experience" :hint="copy.experienceHint">
      <BaseInput :id="id" v-model="draft.experience" placeholder="Optional" />
    </FormField>
  </section>
</template>
