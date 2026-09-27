<script setup lang="ts">
import { ref } from "vue";
import { AppButton as BaseButton, AppTextarea as BaseTextarea, AppFormField as FormField } from "@silvicom/ui";
import { APPLICATION_CORRECTION_NOTE_MAX } from "@silvicom/shared";
import type { ApplicationDraft } from "@/features/apply/draft";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * "Something wrong? Tell us" (C3c2c2, Q-AW34, §6.4 items 1 and 3).
 *
 * Part 1's facts are shown read-only in Part 2 — the office checked the driver's record with them, and
 * filing takes them from Part 1 whatever Part 2 holds — so a mistake in one is reported, not retyped.
 * The report is a note on the draft (`correction_note`), autosaved, never filed, and shown on the
 * office's drawer. ONE note for every screen that shows a fact: a driver writing "my phone and my
 * licence number are wrong" should not have to split it across two boxes, and the office reads one.
 *
 * Opens by itself when a note is already written, so a driver who comes back sees what they said.
 *
 * ⚠ The office cannot yet CORRECT most of what a note reports: only the date of birth and the CDL's
 * number and state have an office writer (`correctApplicantIdentity`). Recorded as Q-AW36, not routed
 * around here — this sends the report; what the office can do with it is that question's.
 */
const draft = defineModel<ApplicationDraft>({ required: true });
const copy = APPLY_COPY.partOneFacts;
const open = ref(draft.value.correction_note.trim() !== "");
</script>

<template>
  <div>
    <BaseButton v-if="!open" variant="ghost" size="touch" @click="open = true">{{ copy.tellUs }}</BaseButton>
    <FormField v-else id="apply-correction_note" :label="copy.tellUsLabel" :hint="copy.tellUsHint">
      <template #default="f">
        <BaseTextarea v-bind="f" v-model="draft.correction_note" rows="3" :maxlength="APPLICATION_CORRECTION_NOTE_MAX" />
      </template>
    </FormField>
  </div>
</template>
