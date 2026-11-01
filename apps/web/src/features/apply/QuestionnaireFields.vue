<script setup lang="ts">
import { computed } from "vue";
import {
  AppCheckbox as BaseCheckbox,
  AppCombobox as ComboSelect,
  AppInput as BaseInput,
  AppSegmentedControl,
  AppTextarea as BaseTextarea,
} from "@silvicom/ui";
import {
  isAsked,
  questionsForScreen,
  type ApplicationSection,
  type QuestionnaireQuestion,
} from "@silvicom/shared";
import ApplyField from "@/features/apply/ApplyField.vue";
import QuestionnaireTable from "@/features/apply/QuestionnaireTable.vue";
import { applicantQuestionnaire } from "@/features/apply/questionnaireCopy";
import { APPLY_COPY } from "@/features/apply/strings";
import type { ApplicationDraft } from "@/features/apply/draft";

/**
 * The carrier's own questions (A9, D-APP12).
 *
 * ── WHAT THIS SCREEN IS NOT ───────────────────────────────────────────────────────────────────
 * It is not part of §391.21. Every other screen in this wizard names the CFR paragraph it discharges;
 * this one deliberately names none, and says so to the driver in the first sentence — telling
 * somebody the regulation asks for their references when it does not is a small lie that a rendered
 * document then repeats.
 *
 * ── SEVEN OF THEM ARE REQUIRED NOW (§9 P8, Q-WF3) ────────────────────────────────────────────
 * Until P8 nothing on it blocked anything, and the audit measured what that bought: applications
 * arriving with every carrier question blank. The definition marks seven `required`; this screen marks
 * them, and the refusal is not this screen's — it is `APPLICATION_CROSS_FIELD_RULES`', in the schema the
 * API parses with, so the box marked here is exactly the box the server would refuse.
 *
 * Every other question has a `skip` ("I'd rather not say", "Doesn't apply") stored as an answer, so
 * the office can tell a question passed over on purpose from one never seen, and from a "no".
 *
 * The questions are DATA — a versioned definition in shared — so this file renders whatever the
 * definition holds and knows none of the carrier's questions by name. That is the whole of D-APP12
 * expressed as a component: the carrier's form changes without a line of this changing.
 */
const draft = defineModel<ApplicationDraft>({ required: true });

/**
 * Which screen's questions to render (D-AX7).
 *
 * ⚠ The component is unchanged in every other respect — it still knows none of the carrier's
 * questions by name and renders whatever the definition holds. What moved is that the definition now
 * says which screen each question belongs on, because the carrier's own paper says so: five of these
 * are on its page 1, beside the name and the address.
 */
const props = withDefaults(defineProps<{ section?: ApplicationSection }>(), { section: "questions" });

// The definition this draft's answers are being given against (§9 P8): v2 for a draft started before v3.
const definition = applicantQuestionnaire(draft.value.questionnaire_version);

const answer = (id: string): unknown => draft.value.questionnaire[id];
/**
 * Set one answer — and clear any question asked only on the answer this one had (AF-6): a "When?"
 * typed after a "yes" that is then changed to "no" is an answer to a question no longer asked.
 */
const set = (id: string, value: unknown): void => {
  const next: Record<string, unknown> = { ...draft.value.questionnaire, [id]: value };
  for (const q of definition.questions) {
    if (q.askedWhen?.question === id && !isAsked(q, next)) delete next[q.id];
  }
  draft.value.questionnaire = next;
};

/**
 * Yes/no as two buttons (AF-6), and three facts rather than two: yes, no, and not answered. "May we
 * contact your previous employers?" left blank is a different fact from answered no, and a recruiter
 * reading the rendered application needs to tell them apart. A segmented control rather than the
 * dropdown it was: one tap, both answers visible. An optional one's skip is the box under it, as on
 * every other kind — a third segment would not fit "Prefiero no decirlo" at 390px.
 */
const YES_NO = [
  { value: "yes", label: APPLY_COPY.carrierQuestions.yes },
  { value: "no", label: APPLY_COPY.carrierQuestions.no },
];
const boolValue = (id: string): string => {
  const v = answer(id);
  return v === true ? "yes" : v === false ? "no" : "";
};
const setBool = (id: string, raw: string): void => set(id, raw === "yes" ? true : raw === "no" ? false : null);

/** An optional question the applicant has chosen not to answer — its box is put away (§9 P8). */
const skipped = (question: QuestionnaireQuestion): boolean =>
  Boolean(question.skip) && answer(question.id) === question.skip!.value;
const setSkipped = (question: QuestionnaireQuestion, on: boolean): void =>
  set(question.id, on ? question.skip!.value : null);

const rowsFor = (id: string): Record<string, unknown>[] => {
  const v = answer(id);
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
};

/** This screen's questions that are asked, given the answers so far (`askedWhen`). */
const questions = computed(() =>
  questionsForScreen(definition, props.section).filter((q) => isAsked(q, draft.value.questionnaire)),
);

/** The contract path of one answer — what a refusal names and what `ApplyField` derives its id from. */
const pathOf = (question: QuestionnaireQuestion): [string, string] => ["questionnaire_answers", question.id];

/**
 * A `select`'s options. A keyed question (`choices`, Q-HM14's `applying_as`) stores the KEY and shows
 * the label; every other `select` stores and shows its option's own words.
 */
const selectOptions = (question: QuestionnaireQuestion): Array<{ value: string; label: string }> =>
  question.choices
    ? question.choices.map((c) => ({ ...c }))
    : (question.options ?? []).map((o) => ({ value: o, label: o }));
</script>

<template>
  <div class="space-y-5">
    <!-- Only on the screen that IS the carrier's questions. On `identity` and `employment` these sit
         among the regulation's own fields and a paragraph explaining that they are not part of the
         federal application would be introducing a distinction the driver has no use for there. -->
    <p v-if="section === 'questions'" class="text-sm text-ink-muted">{{ definition.intro }}</p>

    <!-- ⚠ A grid, and the reason is what these questions now sit beside (D-AX7). Rendered one per
         row, a two-word answer like "Position you are applying for" took a 680px input on a desktop
         while the name fields above it sat three to a row — the carrier's questions read as a
         different form bolted underneath the regulation's. A `longtext` or a `table` still spans the
         whole width, because those answers are paragraphs and grids and a half-width box invites a
         one-line answer to a question that wanted more. -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div
        v-for="question in questions"
        :key="question.id"
        :class="['space-y-2', (question.kind === 'longtext' || question.kind === 'table') && 'sm:col-span-2']"
      >
        <!-- `ApplyField` and not the bare `AppFormField` this used (§9 P8): the contract path gives the
             box the id a refusal focuses and the error under it, and `required` marks the label. -->
        <ApplyField v-slot="f" :path="pathOf(question)" :label="question.label" :hint="question.hint" :required="question.required">
        <template v-if="!skipped(question)">
        <AppSegmentedControl
          v-if="question.kind === 'boolean'"
          :id="f.id"
          :model-value="boolValue(question.id)"
          :options="YES_NO"
          :label="question.label"
          @update:model-value="setBool(question.id, $event)"
        />
        <BaseTextarea
          v-else-if="question.kind === 'longtext'"
          v-bind="f"
          :model-value="(answer(question.id) as string) ?? ''"
          :rows="3"
          @update:model-value="set(question.id, $event)"
        />
        <!-- ⚠ `ComboSelect`, not the native `AppSelect` this carried until 2026-09-11: the forms idiom
             the rest of the product answers a choice with (`apps/web/CLAUDE.md`). -->
        <ComboSelect
          v-else-if="question.kind === 'select'"
          v-bind="f"
          :model-value="(answer(question.id) as string) ?? ''"
          :options="selectOptions(question)"
          @update:model-value="set(question.id, $event)"
        />
        <QuestionnaireTable
          v-else-if="question.kind === 'table'"
          :question="question"
          :rows="rowsFor(question.id)"
          @update="set(question.id, $event)"
        />
        <BaseInput
          v-else
          v-bind="f"
          :model-value="(answer(question.id) as string) ?? ''"
          :inputmode="question.kind === 'number' ? 'numeric' : undefined"
          @update:model-value="set(question.id, $event)"
        />
        </template>
        </ApplyField>
        <!-- An optional question's stored skip. Ticked, the box is put away: an answer and a skip
             cannot both be on file. -->
        <BaseCheckbox
          v-if="question.skip"
          :model-value="skipped(question)"
          @update:model-value="setSkipped(question, $event)"
        >
          {{ question.skip.label }}
        </BaseCheckbox>
      </div>
    </div>
  </div>
</template>
