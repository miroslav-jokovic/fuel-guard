<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import {
  EMPLOYMENT_INQUIRY_STATUSES,
  EMPLOYMENT_INQUIRY_LABELS,
  employmentHistoryCreateSchema,
  type EmploymentHistory,
} from "@fuelguard/shared";
import { AppInput as BaseInput } from "@fuelguard/ui";
import { AppDateField } from "@fuelguard/ui";
import { AppCheckbox } from "@fuelguard/ui";
import { AppTextarea } from "@fuelguard/ui";
import { AppCombobox as ComboSelect } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";

/**
 * One employer, as the application declares them. Validated against the SHARED create schema before
 * anything is sent, so the browser and the API refuse the same things for the same reasons.
 */
/**
 * BODY ONLY — no buttons. The design contract §6.2 puts a drawer's actions in `#footer`, reached from
 * here by `<form :id>` + `<BaseButton :form type="submit">`, so the footer stays pinned while a form
 * this tall scrolls.
 */
const props = defineProps<{
  formId: string;
  driverId: string;
  existing?: EmploymentHistory | null;
}>();
const emit = defineEmits<{ submit: [payload: Record<string, unknown>] }>();

const form = reactive({
  employer_name: "",
  usdot_number: "",
  employer_city: "",
  employer_state: "",
  employer_phone: "",
  position_held: "",
  started_on: "",
  ended_on: "",
  dot_regulated: true,
  reason_for_leaving: "",
  inquiry_status: "pending",
  inquiry_sent_on: "",
  inquiry_response_on: "",
  notes: "",
});

watch(
  () => props.existing?.id,
  () => {
    const e = props.existing;
    Object.assign(form, {
      employer_name: e?.employer_name ?? "",
      usdot_number: e?.usdot_number ?? "",
      employer_city: e?.employer_city ?? "",
      employer_state: e?.employer_state ?? "",
      employer_phone: e?.employer_phone ?? "",
      position_held: e?.position_held ?? "",
      started_on: e?.started_on ?? "",
      ended_on: e?.ended_on ?? "",
      dot_regulated: e?.dot_regulated ?? true,
      reason_for_leaving: e?.reason_for_leaving ?? "",
      inquiry_status: e?.inquiry_status ?? "pending",
      inquiry_sent_on: e?.inquiry_sent_on ?? "",
      inquiry_response_on: e?.inquiry_response_on ?? "",
      notes: e?.notes ?? "",
    });
    errors.value = {};
  },
  { immediate: true },
);

const errors = ref<Record<string, string>>({});

const inquiryOptions = EMPLOYMENT_INQUIRY_STATUSES.map((s) => ({
  value: s,
  label: EMPLOYMENT_INQUIRY_LABELS[s],
}));

function onSubmit(): void {
  // Parse the CREATE shape even when editing: it is the stricter of the two, so a form that passes it
  // passes the update schema by construction, and the field-level messages come out the same either way.
  const candidate = { ...form, driver_id: props.driverId, source: props.existing?.source ?? "application" };
  const result = employmentHistoryCreateSchema.safeParse(candidate);
  if (!result.success) {
    const map: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !map[key]) map[key] = issue.message;
    }
    errors.value = map;
    return;
  }
  errors.value = {};
  const { driver_id: _d, source: _s, ...fields } = result.data;
  emit("submit", props.existing ? fields : result.data);
}
</script>

<template>
  <form :id="formId" class="space-y-4" @submit.prevent="onSubmit">
    <FormField v-slot="{ id }" label="Employer" :error="errors.employer_name">
      <BaseInput :id="id" v-model="form.employer_name" :invalid="!!errors.employer_name" />
    </FormField>

    <div class="grid grid-cols-2 gap-3">
      <!-- The strong key a PSP inspection record joins on. Optional because drivers do not know it,
           and a guessed USDOT number is worse than an absent one. -->
      <FormField v-slot="{ id }" label="USDOT number" :error="errors.usdot_number">
        <BaseInput :id="id" v-model="form.usdot_number" :invalid="!!errors.usdot_number" placeholder="Optional" />
      </FormField>
      <FormField v-slot="{ id }" label="Position">
        <BaseInput :id="id" v-model="form.position_held" />
      </FormField>
    </div>

    <div class="grid grid-cols-3 gap-3">
      <FormField v-slot="{ id }" label="City">
        <BaseInput :id="id" v-model="form.employer_city" />
      </FormField>
      <FormField v-slot="{ id }" label="State">
        <BaseInput :id="id" v-model="form.employer_state" />
      </FormField>
      <FormField v-slot="{ id }" label="Phone">
        <BaseInput :id="id" v-model="form.employer_phone" />
      </FormField>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <FormField v-slot="{ id }" label="From" :error="errors.started_on">
        <AppDateField :id="id" v-model="form.started_on" :invalid="!!errors.started_on" />
      </FormField>
      <FormField v-slot="{ id }" label="To" :error="errors.ended_on">
        <AppDateField :id="id" v-model="form.ended_on" :invalid="!!errors.ended_on" />
      </FormField>
    </div>
    <p class="-mt-2 text-xs text-ink-muted">Leave "To" empty if the driver still works there.</p>

    <AppCheckbox v-model="form.dot_regulated" label="DOT-regulated employer" />
    <p class="-mt-2 text-xs text-ink-muted">
      Only a DOT-regulated employer owes a §391.23(a)(2) safety-history inquiry. Non-regulated work
      still counts towards the three-year employment record.
    </p>

    <FormField label="Safety-history inquiry">
      <ComboSelect v-model="form.inquiry_status" :options="inquiryOptions" />
    </FormField>

    <div class="grid grid-cols-2 gap-3">
      <FormField v-slot="{ id }" label="Inquiry sent">
        <AppDateField :id="id" v-model="form.inquiry_sent_on" />
      </FormField>
      <FormField v-slot="{ id }" label="Response received">
        <AppDateField :id="id" v-model="form.inquiry_response_on" />
      </FormField>
    </div>

    <FormField v-slot="{ id }" label="Reason for leaving">
      <BaseInput :id="id" v-model="form.reason_for_leaving" />
    </FormField>

    <FormField v-slot="{ id }" label="Notes">
      <AppTextarea :id="id" v-model="form.notes" :rows="2" />
    </FormField>

  </form>
</template>
