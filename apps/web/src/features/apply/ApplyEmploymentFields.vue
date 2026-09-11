<script setup lang="ts">
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppCombobox as ComboSelect,
  AppInput as BaseInput,
  AppDateField,
  AppMonthField,
  AppSelect as BaseSelect,
} from "@silvicom/ui";
import { EQUIPMENT_CLASSES, EQUIPMENT_CLASS_LABELS, jurisdictionOptions } from "@silvicom/shared";
import { emptyEmployer, emptyEquipment, type ApplicationDraft } from "@/features/apply/draft";
import ApplyField from "@/features/apply/ApplyField.vue";
import { APPLY_COPY } from "@/features/apply/strings";

/** The classes §391.21(b)(6) and FMCSA's own form name, in the order that form lists them. */
const EQUIPMENT_OPTIONS = EQUIPMENT_CLASSES.map((value) => ({ value, label: EQUIPMENT_CLASS_LABELS[value] }));

/** One catalogue, three fields (D-AX5). */
const JURISDICTIONS = jurisdictionOptions();

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
          <ApplyField v-slot="f" :path="['employers', i, 'employer_name']" :label="copy.employer">
            <BaseInput v-bind="f" v-model="employer.employer_name" />
          </ApplyField>
          <ApplyField v-slot="f" :path="['employers', i, 'usdot_number']" :label="copy.usdot" :hint="copy.usdotHint">
            <BaseInput v-bind="f" v-model="employer.usdot_number" placeholder="Optional" />
          </ApplyField>
        </div>
        <ApplyField
v-slot="f"
          :path="['employers', i, 'address_line1']"
          :label="copy.address"
          :hint="copy.addressHint"
        >
          <BaseInput v-bind="f" v-model="employer.address_line1" />
        </ApplyField>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <ApplyField v-slot="f" :path="['employers', i, 'city']" :label="copy.city">
            <BaseInput v-bind="f" v-model="employer.city" />
          </ApplyField>
          <ApplyField v-slot="f" :path="['employers', i, 'state']" :label="copy.state">
            <ComboSelect v-bind="f" v-model="employer.state" :options="JURISDICTIONS" />
          </ApplyField>
          <ApplyField v-slot="f" :path="['employers', i, 'phone']" :label="copy.phone" :hint="copy.phoneHint">
            <BaseInput v-bind="f" v-model="employer.phone" type="tel" />
          </ApplyField>
          <ApplyField v-slot="f" :path="['employers', i, 'email']" :label="copy.email" :hint="copy.emailHint">
            <BaseInput v-bind="f" v-model="employer.email" type="email" placeholder="Optional" />
          </ApplyField>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ApplyField v-slot="f" :path="['employers', i, 'position_held']" :label="copy.position">
            <BaseInput v-bind="f" v-model="employer.position_held" />
          </ApplyField>
          <ApplyField v-slot="f" :path="['employers', i, 'started_on']" :label="copy.from">
            <AppDateField v-bind="f" v-model="employer.started_on" />
          </ApplyField>
          <ApplyField v-slot="f" :path="['employers', i, 'ended_on']" :label="copy.to" :hint="copy.toHint">
            <AppDateField v-bind="f" v-model="employer.ended_on" />
          </ApplyField>
        </div>
        <ApplyField v-slot="f" :path="['employers', i, 'reason_for_leaving']" :label="copy.reason" :hint="copy.reasonHint">
          <BaseInput v-bind="f" v-model="employer.reason_for_leaving" />
        </ApplyField>

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

    <!-- §391.21(b)(6) asks for two things in one sentence: "the nature and extent of the applicant's
         experience in the operation of motor vehicles, INCLUDING THE TYPE OF EQUIPMENT ... which
         he/she has operated". The narrative answers the first half; the rows below answer the second,
         laid out as FMCSA's own sample application lays it out. Either satisfies the paragraph, and
         a cross-field rule refuses a document with neither. -->
    <ApplyField v-slot="f" :path="['experience']" :label="copy.experience" :hint="copy.experienceHint">
      <BaseInput v-bind="f" v-model="draft.experience" placeholder="Optional" />
    </ApplyField>

    <div class="space-y-3">
      <div>
        <p class="text-sm font-medium text-ink">{{ copy.equipmentHeading }}</p>
        <p class="mt-1 text-xs text-ink-muted">{{ copy.equipmentIntro }}</p>
      </div>

      <div
        v-for="(row, i) in draft.equipment_experience"
        :key="i"
        class="space-y-3 rounded-surface bg-surface-muted p-4"
      >
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ApplyField v-slot="f" :path="['equipment_experience', i, 'equipment_class']" :label="copy.equipmentClass">
            <BaseSelect v-bind="f" v-model="row.equipment_class" :options="EQUIPMENT_OPTIONS" />
          </ApplyField>
          <ApplyField v-slot="f" :path="['equipment_experience', i, 'equipment_type']" :label="copy.equipmentType" :hint="copy.equipmentTypeHint">
            <BaseInput v-bind="f" v-model="row.equipment_type" />
          </ApplyField>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ApplyField v-slot="f" :path="['equipment_experience', i, 'from']" :label="copy.equipmentFrom" :hint="copy.equipmentMonthHint">
            <AppMonthField v-bind="f" v-model="row.from" />
          </ApplyField>
          <ApplyField v-slot="f" :path="['equipment_experience', i, 'to']" :label="copy.equipmentTo" :hint="copy.equipmentToHint">
            <AppMonthField v-bind="f" v-model="row.to" />
          </ApplyField>
          <ApplyField v-slot="f" :path="['equipment_experience', i, 'approx_miles']" :label="copy.equipmentMiles" :hint="copy.equipmentMilesHint">
            <BaseInput v-bind="f" v-model="row.approx_miles" inputmode="numeric" />
          </ApplyField>
        </div>
        <div class="flex justify-end">
          <BaseButton variant="ghost" size="sm" @click="draft.equipment_experience.splice(i, 1)">
            {{ copy.remove }}
          </BaseButton>
        </div>
      </div>

      <BaseButton variant="secondary" @click="draft.equipment_experience.push(emptyEquipment())">
        {{ copy.addEquipment }}
      </BaseButton>
    </div>
  </section>
</template>
