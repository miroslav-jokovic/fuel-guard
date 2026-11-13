<script setup lang="ts">
import { computed } from "vue";
import {
  AppButton,
  AppCheckbox as BaseCheckbox,
  AppCombobox as ComboSelect,
  AppInput as BaseInput,
  AppSegmentedControl,
  AppTextarea as BaseTextarea,
} from "@silvicom/ui";
import { QUICK_PICKS, type QuestionnaireQuestion } from "@silvicom/shared";
import ApplyField from "@/features/apply/ApplyField.vue";
import QuestionnaireTable from "@/features/apply/QuestionnaireTable.vue";
import type { QuestionnaireAnswers } from "@/features/apply/questionnaireAnswers";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * One of the carrier's questions (A9, D-APP12), drawn by its kind — moved out of `QuestionnaireFields`
 * whole (F4 PR 1b-2) so the walk asks the same question with the same control one to a screen, and the
 * section component lays the same ones out together until it is retired. It knows no question by name:
 * the definition says what is asked, and this says how a kind is answered.
 */
const props = defineProps<{ question: QuestionnaireQuestion; answers: QuestionnaireAnswers }>();
const a = props.answers;

/**
 * Yes/no as two buttons (AF-6), and three facts rather than two: yes, no, and not answered. "May we
 * contact your previous employers?" left blank is a different fact from answered no, and a recruiter
 * reading the rendered application needs to tell them apart. An optional one's skip is the box under it,
 * as on every other kind — a third segment would not fit "Prefiero no decirlo" at 390px.
 */
const YES_NO = [
  { value: "yes", label: APPLY_COPY.carrierQuestions.yes },
  { value: "no", label: APPLY_COPY.carrierQuestions.no },
];
const boolValue = (): string => {
  const v = a.answer(props.question.id);
  return v === true ? "yes" : v === false ? "no" : "";
};
const setBool = (raw: string): void => a.set(props.question.id, raw === "yes" ? true : raw === "no" ? false : null);

const text = (): string => (a.answer(props.question.id) as string | null | undefined) ?? "";
const rows = (): Record<string, unknown>[] => {
  const v = a.answer(props.question.id);
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
};

/**
 * A `select`'s options. A keyed question (`choices`, Q-HM14's `applying_as`) stores the KEY and shows
 * the label; every other `select` stores and shows its option's own words.
 */
const selectOptions = computed(() =>
  props.question.choices
    ? props.question.choices.map((c) => ({ ...c }))
    : (props.question.options ?? []).map((o) => ({ value: o, label: o })));

/**
 * Quick picks (SCREEN-MAP 2.4): the English words filed, shown in the page's language, as on the generated
 * screens (`WizardScreen`). A pick fills the box, and the box reads the pick in the page's language.
 */
const picks = computed(() => {
  const list = props.question.quickPicks;
  if (!list) return [];
  const words = APPLY_COPY.quickPicks[list] as Record<string, string>;
  return QUICK_PICKS[list].map((value) => ({ value, label: words[value] ?? value }));
});
const shown = (): string => picks.value.find((p) => p.value === text())?.label ?? text();
const typed = (value: string): void =>
  a.set(props.question.id, picks.value.find((p) => p.label.trim().toLowerCase() === value.trim().toLowerCase())?.value ?? value);
</script>

<template>
  <div class="space-y-2">
    <!-- `ApplyField` (§9 P8): the contract path gives the box the id a refusal focuses and the error
         under it, and `required` marks the label. -->
    <ApplyField v-slot="f" :path="a.pathOf(question)" :label="question.label" :hint="question.hint" :required="question.required">
      <template v-if="!a.skipped(question)">
        <AppSegmentedControl
          v-if="question.kind === 'boolean'"
          :id="f.id"
          :model-value="boolValue()"
          :options="YES_NO"
          :label="question.label"
          @update:model-value="setBool($event)"
        />
        <BaseTextarea
          v-else-if="question.kind === 'longtext'"
          v-bind="f"
          :model-value="text()"
          :rows="3"
          @update:model-value="a.set(question.id, $event)"
        />
        <!-- `ComboSelect`, not the native `AppSelect` this carried until 2026-09-11: the forms idiom
             the rest of the product answers a choice with (`apps/web/CLAUDE.md`). -->
        <ComboSelect
          v-else-if="question.kind === 'select'"
          v-bind="f"
          :model-value="text()"
          :placeholder="APPLY_COPY.placeholders.choose"
          :options="selectOptions"
          @update:model-value="a.set(question.id, $event)"
        />
        <QuestionnaireTable
          v-else-if="question.kind === 'table'"
          :question="question"
          :rows="rows()"
          @update="a.set(question.id, $event)"
        />
        <BaseInput
          v-else-if="picks.length"
          v-bind="f"
          :model-value="shown()"
          @update:model-value="typed($event)"
        />
        <BaseInput
          v-else
          v-bind="f"
          :model-value="text()"
          :inputmode="question.kind === 'number' ? 'numeric' : undefined"
          @update:model-value="a.set(question.id, $event)"
        />
      </template>
    </ApplyField>
    <div v-if="picks.length && !a.skipped(question)" class="flex flex-wrap gap-2">
      <AppButton
        v-for="p in picks"
        :key="p.value"
        variant="secondary"
        size="sm"
        :aria-pressed="text() === p.value"
        @click="a.set(question.id, p.value)"
      >
        {{ p.label }}
      </AppButton>
    </div>
    <!-- An optional question's stored skip. Ticked, the box is put away: an answer and a skip cannot
         both be on file. -->
    <BaseCheckbox
      v-if="question.skip"
      :model-value="a.skipped(question)"
      @update:model-value="a.setSkipped(question, $event)"
    >
      {{ question.skip.label }}
    </BaseCheckbox>
  </div>
</template>
