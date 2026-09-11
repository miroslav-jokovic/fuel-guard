<script setup lang="ts">
import { computed } from "vue";
import {
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSelect as BaseSelect,
  AppTextarea as BaseTextarea,
} from "@silvicom/ui";
import { questionnaireForApplicant, questionsForScreen, type ApplicationSection } from "@silvicom/shared";
import QuestionnaireTable from "@/features/apply/QuestionnaireTable.vue";
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
 * ── AND NOTHING ON IT BLOCKS ANYTHING ─────────────────────────────────────────────────────────
 * No question here can stop the application being sent. That is a decision, written down where it is
 * made (`questionnaireContract.ts`, on why there is no `required` flag) rather than an omission: a
 * driver must not lose a federally-required filing to a question the regulation never asked.
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

const definition = questionnaireForApplicant();

const answer = (id: string): unknown => draft.value.questionnaire[id];
const set = (id: string, value: unknown): void => {
  draft.value.questionnaire = { ...draft.value.questionnaire, [id]: value };
};

/**
 * Yes/no as a select and not a checkbox.
 *
 * A checkbox has two states and the paper's questions have three: yes, no, and not answered. "May we
 * contact your previous employers?" left blank is a different fact from answered no, and a recruiter
 * reading the rendered application needs to be able to tell them apart.
 */
const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];
const boolValue = (id: string): string => {
  const v = answer(id);
  return v === true ? "yes" : v === false ? "no" : "";
};
const setBool = (id: string, raw: unknown): void => set(id, raw === "yes" ? true : raw === "no" ? false : null);

const rowsFor = (id: string): Record<string, unknown>[] => {
  const v = answer(id);
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
};

const questions = computed(() => questionsForScreen(definition, props.section));
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
        <FormField v-slot="{ id }" :label="question.label" :hint="question.hint">
        <BaseTextarea
          v-if="question.kind === 'longtext'"
          :id="id"
          :model-value="(answer(question.id) as string) ?? ''"
          :rows="3"
          @update:model-value="set(question.id, $event)"
        />
        <BaseSelect
          v-else-if="question.kind === 'boolean'"
          :id="id"
          :model-value="boolValue(question.id)"
          :options="YES_NO"
          @update:model-value="setBool(question.id, $event)"
        />
        <BaseSelect
          v-else-if="question.kind === 'select'"
          :id="id"
          :model-value="(answer(question.id) as string) ?? ''"
          :options="(question.options ?? []).map((o) => ({ value: o, label: o }))"
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
          :id="id"
          :model-value="(answer(question.id) as string) ?? ''"
          :inputmode="question.kind === 'number' ? 'numeric' : undefined"
          @update:model-value="set(question.id, $event)"
        />
        </FormField>
      </div>
    </div>
  </div>
</template>
