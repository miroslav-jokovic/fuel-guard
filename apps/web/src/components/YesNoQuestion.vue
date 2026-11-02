<script setup lang="ts">
import { computed } from "vue";
import { AppRadioGroup } from "@silvicom/ui";

/**
 * One yes/no question, answered or not. `null` is "not answered yet", which is a different fact from
 * "no" — 0376 refuses an unanswered §40.25(j), and a control that started on "No" would answer it for
 * the person.
 *
 * Lifted out of `features/apply/YesNoField.vue` for HW5b (HIRING-WORKFLOW-AUDIT-2026-10-31 §4.5): the
 * one employer form is used by the applicant's link AND by the office's two screens, so its yes/no
 * questions cannot live inside `features/apply`. The words "Yes" and "No" are props for the same
 * reason — the applicant's page reads them in its own language, the office in English — and
 * `YesNoField` is now this control with the applicant's words. Its choices are 44 px rows at `touch`
 * (§6.8). `id` lets a refusal move focus onto the group.
 */
withDefaults(
  defineProps<{
    legend: string;
    yes: string;
    no: string;
    hint?: string;
    error?: string;
    id?: string;
    size?: "default" | "touch";
  }>(),
  { hint: undefined, error: undefined, id: undefined, size: "touch" },
);
const model = defineModel<boolean | null>({ required: true });
const radio = computed({
  get: () => (model.value === null ? undefined : model.value ? "yes" : "no"),
  set: (v) => { model.value = v === "yes"; },
});
</script>

<template>
  <div>
    <AppRadioGroup
      :id="id"
      v-model="radio"
      :tabindex="id ? -1 : undefined"
      :aria-invalid="error ? 'true' : undefined"
      :size="size"
      :legend="legend"
      :options="[{ value: 'yes', label: yes }, { value: 'no', label: no }]"
    />
    <!-- The hint stays when the error appears: on the employer questions it is what explains the term
         the person is being told to answer, and a refusal is the moment they most need it. -->
    <p v-if="hint" class="mt-1 text-xs text-ink-tertiary">{{ hint }}</p>
    <p v-if="error" class="mt-1 text-sm text-danger-700" role="alert">{{ error }}</p>
  </div>
</template>
