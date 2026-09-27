<script setup lang="ts">
import { computed } from "vue";
import { AppRadioGroup } from "@silvicom/ui";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * One yes/no question, answered or not (§6.2's gates and the screening questions). `null` is "not
 * answered yet", which is a different fact from "no" — 0376 refuses an unanswered §40.25(j), and a
 * control that started on "No" would answer it for the applicant.
 *
 * Moved out of `partOne/` (it was `PartOneYesNo`) on 2026-09-27 for C3c2b, when Part 2's employer
 * panel began asking §391.21(b)(10)(iv)'s two questions the same way (Q-AW33): one control for every
 * yes/no on the application, so an unanswered question looks the same wherever it is. Its choices are
 * 44 px rows (`size="touch"`, §6.8). `id` lets a refusal move focus onto the group — the panel's Save
 * does that with the first answer it complains about.
 */
defineProps<{ legend: string; hint?: string; error?: string; id?: string }>();
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
      :id="id"
      v-model="radio"
      :tabindex="id ? -1 : undefined"
      :aria-invalid="error ? 'true' : undefined"
      size="touch"
      :legend="legend"
      :options="[{ value: 'yes', label: copy.yes }, { value: 'no', label: copy.no }]"
    />
    <!-- The hint stays when the error appears: on the employer questions it is what explains the term
         the driver is being told to answer, and a refusal is the moment they most need it. -->
    <p v-if="hint" class="mt-1 text-xs text-ink-tertiary">{{ hint }}</p>
    <p v-if="error" class="mt-1 text-sm text-danger-700" role="alert">{{ error }}</p>
  </div>
</template>
