import { defineComponent, h, type PropType } from "vue";
import { isAsked, questionsForScreen, type ApplicationSection } from "@silvicom/shared";
import QuestionField from "@/features/apply/QuestionField.vue";
import { questionnaireAnswers } from "@/features/apply/questionnaireAnswers";
import type { ApplicationDraft } from "@/features/apply/draft";

/**
 * TEST HARNESS — one task's carrier questions, each drawn by `QuestionField`, for the tests of that
 * control and of the answers behind it (`questionnaireAnswers`).
 *
 * The driver meets these one to a screen: `useTaskWalk` picks the question and `TaskWalk` draws it with
 * this same `QuestionField` and this same answers object. Until 1b-5 the tests mounted the legacy
 * wizard's questions screen (`QuestionnaireFields`), which drew them all at once. That screen is gone;
 * this keeps what those tests were about — the control for each kind, the required mark, "If so,
 * when?", the skip, the carrier's own stamped questions — on the component a driver is shown.
 *
 * ⚠ Not shipped: nothing outside `*.test.ts` may import it. Which questions a task asks, and in what
 * order, is `useTaskWalk`'s and is tested there; here they are only listed.
 */
export const QuestionList = defineComponent({
  name: "QuestionList",
  props: {
    modelValue: { type: Object as PropType<ApplicationDraft>, required: true },
    section: { type: String as PropType<ApplicationSection>, default: "questions" },
    source: { type: String as PropType<"builtin" | "carrier">, default: "builtin" },
  },
  setup(props) {
    const answers = questionnaireAnswers(() => props.modelValue, props.source);
    const definition = answers.definition();
    return () =>
      h("div", questionsForScreen(definition, props.section)
        .filter((q) => isAsked(q, answers.answers()))
        .map((question) => h(QuestionField, { key: question.id, question, answers })));
  },
});
