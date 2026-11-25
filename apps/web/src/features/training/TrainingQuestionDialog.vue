<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { checkQuestion, type TrainingChapter, type TrainingQuestionView } from "@silvicom/shared";
import { AppButton, AppFormField, AppInput, AppRadioGroup, AppSelect, AppTextarea, BaseModal, DIALOG_FOOTER_CLASS } from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import { useSaveQuestion } from "./useTraining";

/**
 * One quiz question (§3, D-TR7): the question, 2 to 5 answers with one right, a one-line "why" the
 * driver reads after answering, and the chapter it comes from, which a fail sends them back to (D-TR8).
 * `checkQuestion` is the same rule the API applies, so a refusal is said here before the round trip.
 *
 * ⚠ Write each question from a line actually spoken in the locked cut (plan §3): a question the film
 * does not answer fails a driver who watched it properly.
 */
const props = defineProps<{ versionId: string; chapters: TrainingChapter[]; question: TrainingQuestionView | null; open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const toast = useToastStore();
const save = useSaveQuestion();

const prompt = ref("");
const choices = ref<string[]>(["", "", ""]);
const answerIndex = ref(0);
const why = ref("");
const chapter = ref(0);
watch(
  () => [props.open, props.question] as const,
  ([open, q]) => {
    if (!open) return;
    prompt.value = q?.prompt ?? "";
    choices.value = q ? [...q.choices] : ["", "", ""];
    answerIndex.value = q?.answerIndex ?? 0;
    why.value = q?.why ?? "";
    chapter.value = q?.chapter ?? 0;
  },
  { immediate: true },
);

const chapterOptions = computed(() =>
  (props.chapters.length ? props.chapters : [{ title: "Whole video", startMs: 0 }]).map((c, i) => ({ value: i, label: `${i + 1}. ${c.title}` })),
);
const answerOptions = computed(() => choices.value.map((c, i) => ({ value: i, label: c.trim() || `Answer ${i + 1}` })));
const input = computed(() => ({ chapter: chapter.value, prompt: prompt.value, choices: choices.value.map((c) => c.trim()), answerIndex: answerIndex.value, why: why.value }));
const problem = computed(() => checkQuestion(input.value, props.chapters.length));

function removeChoice(i: number) {
  choices.value.splice(i, 1);
  if (answerIndex.value >= choices.value.length) answerIndex.value = 0;
}

async function submit() {
  if (problem.value) return;
  try {
    await save.mutateAsync({ versionId: props.versionId, id: props.question?.id ?? null, ...input.value });
    toast.success(props.question ? "Question saved" : "Question added");
    emit("close");
  } catch (e) {
    toast.error("Question not saved", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <BaseModal :open="open" size="lg" :title="question ? 'Edit question' : 'Add a question'" description="Write it from a line the film actually says. Each driver gets a few questions drawn from this list, answers in a new order." @close="emit('close')">
    <form class="space-y-4" @submit.prevent="submit">
      <AppFormField v-slot="{ id }" label="Question" required>
        <AppTextarea :id="id" v-model="prompt" rows="2" maxlength="400" data-test="question-prompt" />
      </AppFormField>
      <fieldset class="space-y-2">
        <legend class="text-sm font-medium text-ink">Answers</legend>
        <div v-for="(_c, i) in choices" :key="i" class="flex items-center gap-2">
          <AppInput v-model="choices[i]" :aria-label="`Answer ${i + 1}`" maxlength="200" class="flex-1" :data-test="`question-choice-${i}`" />
          <AppButton v-if="choices.length > 2" size="sm" variant="ghost" @click="removeChoice(i)">Remove</AppButton>
        </div>
        <AppButton v-if="choices.length < 5" size="sm" data-test="question-add-choice" @click="choices.push('')">Add an answer</AppButton>
      </fieldset>
      <AppRadioGroup v-model="answerIndex" :options="answerOptions" legend="The right answer" data-test="question-answer" />
      <AppFormField v-slot="{ id }" label="Why it is right" hint="One line. The driver reads it after answering, right or wrong." required>
        <AppInput :id="id" v-model="why" maxlength="400" data-test="question-why" />
      </AppFormField>
      <AppFormField v-slot="{ id }" label="From chapter" hint="A driver who gets this wrong watches this chapter again." required>
        <AppSelect :id="id" v-model="chapter" :options="chapterOptions" data-test="question-chapter" />
      </AppFormField>
      <p v-if="problem" class="text-xs text-ink-secondary" data-test="question-problem">{{ problem }}</p>
      <div :class="DIALOG_FOOTER_CLASS">
        <AppButton @click="emit('close')">Cancel</AppButton>
        <AppButton variant="primary" type="submit" :disabled="!!problem || save.isPending.value" data-test="question-save">{{ question ? "Save question" : "Add question" }}</AppButton>
      </div>
    </form>
  </BaseModal>
</template>
