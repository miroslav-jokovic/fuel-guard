<script setup lang="ts">
import { computed } from "vue";
import { AppRadioGroup } from "@silvicom/ui";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * One yes/no question, answered or not (§6.2's gates and the screening questions). `null` is "not
 * answered yet", which is a different fact from "no" — 0376 refuses an unanswered §40.25(j), and a
 * control that started on "No" would answer it for the applicant.
 */
defineProps<{ legend: string; hint?: string; error?: string }>();
const model = defineModel<boolean | null>({ required: true });
const copy = APPLY_COPY.partOne;
const radio = computed({
  get: () => (model.value === null ? undefined : model.value ? "yes" : "no"),
  set: (v) => { model.value = v === "yes"; },
});
</script>

<template>
  <div>
    <AppRadioGroup
      v-model="radio"
      :legend="legend"
      :options="[{ value: 'yes', label: copy.yes }, { value: 'no', label: copy.no }]"
    />
    <p v-if="error" class="mt-1 text-sm text-danger-700" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="mt-1 text-xs text-ink-tertiary">{{ hint }}</p>
  </div>
</template>
