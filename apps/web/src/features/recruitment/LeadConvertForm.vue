<script setup lang="ts">
import { computed } from "vue";
import { AppRadioGroup } from "@silvicom/ui";
import { NEW_APPLICANT } from "./useLeadActions";

/**
 * Making a lead an applicant, or adding them to an applicant already on the board.
 *
 * When there is a match nothing is preselected. A match by phone or email only means "may be the same person",
 * and either wrong answer is costly: a duplicate applicant, or one person's lead on another's record. Only an
 * open applicant is offered, because that is all `convert_lead` accepts.
 */
const props = defineProps<{ name: string; applicants: Array<{ id: string }>; otherRecords: number }>();
const choice = defineModel<string>({ required: true });

const options = computed(() => [
  ...props.applicants.map((a, i) => ({
    value: a.id,
    label: props.applicants.length > 1 ? `Add to matching applicant ${i + 1}` : "Add to the matching applicant",
    description: "Matched by phone or email. No new record is made.",
  })),
  { value: NEW_APPLICANT, label: "Make a new applicant", description: "Starts a new record on the board." },
]);
const pick = (value: string | number | undefined) => (choice.value = String(value ?? ""));
</script>

<template>
  <div class="space-y-4 text-sm text-ink-secondary" data-test="convert-form">
    <template v-if="applicants.length > 0">
      <p>{{ name }} may already be on the board. Check their record before you choose.</p>
      <AppRadioGroup :model-value="choice" :options="options" legend="Where this lead goes" @update:model-value="pick" />
    </template>
    <p v-else>This puts {{ name }} on the board as a new applicant, with the name, phone and email on this lead.</p>
    <p v-if="otherRecords > 0" data-test="other-records">
      They also match a record that isn't an open applicant. A lead can't be added to that one.
    </p>
  </div>
</template>
