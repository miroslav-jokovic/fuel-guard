<script setup lang="ts">
import { reactive } from "vue";
import { AppFormField as FormField, AppSelect, AppTextarea } from "@silvicom/ui";
import {
  LEAD_CONTACT_METHODS,
  LEAD_CONTACT_METHOD_LABELS,
  LEAD_CONTACT_OUTCOMES,
  LEAD_CONTACT_OUTCOME_LABELS,
  type LeadContactInput,
} from "@silvicom/shared";

/**
 * Writing down a call, text or email a person already made (D-LS6: nothing here contacts anybody).
 *
 * The outcome starts empty on purpose. These rows are append-only, so a default a recruiter skips past would be
 * a false record that stays, and an inbound text has no outcome at all. The save button is the drawer's footer.
 */
defineProps<{ formId: string }>();
const emit = defineEmits<{ save: [input: LeadContactInput] }>();

const directions = [
  { value: "outbound", label: "We contacted them" },
  { value: "inbound", label: "They contacted us" },
];
const methods = LEAD_CONTACT_METHODS.map((m) => ({ value: m, label: LEAD_CONTACT_METHOD_LABELS[m] }));
const outcomes = [{ value: null, label: "Not recorded" }, ...LEAD_CONTACT_OUTCOMES.map((o) => ({ value: o, label: LEAD_CONTACT_OUTCOME_LABELS[o] }))];

const form = reactive({
  direction: "outbound" as LeadContactInput["direction"],
  method: "call" as LeadContactInput["method"],
  outcome: null as LeadContactInput["outcome"],
  note: "",
});
const save = () => emit("save", { ...form, note: form.note.trim() || null });
</script>

<template>
  <form :id="formId" class="space-y-4" data-test="contact-form" @submit.prevent="save">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField v-slot="{ id }" label="Who reached out">
        <AppSelect :id="id" v-model="form.direction" :options="directions" placeholder="" data-test="direction" />
      </FormField>
      <FormField v-slot="{ id }" label="How">
        <AppSelect :id="id" v-model="form.method" :options="methods" placeholder="" data-test="method" />
      </FormField>
    </div>
    <FormField v-slot="{ id }" label="Outcome">
      <AppSelect :id="id" v-model="form.outcome" :options="outcomes" placeholder="" data-test="outcome" />
    </FormField>
    <FormField v-slot="{ id }" label="Note">
      <AppTextarea :id="id" v-model="form.note" maxlength="2000" data-test="note" />
    </FormField>
  </form>
</template>
